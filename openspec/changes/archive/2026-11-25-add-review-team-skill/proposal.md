## Why

The code review stage (DOT-164) needs a procedure for the report of its adversarial review: several reviewers, each from its own angle, whose findings arrive in one shape that a finding triage can work with. The user's `/review-team` command had that idea, but it lives outside the plugin, returns free text, and no longer works. Its `/verify` reviewer cannot be invoked by a model. Its `/code-review` reviewer runs the CodeRabbit skill that shadows the built-in of the same name. And the official `code-review:code-review` plugin it starts stops on draft pull requests, which is all the code review stage will ever see. This change (DOT-163) ships the review team as a skill of the autonomous plugin, usable by hand in any repository, before the stage that will use it.

## What Changes

- **A new skill, `autonomous:review-team`**: the review team of a subject, which is the current branch against its base. It applies only when it is asked for by name, as the adversarial review does. It only reports: it never triages, merges findings by root cause, refutes, fixes or publishes anything. By hand, it writes the report to a directory and summarises it in the chat.
- **The reviewers**, each a registry entry with an angle and an engine:
    - **walkthrough** (comprehension, Claude): drafts the walkthrough of the change as a Plannotator guide and reports what it cannot explain;
    - **built-in `/code-review`** (correctness, at a level set by the tier);
    - **Codex** (correctness from another model family, `codex exec review`, whose text a parser reads);
    - **CodeRabbit CLI** (what the CodeRabbit bot would say, earlier);
    - **`fallow-review`** (structure: boundaries, public API, dependencies; TypeScript and JavaScript repositories only);
    - **tests and silent failures** (a lens of the plugin's own);
    - **built-in `/security-review`** (security, when the change touches a sensitive surface).
- **Review tiers.** Code measures the change's diff and sets its tier, `S`, `M` or `L`. The tier decides which reviewers run and with what model, effort and level. A security trigger, from paths and added lines, adds the security reviewer at any tier. A caller may raise the tier, giving a reason, and is refused when it tries to lower it.
- **The reviewer contract.** Every finding is validated at run time against the versioned schema `autonomous.finding.v1`. A tool that emits JSON has a parser. A skill or prompt reviewer emits the schema itself, through its teammate. Each reviewer's own severity becomes `CRITICAL`, `WARNING` or `SUGGESTION` through a fixed table in code, never by judgement.
- **A reviewer that cannot run is skipped and recorded**: an unavailable tool, a missing login, a rate limit, a shadowed skill, or output that fails the schema. The report names who ran, who did not and why. Only the Claude reviewers are required.
- **Doubts** are reported apart from findings: what a reviewer cannot judge without knowing the intent. **Exact duplicates** (same place, same title) are grouped, keeping every reporter.
- **A deterministic CLI**, `src/review-team/cli.ts`, that the skill calls to plan the team, run the CLI reviewers and collect the report. Code before LLM.
- **An optional `review` configuration block** with shipped defaults: the tier thresholds, the reviewers per tier with their model, effort and level, and the security trigger patterns. With no configuration file at all, the skill uses the shipped defaults, so it works in a repository that never set up the loop.
- **Calibration.** One run of the full team (`L`) on the commit before ready-for-review of five merged pull requests of this repository. It measures, per reviewer, the share of the bot findings the user accepted that it would have caught, its unique findings, and its cost and time. The shipped tier table is set from that run.
- **Docs.** A README section for the skill. The glossary terms (**Reviewer**, **Review team**, **Review tier**, **Doubt**, **Walkthrough**, **Finding thread**, **External review**) and ADR 0008 are already on this branch.
- **Release.** A `feat(autonomous):` minor, with no required configuration change.

**Out of scope**:

- The finding triage, refutation, fixes and publishing to the pull request: the code review stage (DOT-164).
- The hybrid tier decision, in which a model's opinion joins the measure (DOT-158).
- Greptile's CLI as a registry reviewer. The calibration measures it on the same pull requests, and a follow-up adds it if its quota is separate from the pull request app's and it earns a place.
- Picture it (DOT-159).
- These as reviewers: the official `code-review:code-review` plugin, `/simplify` (it edits code), `/verify` and expect (they run the change, which is QA's job), and the review skills of mattpocock-skills and superpowers (their spec axis is verification's).
- Codex as a teammate that fixes (DOT-140).

## Capabilities

### New Capabilities

- `review-team`: the review team skill. It covers its subject, its reviewers and their contract, review tiers, the finding and report schemas, skipped reviewers, doubts and the CLI that plans, runs and collects a review.

### Modified Capabilities

- `label-contract`: the user configuration file gains the optional `review` block, with shipped defaults, alongside `sessions`, `workspace`, `naming` and `runner`.

## Impact

- **New code:**
    - `plugins/autonomous/skills/review-team/SKILL.md` and its lens prompt;
    - `plugins/autonomous/src/review-team/` (schema, tiers, registry, severity tables, adapters, availability checks, CLI) and its tests with recorded fixtures;
    - eval cases `plugins/autonomous/evals/review-team-named` and `review-team-negative`.
- **Changed code:**
    - `plugins/autonomous/src/config.ts`, `config.defaults.json` and `config.example.json`, for the `review` block;
    - `plugins/autonomous/README.md`.
- **External tools**, each optional at run time:
    - `codex`, `coderabbit` and `fallow`;
    - `plannotator`, for the walkthrough guide;
    - the built-in `/code-review` and `/security-review` of Claude Code.

  The built-in `/code-review` is reachable only once the dotfiles stop installing a skill named `code-review` (DOT-162). Until then that reviewer is skipped as shadowed.
- **No change** to the loop, the stages, the label contract's labels or any tracker.
