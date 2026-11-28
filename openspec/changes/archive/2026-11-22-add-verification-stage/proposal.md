## Why

A task whose implementation ends carries `verify` and stops there: selection treats `verify` as an unsupported stage, so a person checks every implementation against its proposal by hand, as on pull request #100. Nothing checks that the code matches the proposal and the task's definition before anyone reviews its quality. This change registers the verification stage (DOT-149), the first of the review stages, and the adversarial review that it and the later review stages share.

## What Changes

- **A new stage label, `code-review`** (colour `#a3e635`, distinct from every other contract label): the task is verified and ready for code review. It enters the contract and the bootstrap before the stage that consumes it exists, as `verify` did. Selection treats it as an unsupported stage. `qa` is not added yet.
- **The verification stage is registered** (id and label `verify`, emoji 🔍), for the `claude` tool only, with `--model opus --effort high`. Selection supports `verify`, so selected and supplied `verify` units launch, and a `verify` candidate is preferred over every `implement`, `proposal` and `grill-me` one.
- **Prerequisites** are the implementation stage's, with the verify workflow in place of the apply one: the repository provides the verify and the update workflows, as OpenSpec 2 skills (`openspec-verify-change`, `openspec-update-change`) or OpenSpec 1 commands (`/opsx:verify`, `/opsx:update`); the workspace branch has an open pull request that adds exactly one active change.
- **What it checks.** The implementation against the proposal, with the repository's verify workflow run as it is, and against the acceptance criteria and non-goals of the task's definition. A deviation already recorded in the change's design counts as the proposal's word, not a finding.
- **How it corrects: the adversarial review**, a new skill of the plugin (`autonomous:adversarial-review`) whose body the stage inlines into its prompt. One round of:
    - **report**: a read-only teammate reports findings with their evidence;
    - **finding triage**: the orchestrator merges and splits the findings and sends each to fix, pass on (a later review stage), defer (a follow-up task) or dismiss, with a reason, never changing a severity;
    - **refutation**: other teammates try to refute each fix and defer finding; one survives only with its reproduction;
    - **fix**: a teammate fixes each surviving fix finding; the orchestrator commits each fix on its own;
    - **fix check**: other teammates judge each fix against its finding and reproduction.

    Nobody judges their own work, a critical finding is fixed unless refuted, and a fix rejected twice blocks an `AFK` task and goes to the human for an `HITL` one.
- **Which way a fix goes.** Code is brought to the proposal, unless the proposal is the one that is wrong: then it is updated with the update workflow and the deviation recorded. A proposal that contradicts the definition, with no recorded deviation, yields to the definition for `AFK`; the human decides for `HITL`.
- **Boundary.** The stage does no deeper code review and does not run what the task delivers as its end user would: those are code review and QA. A finding that belongs to them is passed on in the stage summary. After the fixes, every check the repository defines passes.
- **Deferred findings** are proposed as follow-up tasks in the stage summary and the logbook entry. For `HITL`, the human picks which to create, and the agent creates them as related tasks, never subtasks. An `AFK` session creates none.
- **The closing order** is the implementation's: the checks and commits, the `HITL` review, the stage summary and persist mode, the transition, the logbook entry with a `### Verification` section, the result marker. The blocked path and the guards on leaving are the implementation's too. The pull request stays a draft.
- **Persist mode serves this stage**, posting only the stage summary.
- **The transition out of `verify`** to `code-review`: applied with no answer for an `AFK` task, on the human's approval for an `HITL` task (ADR 0004 is widened), and refused while the change has unchecked tasks, the workspace has uncommitted changes, or the branch has unpushed commits.
- **Completion check.** The stage is complete when the task carries `code-review` and no `verify`, or is closed.
- **The implementation prompt is revised** so its responsibilities do not overlap with the review stages: verification, code review, QA and archiving belong to later stages, and the orchestrator ignores the apply workflow's suggestion to verify or archive. Its `HITL` review becomes a quick look for anything that jars, and fixes only what the human clearly asks for.
- **Docs.** The README covers the stage and the adversarial review; the glossary already gains the review stages, the adversarial review and their terms on this branch; ADR 0004 covers the third transition without an answer; ADR 0007, already on this branch, records the order of the review stages.
- **Release.** A `feat(autonomous):` minor, with no configuration change. `--bootstrap-labels` must run once per tracker to create `code-review`.

**Out of scope**:

- The code review and QA stages, and the `qa` label.
- Archiving the change (DOT-147).
- Repeating the adversarial review until nothing worth fixing remains (DOT-148).
- Keeping the checks that need a human out of an `AFK` proposal's tasks (DOT-143).
- A bounded context of its own for the adversarial review: its terms stay in the autonomous glossary until the skill has a boundary of its own.

## Capabilities

### New Capabilities

- `verification-stage`: the verification stage as a stage implementation. It covers its identity and agent arguments, its prerequisites, the prompt (what it checks, the boundary, the direction of a fix, resumption, commits), its closing order per autonomy, its stage summary, its follow-up tasks and its completion check.
- `adversarial-review`: the adversarial review as a skill of the plugin: its phases, the independence of who judges, the finding triage and its outcomes, the reproduction, the severity floor, the bound on a rejected fix, the record of the findings, and how a caller parametrises it.

### Modified Capabilities

- `label-contract`: the stage group gains `code-review`, with its meaning, spelling and colour, and a fourth transition, from `verify` to `code-review`, which an `AFK` task makes without a human's answer.
- `work-selection`: `verify` becomes a supported stage and `code-review` an unsupported one, and `verify` is the most advanced stage.
- `autonomous-run`: transition mode, the approval question and transition answers handle a task in `verify`, with the guards on leaving it; persist mode accepts a `verify` attempt; the receipt check covers the stage.
- `label-triage`: a task in `code-review` without an autonomy label is decided between `AFK` and `HITL` only.
- `implementation-stage`: the prompt names the later stages and their responsibilities, and its `HITL` review becomes a quick look.

## Impact

- **Code** (`plugins/autonomous/src/`):
    - the contract: `label-contract/contract.ts`;
    - the stage ids and the registry: `stages/{stage,registry}.ts`;
    - the new stage: `stages/verify/` (stage, prompt, prerequisites);
    - the shared stage pieces: `stages/openspec-stage.ts`, `stages/openspec-workflows.ts`, and a loader for the plugin's own skills;
    - the implementation prompt: `stages/implement/prompt.ts`;
    - selection: `select/stage.ts`;
    - the transition and its guards: `transition/{mode,receipt,guards}.ts`;
    - persist mode: `persist/persist.ts`;
    - the tests next to each of these.
- **Plugin files**: `skills/adversarial-review/SKILL.md` (new), `README.md`, `GLOSSARY.md` (already edited), `docs/adr/0004-…`, `commands/run.md`.
- **Runtime dependencies**: the `openspec` CLI, `git`, `gh`, and a task repository whose OpenSpec setup provides the verify and update workflows.
- **Trackers**: the stage posts one comment on its task and replaces `verify` with `code-review`; for an `HITL` task it may create follow-up tasks the human confirmed. `code-review` must exist on Linear and GitHub before the first transition.
- **Repositories**: the stage commits and pushes its fixes, and the change's updated artifacts, on the task's workspace branch, in its existing draft pull request.
