## 1. Helper decision module

- [x] 1.1 Implement group state in `src/label-at-creation/check.ts`:
    - build a synthetic `TrackerTask` (`id` `new`, empty `updatedAt`) from the source, repository and `--label` set;
    - get the state of each group from `detect` and `deriveByRule` with the source's rules, as `present`, `derived <labels> (<evidence>)`, `conflict <labels>` or `judge (<group labels>)`;
    - apply the GitHub structural rule only when the repository is in `sources.github.repos`, with a note for an unconfigured repository;
    - ignore `enabled`.

  Verify with `check.test.ts` covering the spec's `prepare` scenarios: Linear rule, unconfigured GitHub repository, labels named by the user, labels inherited from a parent, and both scopes named.
- [x] 1.2 Implement the decision in `check.ts`:
    - present and valid groups are applied;
    - evidence-derived groups are applied;
    - a judged group that agrees with its evidence is applied as evidence;
    - a judged group that disagrees is asked about, with both in the reason;
    - other judged groups go through `decide(derivation, threshold)` at tier `llm`;
    - a `judge` group with no judgement is asked about;
    - a conflict is asked about;
    - the output is `apply: <labels>|none` plus one `ask <group>: <reason>; options <labels>` line per asked group.

  Verify with tests for each `decide` scenario of the spec (confident entry, entry below threshold, invalid judgement, judgement disagreeing with evidence, one group applied and one asked) and for threshold 0.9 applying a judgement at 0.92.
- [x] 1.3 Implement the missing-configuration path: the criteria, the path and the error are printed, no evidence is derived, no judged label is applied, present valid labels are applied, and every other group is asked about. Verify with a test over an injected `ENOENT` read: `personal` is applied, entry is asked about, and the path is named.

## 2. Helper CLI entry

- [x] 2.1 Implement `src/label-at-creation/cli.ts`:
    - `prepare` and `decide`;
    - `--source` required and one of `linear`, `beads` or `github`;
    - `--repo` required for `github` and rejected for the other sources;
    - `--label` repeatable;
    - `--judged <group>=<labels>@<confidence>`, accepted only by `decide`, with confidence in [0, 1] and each group given at most once;
    - `loadConfig(process.env)`;
    - exit 0 whenever a decision is printed, and 1 with a usage text on a usage error;
    - `if (import.meta.main)` as in `run.ts`.

  Verify with `cli.test.ts`: one test per mode, one usage error per malformed input (unknown source, `github` without `--repo`, `--judged` given to `prepare`, confidence 1.2, a group judged twice), and the exit codes.
- [x] 2.2 Guard the single source of the criteria. Verify with a test that `prepare` prints the bytes of `criteria.md` exactly as `buildPrompt` embeds them, read from the same resolved file URL.
- [x] 2.3 Add a "Labelling at creation" section to the plugin README with the helper's two modes, its flags, its output lines and its dependency on the configuration. Add rows for the creation-time parts to the tiering table. Verify that `bun run lint:markdown` passes and that the documented flags match the CLI's usage text.
- [x] 2.4 Run the toolchain on the new module: `bun run test`, `lint:types`, `lint:eslint`, `lint:knip`, `lint:fallow` and `lint:oxfmt`. Verify that all pass and that knip and fallow reach `cli.ts` through its test, as they reach `run.ts`.
- [x] 2.5 Smoke-test the helper from a shell against the real configuration:
    - `bun plugins/autonomous/src/label-at-creation/cli.ts prepare --source linear`;
    - `bun plugins/autonomous/src/label-at-creation/cli.ts decide --source linear --judged entry=AFK@0.97`.

  Verify that scope is reported as derived from the configured Linear rule and that `decide` prints both labels under `apply`.

## 3. Eval suite and RED baseline, before the skill exists

- [x] 3.1 Add `plugins/autonomous/evals/results/` to `.gitignore`. Scaffold the seven cases of design D4 with `claude plugin eval init --bare <case>`. Write each prompt as a user would type it, without naming the skill. Give each case the graders D4 requires:
    - a result grader on the attempted create command;
    - a helper-ran grader on `label-at-creation/cli.ts`;
    - for the two negative cases, `tool_used: Skill` with `min: 0`, `max: 0` and `arm: both`.

  Verify that a dry load (`claude plugin eval plugins/autonomous --ablation none --runs 1 --max-cost-usd <small>`) reports no case that failed to load, and that `bun run lint:markdown` and `lint:oxfmt` pass on the eval files.
- [x] 3.2 Answer both open questions of the design with one temporary probe case (`--runs 1`, `--ablation none`, `--max-cost-usd` set; the case is deleted afterwards). The questions: can the helper run from the plugin under the real home directory, and can a `scaffold_script` seed `$HOME/.config/autonomous/config.json`?
    - If the plugin root is unreadable, add a documented staging command (copy the plugin outside the home directory) and use it for every later run.
    - If seeding works, add a case with a seeded configuration in which scope is derived by the Linear rule end to end.

  Verify that both answers and the chosen run command are recorded in `design.md` (moved from Open Questions to Context) and in `evidence/eval-log.md`.
