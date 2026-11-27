## Why

A build of the autonomous plugin cannot start once another build has used, on the same state and trackers, a stage it does not know. `main` rejects the attempt record `linear:DOT-121:code-review:1`, written by the code review branch (DOT-164): `$.stage must be one of test, grill-me, proposal, implement, verify (got "code-review")`. Reconcile reads every record, so one it cannot parse stops every run. A stage label outside the contract fails more quietly: DOT-121 now carries `external-review`, which `main` does not read as a stage label, so label triage would judge the task again. The stages still to come cannot be developed and tried on real tasks while the released build keeps running. This change (DOT-171) declares them all, with no implementation behind them.

## What Changes

- **Four new stage labels**, after `code-review` and in this order: `qa` (`#0d9488`), `external-review` (`#8b5e3c`, the colour the code review branch already bootstrapped), `wrap-up` (`#64748b`) and `ready-to-merge` (`#15803d`). They enter the contract, the judgement criteria and the bootstrap before the stages that consume them exist, as `verify` and `code-review` did.
- **Four new stage ids**: `code-review`, `qa`, `external-review` and `wrap-up` join the stages an attempt may name, so the records of a build that implements one parse in a build that does not. `ready-to-merge` is a stage label only: no agent works there, the task waits for a person to merge its pull request, so no attempt names it.
- **Nothing is launched for them.** No implementation is registered. Selection excludes a task in any of the five as an unsupported stage, as it does today for `code-review`, and a supplied task in one makes `launch` wait with `<source>:<id> is excluded: unsupported stage`. `launch` also keeps its own guard, which waits with `stage <id> has no implementation` for a declared stage without one. Both behaviours exist; they now cover the new labels.
- **Reconcile leaves their attempts to the build that runs them.** A build cannot check a stage it has no implementation for, so it only observes such an attempt, whatever its session reports: it never retains or finalises it, and the build that implements the stage finishes it.
- **Transitions do not change.** The only way into a stage with no implementation stays `verify → code-review`. Each stage brings its way out when it is implemented.
- **Label triage** offers `AFK` and `HITL`, never `grill-me`, for a task in any of the new stages, as for every stage after `grill-me`.
- **Docs.** The glossary gains **Wrap-up** ("the stage that follows external review and precedes the merge; it does not exist yet") and the new stage label list; the README's label contract, selection and upgrade notes name the new labels.
- **Release.** A `feat(autonomous):` minor, with no configuration change. `--bootstrap-labels` must run once per tracker to create `qa`, `wrap-up` and `ready-to-merge`, and `external-review` where the code review branch has not created it.

**Out of scope**:

- Implementing any of the stages (DOT-164, DOT-157; QA and wrap-up have no task yet), and deciding what wrap-up does.
- Transitions out of a stage with no implementation.
- A `finished` label: a finished task is told by its state in the tracker.
- Mapping stage labels to tracker states (DOT-172).
- Tolerating attempt records of a stage no build declares.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `label-contract`: the stage group, the meanings, the spellings and the colours gain `qa`, `external-review`, `wrap-up` and `ready-to-merge`.
- `label-triage`: the autonomy decision of a task in any stage after `grill-me` is `AFK` or `HITL`.
- `stage-sessions`: an attempt may name every declared stage, a declared stage with no implementation makes `launch` wait, and reconcile only observes an attempt of such a stage.
- `work-selection`: the next stage may be any of the nine stage labels; the supported ones do not change.

## Impact

- `plugins/autonomous/src/label-contract/contract.ts`, `src/stages/stage.ts`, `src/label-triage/criteria.md`, and the tests that list the contract's labels.
- `plugins/autonomous/GLOSSARY.md` and `README.md`.
- The code review branch (DOT-164) rebases over this change: both edit the stage label list and the stage ids.
- Trackers: four labels to bootstrap. Nothing writes them until a stage that reaches them is implemented or a person sets one by hand.
