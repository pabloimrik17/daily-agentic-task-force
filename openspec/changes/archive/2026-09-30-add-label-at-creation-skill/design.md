## Context

See proposal.md for motivation; the behaviour is in `specs/label-at-creation/spec.md`.

What exists and is reused:

- `src/label-triage/criteria.md`: the meanings of the five labels and the group constraints. `judgement.ts` embeds it verbatim in the triage prompt, and a test guards that. Change `add-label-contract-and-triage` wrote it "in the words the judgement prompt and the future creation-time skill share".
- `src/config.ts` `loadConfig(env)`: the strict `autonomous.config.v1` loader, with `judgement.threshold` and the per-source `scope` and `aliases`.
- `src/label-contract/detect.ts` `detect(task, rules)`: per group, present, missing with evidence, or conflict.
- `src/label-triage/rules.ts` `deriveByRule(detection)`: evidence becomes a group at confidence 1, and conflicting evidence goes to the human.
- `src/label-triage/decide.ts` `decide(derivation, threshold)`: validity first, then the threshold.

The plugin has no `skills/` directory yet; its only component is the `run` command. `claude plugin details` reports about 49 tokens always-on for it. The plugin is not installed on this machine (`claude plugin list` shows only `datf-lab`), so the skill reaches real sessions only after installation.

These facts were verified on 2026-09-27 with Claude Code 2.1.283 and throwaway probes in the session scratchpad:

- `claude plugin eval` runs each case as an isolated `claude -p` child with a temporary `HOME` (`/private/tmp/e-…/home`) and the working directory `$HOME/cwd`. Sandboxed Bash cannot read paths under the real home directory (`Operation not permitted`), and `Read` outside the allowlist is denied in don't-ask mode. So neither the real `~/.config/autonomous/config.json` nor the trackers' credentials reach a run.
- `AskUserQuestion` is absent from eval runs, even when a case lists it in `allowed_tools`. It is also absent from a plain `claude -p` session. Evals can exercise only the branch where the session cannot ask.
- Grants take effect: `bun` 1.4.2 is on the run's `PATH`. With `--ablation with-without`, a `tool_used: Skill` grader is a plugin-fired indicator, not a score.
- A run that dies on an account error still scored 1.0 against a trivial regex grader. The spend-limit probe did exactly that.
- A 2026-09-28 eval probe with `--scaffold` seeded the temporary `$HOME/.config/autonomous/config.json`. The helper ran from this worktree under the real home directory and reported `scope: derived personal (every linear task is personal)`. The plugin does not need staging outside the home directory. Later suite runs use `--scaffold` for cases that need configuration or a temporary Beads database, and `--allow-tools "Bash(*)"` so the isolated agent can inspect that database before attempting a create call.

## Goals / Non-Goals

**Goals:**

- Every deterministic part of labelling at creation runs through the same code the triage step runs: config, evidence, threshold and validity. The skill's prose holds only what needs the conversation: triggering, the judgement, asking, and the write.
- The skill is developed test-first and audited with the Claude Code CLI and the skill-authoring skills, and the evidence (eval results, audit findings) is kept with the change.

**Non-Goals:**

- A second tracker integration. The skill never reads or writes a tracker through the plugin's tracker modules; the session's own tool does the write.
- A generic "skills framework" for the plugin. One skill, one helper.
- Making the eval suite a CI gate.

## Decisions

### D1. The judgement stays in prose; everything deterministic goes through one helper

DOT-103 says "prose, not a script call" for the judgement: the creating agent already holds the conversation, which is richer than title and description, so it judges. The user added on 2026-09-27 that the programmatic triage process already contains part of what the skill needs, so that part is reused, not restated. The code → Jev → LLM tiering points the same way. The split:

