## Why

A task whose proposal is approved carries `implement` and stops there: selection excludes it as an unsupported stage, so someone implements every proposal by hand. When one agent implements a whole proposal, its context fills well past the point where its work stays reliable, and every part of the work runs on the same model and effort however simple it is. This change registers the implementation stage (DOT-139), whose session orchestrates the work across teammates and ends with the task ready to verify.

## What Changes

- **A new stage label, `verify`** (colour `#d6409f`, distinct from every other contract label): the task is implemented and ready to verify against its proposal. It enters the contract and the bootstrap before the stage that consumes it exists, as `implement` did. Selection treats it as an unsupported stage.
- **The implementation stage is registered** (id and label `implement`, emoji 🛠️), for the `claude` tool only, with `--model opus --effort high`. Selection supports `implement`, so selected and supplied `implement` units launch, and an `implement` candidate is preferred over `proposal` and `grill-me` ones.
- **Prerequisites**, each failure a `wait` with its reason: the tool is `claude`; the task has exactly one autonomy; the repository has an OpenSpec root, the `openspec` CLI runs, and the repository provides the apply and update workflows, as OpenSpec 2 skills (`openspec-apply-change`, `openspec-update-change`) or OpenSpec 1 commands (`/opsx:apply`, `/opsx:update`), found by the workflow check proposal preparation already uses (`stages/openspec-workflows.ts`); the `handoff` skill is found; the task's context is read; the workspace branch has an open pull request; and that pull request adds exactly one active OpenSpec change.
- **The prompt.** The agent is the orchestrator of the apply workflow on the change, named as the repository provides it.
    - It first resumes what an earlier attempt left: checked tasks, commits, and uncommitted changes, which it finishes and commits rather than discards.
    - It delegates the work to as many teammates as it sees fit, each with the model and the effort its block needs, any level from the cheapest up, so that its own context stays under about 30%. The prompt states this as intent, not as mechanics. Teammates are Claude only.
    - A deviation from the proposal is made with the update workflow and recorded in the change's design, the stage summary and the logbook entry; an `AFK` orchestrator decides it, an `HITL` one asks.
    - Only the orchestrator commits: one conventional commit per coherent unit of work, in the repository's conventions, with a scope in a monorepo and a breaking marker only when the proposal declares one, with the task checkboxes in the same commit, and a push after each commit.
    - Every check the repository defines passes before the transition.
    - The closing order is proposal preparation's without pull-request mode: the `HITL` review, the stage summary and persist mode, the transition, the logbook entry with a `### Implementation` section, the result marker. The pull request stays a draft.
    - A blocked `AFK` orchestrator pushes what is done, persists a stage summary that explains the blocker, publishes a logbook entry, makes no transition and writes no result marker.
- **Persist mode serves this stage too**, posting only the stage summary, as for `proposal`.
- **The transition out of `implement`** to `verify`: applied with no answer for an `AFK` task, on the human's approval for an `HITL` task (ADR 0004 is widened). Transition mode and answer mode refuse it while the change has unchecked tasks, the workspace has uncommitted changes, or the branch has unpushed commits.
- **Completion check.** The stage is complete when the task carries `verify` and no `implement`, or is closed.
- **Docs.** The README covers the stage; the glossary already gains Implementation, Verification, Orchestrator and Teammate on this branch; ADR 0004 covers both transitions without an answer.
- **Release.** A `feat(autonomous):` minor, with no configuration change. `--bootstrap-labels` must run once per tracker to create `verify`.

**Out of scope**:

- The verification stage itself, and archiving the change: `verify` stays unsupported in selection.
- Watching the orchestrator's context and handing over to a fresh session (DOT-138).
- Codex teammates (DOT-140).
- A selected task whose prerequisites fail holding the loop (DOT-141).
- Stacked pull requests for one implementation (DOT-136), and choosing model and effort per task (DOT-119).

## Capabilities

### New Capabilities

- `implementation-stage`: the implementation stage as a stage implementation. It covers its identity and agent arguments, its prerequisites, the prompt (resumption, orchestration, deviations, commits, the gate), its closing order per autonomy, its stage summary, and its completion check.

### Modified Capabilities

- `label-contract`: the stage group gains `verify`, with its meaning, spelling and colour, and a third transition, from `implement` to `verify`, which an `AFK` task makes without a human's answer.
- `work-selection`: `implement` becomes a supported stage and `verify` an unsupported one, and `implement` is the most advanced stage.
- `autonomous-run`: transition mode, the approval question and transition answers handle a task in `implement`, with the guards on the change's tasks, uncommitted changes and unpushed commits; persist mode accepts an `implement` attempt; the receipt check covers the stage.
- `label-triage`: a task in `verify` without an autonomy label is decided between `AFK` and `HITL` only, as one in `proposal` or `implement` is.

## Impact

- **Code** (`plugins/autonomous/src/`):
    - the contract: `label-contract/contract.ts`;
    - the stage ids and the registry: `stages/{stage,registry}.ts`;
    - the new stage: `stages/implement/` (stage, prompt, prerequisites);
    - selection: `select/stage.ts`;
    - the transition and its guards: `transition/{mode,answer,receipt}.ts` and a new guard module;
    - persist mode: `persist/`;
    - the tests next to each of these.
- **Plugin files**: `README.md`, `GLOSSARY.md` (already edited), `docs/adr/0004-…`, `commands/run.md`.
- **Runtime dependencies**: the `openspec` CLI, `git`, `gh`, and a task repository whose OpenSpec setup provides the apply and update workflows.
- **Builds on** the OpenSpec 2 support of #99: this change reuses its workflow check for `apply` and `update`.
- **Trackers**: the stage posts one comment on its task and replaces `implement` with `verify`. `verify` must exist on Linear and GitHub before the first transition.
- **Repositories**: the stage commits and pushes the implementation, and the change's updated artifacts, on the task's workspace branch, in its existing draft pull request.
