## Why

A task whose grill is over, or that needed none, carries `proposal` and stops there: selection excludes it as an unsupported stage, so the loop never turns a definition into something an agent can implement. This change registers proposal preparation, the stage that writes a task's proposal with OpenSpec and commits it in the task's draft pull request. It is the second of two changes: `add-stage-pull-request-and-logbook` supplies the pull request and the logbook this stage uses.

## What Changes

- **A new stage label, `implement`** (colour `#26b5ce`): the task has a proposal and is ready to implement. It enters the contract and the bootstrap before the stage that consumes it exists, as `proposal` did. Selection treats it as an unsupported stage.
- **Proposal preparation is registered** (id and label `proposal`, emoji 📝), for the `claude` tool only, with `--model opus --effort high`. Selection supports `proposal`, so selected and supplied `proposal` units launch.
- **Prerequisites.** The tool is `claude`; the task's repository has an OpenSpec root and the `openspec` CLI is on the path; the `handoff` skill of `mattpocock-skills` is found. A failed prerequisite makes launch `wait` with the reason. Nothing ever initialises OpenSpec in a repository.
    - Launch now infers the repository before it checks a stage's prerequisites, so a prerequisite can look at it.
- **The run gathers the task's context in code** and writes it into the prompt, one level deep: the description, every comment, the parent with its description, and the children, blockers, blocked tasks, related tasks and duplicates with their id, title, state and URL, plus the Linear project, attachments and linked pull requests. Nothing is fetched beyond that level; the agent opens what it needs.
- **The prompt.** The agent runs `/opsx:propose` with that context, and OpenSpec names the change. It writes one proposal and never splits the task.
    - An `AFK` agent asks nothing: it decides, and records each assumption in the proposal's design, the stage summary and the logbook entry.
    - An `HITL` agent may ask, shows the proposal when it is written and iterates on the human's feedback.
    - The closing order is: commit and push the proposal; pull-request mode; the `HITL` review; the stage summary and persist mode; the transition; the logbook entry; the result marker.
    - A new attempt continues the OpenSpec change and the pull request that already exist.
- **Persist mode serves this stage too.** For a `proposal` attempt it posts only the stage summary as a comment, leaves the description alone and writes the receipt.
- **The transition out of `proposal`** (ADR 0004). `--transition` on a task in `proposal` waits for the persistence receipt of its open attempt. For an `AFK` task it applies the transition to `implement` at once, with no question. For an `HITL` task it asks `Approve` or `Later`, and the answer applies it.
- **A blocked `AFK` agent** makes no transition and writes no result marker. It persists a stage summary that explains the blocker, publishes a logbook entry when the pull request exists, and ends; the attempt is retained.
- **Completion check.** The stage is complete when the task has `implement` and no `proposal`, or is closed.
- **The parent of a split is never proposed.** A task in `proposal` that has, or has had, subtasks is excluded as split. When all of them are closed, the selection report lists it as ready to close. The loop never closes it.
- **Docs.** The README covers the stage; the glossary gains Proposal preparation and Proposal and updates Stage label and Transition; ADR 0004 records the transition without an answer.
- **Release.** A `feat(autonomous):` minor, with no configuration change. `--bootstrap-labels` must run once per tracker to create `implement`.

**Out of scope**:

- The implement stage: `implement` stays unsupported in selection.
- Stacked pull requests, closing the parent of a split, and a transition back to `grill-me`.
- Supporting `codex`, and choosing model and effort per task (DOT-119).
- Reading GitHub blockers (DOT-121): a GitHub task's context has no blockers.

## Capabilities

### New Capabilities

- `proposal-stage`: proposal preparation as a stage implementation. It covers its identity and agent arguments, its prerequisites, the context the run gathers for it, the prompt and its closing order per autonomy, how its stage summary is persisted, and its completion check.

### Modified Capabilities

- `label-contract`: the stage group gains `implement`, with its meaning, spelling and colour, and a second transition, from `proposal` to `implement`, which an `AFK` task makes without a human's answer.
- `work-selection`: `proposal` becomes a supported stage and `implement` an unsupported one; a task in `proposal` with any subtask, open or closed, is excluded as split; the report lists the parents that are ready to close.
- `autonomous-run`: transition mode handles a task in `proposal`, with its question, its answer and its receipt check, and persist mode accepts a `proposal` attempt.
- `stage-sessions`: launch infers the repository before it checks the stage's prerequisites, and passes it to them.
- `label-triage`: a task in `implement` without an autonomy label is decided between `AFK` and `HITL` only, as one in `proposal` is.

## Impact

- **Code** (`plugins/autonomous/src/`):
    - the contract: `label-contract/contract.ts`;
    - the stage contract, the registry and launch: `stages/{stage,registry}.ts`, `attempts/launch.ts`;
    - the new stage: `stages/proposal/` (stage, prompt, prerequisites, context rendering);
    - the context reads: `select/readers/{linear,beads,github}.ts` and their types;
    - selection: `select/{stage,candidates,render}.ts`;
    - the transition: `transition/{mode,answer,receipt}.ts`;
    - persist mode: `persist/persist.ts`;
    - the tests next to each of these.
- **Plugin files**: `README.md`, `GLOSSARY.md`, `docs/adr/0004-…`, `commands/run.md`.
- **Runtime dependencies**: the `openspec` CLI, and a task repository that already uses OpenSpec with its `/opsx:propose` command.
- **Trackers**: the stage posts one comment on its task and replaces `proposal` with `implement`. `implement` must exist on Linear and GitHub before the first transition.
- **Repositories**: the stage commits and pushes an OpenSpec change, and any glossary or ADR file it touched, on the task's workspace branch.
- **Ordering**: `add-stage-pull-request-and-logbook` must be implemented first; this change uses its modes and deltas none of its requirements.
