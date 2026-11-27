# Spec Delta

## MODIFIED Requirements

### Requirement: An attempt

An attempt SHALL be one launch of a managed session for one stage of one task, identified as `<source>:<task>:<stage>:<n>`, where `n` counts the attempts of that task and stage from 1. Its record SHALL hold the task, the stage, the attempt number, its state, the time of each state change, the workspace, the session, whether `taken` was added and removed, the last observation, and any retention or pending cleanup. The record SHALL be kept outside every tracker and outside the workspace. The stages an attempt MAY name SHALL be `test` and every stage the system declares, registered or not: `grill-me`, `proposal`, `implement`, `verify`, `code-review`, `qa`, `external-review` and `wrap-up`. A record of a declared stage SHALL be read whether or not the running build registers an implementation for it. `ready-to-merge` is a stage label only and no attempt names it.

#### Scenario: Second attempt of a stage

- **WHEN** Linear `DOT-109` was attempted once for `grill-me` and is launched again for it
- **THEN** the new attempt is `linear:DOT-109:grill-me:2`

#### Scenario: Record outside the workspace

- **WHEN** an attempt is launched for a task whose worktree is `/w/repo-worktrees/feature-DOT-109`
- **THEN** no file of the attempt is written under that worktree

#### Scenario: Record of a stage this build does not implement

- **WHEN** the state holds the record `linear:DOT-121:code-review:1`, written by a build that implements code review, and a build that only declares `code-review` reads the attempts
- **THEN** the record is read and the run goes on

#### Scenario: Record naming ready-to-merge

- **WHEN** a record names the stage `ready-to-merge`
- **THEN** it does not match the attempt schema

### Requirement: Stage contract

A stage SHALL declare: its id, its emoji, its prerequisites, its prompt for a task, its agent arguments, and its completion check against the task's tracker. A stage's prerequisites SHALL be checked by `launch` before anything is written, and what they read at launch MAY be given to its prompt. A stage SHALL be launchable only when an implementation is registered for its id: a declared stage with none makes `launch` wait, saying the stage has no implementation. Registering a stage SHALL require no change to `reconcile` or `launch`.

#### Scenario: Stage registered later

- **WHEN** an implementation for `grill-me` is registered
- **THEN** `launch` can launch `grill-me` units without any change to the steps

#### Scenario: Stage without prerequisites

- **WHEN** the `test` stage is launched
- **THEN** its prerequisites hold without any check

#### Scenario: Supplied task in a stage with no implementation

- **WHEN** a task is supplied with `--task` and carries `qa`, which is declared and has no implementation
- **THEN** `launch` waits with `<source>:<id> is excluded: unsupported stage` and writes nothing

#### Scenario: Declared stage without implementation reaches launch

- **WHEN** `launch` is reached with the declared stage `qa`, which has no implementation
- **THEN** `launch` waits with `stage qa has no implementation` and writes nothing

### Requirement: Retained attempts

When a `started` attempt's session is `exited` or `gone` and the stage is not completed, the attempt SHALL be marked `retained`, with the reason and the time, and the last lines of the session captured into the attempt directory when the session still exists. A retained attempt SHALL keep `taken`, keep its session, and SHALL NOT be retried, relaunched or removed by any run. Every run SHALL list it until the user discards it. An attempt of a stage the running build registers no implementation for SHALL NOT be retained or finalised by that build, whatever its session reports: it is only observed, so the build that implements the stage can still finish it.

#### Scenario: Session exited without result

- **WHEN** the session of a started attempt reports `stopped` and no valid marker exists
- **THEN** the attempt reads `retained`, its capture file exists, and the task still carries `taken`

#### Scenario: Retained attempt on later runs

- **WHEN** a run reconciles a retained attempt
- **THEN** it is listed in the report and nothing changes

#### Scenario: Ended session of a stage this build does not implement

- **WHEN** the session of the started attempt `linear:DOT-121:code-review:1` reports `stopped` or is gone, a valid marker exists, and the running build registers no implementation for `code-review`
- **THEN** the attempt stays `started` and is reported as observed, nothing is captured or removed, and the task still carries `taken`