| Part                                                  | Tier                     | Where                                  |
| ----------------------------------------------------- | ------------------------ | -------------------------------------- |
| decide the skill applies                              | LLM (skill description)  | `SKILL.md` frontmatter                 |
| criteria text                                         | code (file printed)      | helper `prepare`                       |
| config, evidence, conflicts                           | code                     | helper `prepare` and `decide`          |
| judge the groups left to judge                        | LLM (the creating agent) | `SKILL.md` body                        |
| threshold, validity, evidence-vs-judgement agreement  | code                     | helper `decide`                        |
| ask the user, or leave groups to triage               | LLM                      | `SKILL.md` body                        |
| write the labels in the create call                   | LLM (session's own tool) | `SKILL.md` body                        |

*Alternatives considered*:

- **Pure prose**, where the skill reads the config itself and applies the threshold. It duplicates `detect`/`decide` in words, and the threshold would drift from the code that owns it.
- **A `claude -p` or Jev judgement from the helper.** It throws away the conversation, which is the whole point of judging at creation.

### D2. The helper: `bun ${CLAUDE_PLUGIN_ROOT}/src/label-at-creation/cli.ts`, two modes

```text
cli.ts prepare --source <linear|beads|github> [--repo <owner/name>] [--label <name>]...
cli.ts decide  --source <linear|beads|github> [--repo <owner/name>] [--label <name>]...
               [--judged <group>=<label>[,<label>]@<confidence>]...
```

- `--label` names every label the task will carry at creation: the ones the user asked for (in contract spelling), the ones a parent passes down (`bd create --parent` copies the parent's labels unless `--no-inherit-labels`), and any non-contract labels (`bug`). The helper builds a synthetic `TrackerTask` (`id` `new`, empty `updatedAt`) and runs `detect` with the source's rules, then `deriveByRule`, then `decide`. No tracker CLI is called.
- `prepare` prints the criteria file's bytes unchanged. It reads the same URL `judgement.ts` reads, and a test compares the two. Then it prints one line per group: `present`, `derived <labels> (<evidence>)`, `conflict <labels>`, or `judge (<group labels>)`. Last come the notes: the configuration path and error when it did not load, and an unconfigured GitHub repository.
- `decide` prints `apply: <labels>|none`, then one `ask <group>: <reason>; options <labels>` line per group it does not apply. A judged group that has evidence and disagrees with it is asked about, with both in the reason. A judged group that agrees is applied as evidence. Judged groups go through `decide(derivation, threshold)` unchanged, tier `llm`.
- **GitHub rule scoping**: the triage step reads only configured repositories, so its structural rule means "every task *in a configured repository*". At creation the helper applies `sources.github.scope` only when `--repo` is in `sources.github.repos`. `--repo` is required for `github`. `enabled` is ignored for evidence: it controls which sources the loop reads and writes, not what a label means.
- **No configuration**: the helper prints the criteria, the path and the error. It derives no evidence and applies no judged label. Groups present and valid through `--label` are applied, and the rest are asked about. Exit 0 whenever a decision is printed, and 1 for a usage error. The skill proceeds either way, since creation is never blocked.
- Output is plain text with fixed line prefixes. The consumer is the creating agent, and the tests assert the prefixes. No JSON schema is added because nothing else consumes it.
- Layout, mirroring `run.ts`: a pure `src/label-at-creation/check.ts` (inputs → lines) plus `cli.ts` (argument parsing, `loadConfig(process.env)`, `if (import.meta.main)`), each with a colocated `*.test.ts`. knip and fallow already treat plugin tests as entries, which is how `run.ts` is reached today.

*Alternatives considered*:

- **A single call where the agent judges both groups up front.** It needs the criteria before the call, which means a separate `Read` of a plugin file (a permission prompt outside the project) or a `!` injection. An injection aborts the skill when Bash is unavailable or the command fails, and it is replaced by a placeholder in Cowork.
- **A new `/autonomous:run --check-labels` mode.** `run.ts` is the loop entry with its own report contract, and mixing a per-task advisory into it widens that contract.

### D3. The skill: `plugins/autonomous/skills/labelling-new-tasks/SKILL.md`

- Name: gerund and verb-first (`superpowers:writing-skills`), British spelling as in the plugin's code (`COLOURS`). Invoked as `autonomous:labelling-new-tasks`.
- Frontmatter:
    - `name`;
    - `description`: starts with "Use when…", names the trigger (about to create an issue, task or ticket in Linear, Beads or GitHub, for example `bd create`, `gh issue create`, `linear issue create` or a Linear MCP create) and never summarises the workflow, because a workflow summary lets agents skip the body. It stays well under the 1,536-character listing cap;
    - `allowed-tools: Bash(bun ${CLAUDE_PLUGIN_ROOT}/src/label-at-creation/cli.ts *)`, so both helper calls run without a prompt. Claude Code substitutes `${CLAUDE_PLUGIN_ROOT}` in Bash rules of plugin skills.

  No `user-invocable`, `disable-model-invocation` or `context: fork`: the skill must run inline, in the creating session, where the conversation is.
- Body, as a positive recipe, since the expected failure is omission rather than rule-breaking:
    1. before the create call, run `prepare` with the tracker, the repository and the labels the task will carry;
    2. judge each `judge` group from the conversation, answering labels and an honest confidence;
    3. run `decide`;
    4. if there are `ask` groups and `AskUserQuestion` is available, ask one question per group, then run `decide` again with the answers as `--label`; otherwise continue;
    5. create with the `apply` labels through the session's own tool (the table of label flags per tool);
    6. if the tracker rejects a missing label, create again without it and point to `--bootstrap-labels`;
    7. in the reply, name the labels applied and any group left for triage.

  Bulletproofing (rationalisation table, red flags) is added only if the RED baseline shows an agent that knows the contract and skips it.
- The body does not restate the meaning of any label. It says the criteria arrive from `prepare`.

### D4. Test-first with `claude plugin eval`, audited with the CLI and the skill-authoring skills

The RED → GREEN → REFACTOR loop of `superpowers:writing-skills`, run through the CLI's own harness rather than hand-rolled subagents. A single harness is used, so skill-creator's `evals/evals.json` format, which is not interchangeable, is not added.

- **Suite**: `plugins/autonomous/evals/<case>/` with `prompt.md` and `graders/*.md`, scaffolded with `claude plugin eval init --bare <case>`. `evals/results/` is git-ignored. Each case has one grader on the result (the create command in the trace, or the final message) and one on the steps (`tool_used`/`tool_order`), as the eval docs recommend. Graders are specific enough that an errored run cannot pass them. A regex on the create command's input is the main result grader, and a `llm` grader is used only for the short final message.
- **Cases** (initial; the tracker CLIs cannot reach a tracker from the sandbox, so the attempted `create` command in the trace is what is graded):
    1. a Beads task for clearly Nazaries, agent-doable work: a `bd create` with `work` and `AFK`;
    2. a GitHub issue where the user names `work`, `personal` and `HITL`: the conflicting scopes are withheld and `HITL` is preserved. The original `personal` plus `HITL` case passed in the no-plugin RED baseline, so it was replaced;
    3. a Linear issue whose entry is unclear, with the configuration seeded so that entry is judged against the threshold: a `linear issue create` carrying the derived `personal` and no entry label, and a final message naming entry as left for triage and why (the no-ask branch, the only one evals can reach);
    4. the user asks for `AFK` and `HITL` together: not both on the create command;
    5. the user says "tag it Grill Me": `grill-me` on the command and `Grill Me` absent;
    6. and 7. negative triggers, "open a PR for this branch" and "comment on DOT-12": `tool_used: Skill` with `min: 0`, `max: 0` and `arm: both`.

  Added after verification, for spec scenarios no case reached:

    8. a GitHub issue labelled `personal` and `HITL` in a repository that has neither. A scaffolded stand-in `gh` on `PATH` names one missing label per failure, as `gh` does. Expected: the issue is created without both, no label is created, and the reply points to `--bootstrap-labels`;
    9. a Beads task whose scope and entry are both uncertain, with no Beads scope rule: a `bd create` with no contract label, and a reply naming both groups as left for triage;
    10. three Beads tasks in one request: each `bd create` carries `work` and `AFK`.

  Every positive case also asserts that the helper ran (`tool_used` on `Bash` matching `label-at-creation/cli.ts`).
- **Run**:

  ```bash
  claude plugin eval plugins/autonomous \
    --scaffold --allow-tools "Bash(*)" \
    --model claude-sonnet-5 --max-cost-usd <n> --no-publish --trust-plugin
  ```

  Model pinned (`--model`) so a model rollout is not read as a regression; `--judge-model` stronger than the default only if a rubric proves noisy. The sandbox (temporary `HOME`, no real-home reads, restricted network) keeps attempted `create` commands from reaching a real tracker.
- **RED**: the cases and graders are written and run before `SKILL.md` exists. With no skill in the plugin, both arms are baselines. The failures seen, such as `bd create` with no labels or `Grill Me` passed through, are recorded verbatim in `openspec/changes/add-label-at-creation-skill/evidence/eval-log.md`. They are what the skill must fix. The same file records every later run (scores, `Δ`, cost) and each audit finding with its resolution. It lives with the change, not in `evals/`, because the eval directory ships with the plugin.
- **GREEN / REFACTOR**: with the skill, the with-arm must reach the threshold (`--threshold 1.0` per case, the default) with a positive `Δ`. A failing `tool_used: Skill` indicator means the description does not trigger, so iterate the description, not the body.
- **Code tier**: the helper's decisions are unit-tested with vitest (the config-dependent paths: rule, threshold, disagreement, unconfigured repository, missing configuration). Eval runs cannot see the real configuration, so vitest, not evals, is where those paths are proven.
- **Audit**, each finding either fixed or answered in the change:
    - `claude plugin validate --strict plugins/autonomous`: frontmatter and manifests;
    - `claude --plugin-dir plugins/autonomous plugin details autonomous`: the always-on token cost the description adds, recorded before and after;
    - a `plugin-dev:skill-reviewer` review of the skill (description triggering, structure, progressive disclosure);
    - `plugin-dev:skill-development` and `mattpocock-skills:writing-for-agents` loaded while writing `SKILL.md`;
    - the `superpowers:writing-skills` checklist items that apply (description form, no workflow summary, word count).
- **Manual, interactive** (the only way to see the asking branch, since `AskUserQuestion` never exists in `-p` or eval runs): in a real session with the plugin loaded (`claude --plugin-dir plugins/autonomous`), request a Beads task with an unclear entry. The question should appear before `bd create`. The test task is then deleted.

### D5. Documentation and manifests

The README gains a section on the skill: its trigger, the helper, and its dependency on the configuration and on the plugin being installed. It also gets a row in the tiering table for the creation-time parts. The plugin `description` in `plugin.json`, `package.json` and the marketplace entry mentions the skill, and all three stay identical. Versions are left to release-please.

## Risks / Trade-offs

- **The description is dropped from a crowded skill listing** → Claude Code drops descriptions of the least-invoked skills first when the listing exceeds its budget. This machine lists hundreds of skills, and a new skill starts at zero invocations. *Mitigation*: a short, front-loaded description. The README names `/doctor` and `/context` to check that the description is listed, and two user settings, outside this repo, to protect it: a higher `skillListingBudgetFraction`, or other skills set to `"name-only"` in `skillOverrides`. `skillListingMaxDescChars` caps each description at 1,536 characters by default, far above this one, so it does not help. Claude Code 2.1.285 ignores `skillOverrides` for plugin skills, so it cannot target this skill itself. After some use, `/skill-doctor` shows whether it is invoked. The CLAUDE.md or AGENTS.md of a project can also mention the skill.
- **Evals pass in isolation but the skill does not trigger among real skills** → isolated runs load only this plugin. *Mitigation*: the manual interactive check (D4) runs in a normal session with the full listing.
- **Eval spend** → each case costs about cases × runs × 2 agent runs plus judge calls, on the user's plan. The spend limit was hit during planning. *Mitigation*: `--max-cost-usd` on every run, `--ablation none` while iterating on graders, `--runs 1` for smoke passes, and the full `with-without` run only for the GREEN and final verification. A run that ends in an account error is read as a failure, never as a pass: check `error` in the JSON result.
- **The agent passes a wrong confidence** → a judged label at or above the threshold is written unasked. *Mitigation*: the same risk the triage judgement carries, and the same threshold. The reply names every applied label, and triage never removes labels, so a wrong one is visible and fixable. Every `AFK` the agent judges is named in the reply.
- **Inherited labels on `bd create --parent`** → Beads copies the parent's labels beside those in the create call. An inherited contract label would therefore survive any judgement, answer or withheld conflict that replaces or omits it. A parent's `AFK` plus an answered `HITL` gives `AFK` + `HITL`; checked against `bd` 1.3.0. *Mitigation*: inherited labels are passed as `--label`, so the helper sees them as present. The skill then creates with `--no-inherit-labels`, listing the parent's non-contract labels itself, so the task's contract labels are exactly `apply`. The eval case for Beads with a parent is added in REFACTOR if the baseline shows the gap.
- **GitHub repositories outside the configuration** have no contract labels, and `gh issue create --label` fails the whole creation. *Mitigation*: `prepare` warns up front, and the skill retries without the rejected labels and points to `--bootstrap-labels`. It never creates labels itself.

## Migration Plan

Additive only. The skill takes effect when a user installs or updates the `autonomous` plugin to the release that carries it (release-please minor from `feat(autonomous): …`). Rollback: disable the plugin (`claude plugin disable autonomous`), or pin the previous plugin version. `skillOverrides` does not reach plugin skills. The helper has no state and writes nothing.