- [x] 3.3 Document the eval suite in the README: the run command with its `--allow-tools` grants, `--max-cost-usd`, the pinned `--model`, why the suite is local and not in CI, and why an errored run counts as a failure. Verify that `bun run lint:markdown` passes.
- [x] 3.4 RED: run the suite with the plugin as it is (no skill), with the pinned model and a cost ceiling. Record per case in `openspec/changes/add-label-at-creation-skill/evidence/eval-log.md` the attempted create commands and final messages verbatim, the scores and the cost. Verify that every positive case fails its result grader in both arms and that no run ended with `error`. A case that passes without the skill tests nothing, so rewrite or drop it before continuing.

## 4. Skill, GREEN and REFACTOR

- [x] 4.1 Load `plugin-dev:skill-development`, `mattpocock-skills:writing-for-agents` and `superpowers:writing-skills`. Then write `plugins/autonomous/skills/labelling-new-tasks/SKILL.md` as D3 describes, addressing only the failures recorded in 3.4:
    - frontmatter with `name`, a "Use when…" `description` with no workflow summary, and `allowed-tools` for the helper;
    - a positive-recipe body with the per-tool label-flag table;
    - no restated label meanings.

  Verify that `claude plugin validate --strict plugins/autonomous` passes and that `description` plus any `when_to_use` stays under 500 characters.
- [x] 4.2 Update the description in `plugins/autonomous/.claude-plugin/plugin.json`, `plugins/autonomous/package.json` and the plugin's entry in `.claude-plugin/marketplace.json` identically to mention the skill. Add the skill's trigger and its asking and no-asking behaviour to the README section from 2.3. Verify that `bun run lint:marketplace` and `lint:markdown` pass and that no version changed.
- [x] 4.3 GREEN: run the full suite with the baseline arm. Verify that:
    - every case reaches the threshold in the with-arm;
    - `Δ` is positive on every positive case;
    - the `tool_used: Skill` indicator passes on every positive case;
    - the negative cases never invoke the skill;
    - no run ended with `error`.

  Record the scores, `Δ` and cost in `evidence/eval-log.md`.
- [x] 4.4 REFACTOR: classify each failing run as a trigger, body, or grader/judge failure. Fix a trigger failure in the description and a body failure in the body. Try `--judge-model sonnet` before blaming the skill for a noisy `llm` grader. Add a rationalisation table and red flags only if a run shows an agent knowing the contract and skipping it. Add the Beads-with-parent case if inherited labels were a gap. Re-run until 4.3 holds. Verify that every change and the final run are recorded in `evidence/eval-log.md`.

## 5. Audit

- [x] 5.1 Record the always-on token cost with `claude --plugin-dir plugins/autonomous plugin details autonomous`, against the about 49 tokens of the `run` command alone. Verify that the delta the skill adds is recorded in `evidence/eval-log.md`.
- [x] 5.2 Dispatch the `plugin-dev:skill-reviewer` agent on the skill. Fix or answer each finding, and re-run the eval cases affected by any change to `SKILL.md`. Verify that each finding, its resolution and the re-run scores are recorded in `evidence/eval-log.md`.
- [x] 5.3 Walk the applicable items of the `superpowers:writing-skills` checklist: description form and keywords, word count with `wc -w`, no narrative, and a quick-reference table. Verify that the checklist result is recorded in `evidence/eval-log.md`.

## 6. Interactive check (HITL, with the user)

- [x] 6.1 In a real interactive session with `claude --plugin-dir plugins/autonomous` and the full skill listing, confirm with `/context` or `/doctor` that the skill's description is listed. Then ask for a Beads task whose entry is unclear. Verify that the entry question appears before `bd create` and that the answer lands on the created task. Delete the test task with `bd delete` and record the excerpt in `evidence/eval-log.md`.

## 7. Integration

- [x] 7.1 Run the full toolchain (`bun run lint:oxfmt`, `lint:eslint`, `lint:markdown`, `lint:knip`, `lint:fallow`, `lint:marketplace`, `lint:types`, `test`), then `openspec validate add-label-at-creation-skill --strict` and the CI pin `bunx @fission-ai/openspec@1.11.0 validate --changes --no-interactive`. Verify that all pass.
- [x] 7.2 After the user confirms, update Linear DOT-103's status section with what shipped and a pointer to `evidence/eval-log.md`, and DOT-82's "Where the next refinement should resume", through the `linear` CLI. Verify with `linear issue view DOT-103 --json` that the new status is present.
