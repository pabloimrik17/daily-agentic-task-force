## MODIFIED Requirements

### Requirement: The launch step

`/autonomous:run` SHALL run a `launch` step last, after `select`. It SHALL take the selected work unit and, before anything else, check that the stage has an implementation, that the stage's prerequisites hold, that the task read again from its tracker carries no `taken`, that no attempt of the task is open, and that a repository is inferred. A failed precondition SHALL make the step `wait` with that reason. Without `--apply` the step SHALL report what it would launch and `advance`.

#### Scenario: Stage without implementation

- **WHEN** the selected unit's stage has no stage implementation registered
- **THEN** the step is `wait` with a reason naming the stage

#### Scenario: Prerequisite not met

- **WHEN** the selected unit's stage is registered and one of its prerequisites fails
- **THEN** the step is `wait` with the prerequisite's reason, and no record, label, prompt or session is written

#### Scenario: Taken since selection

- **WHEN** the task read again carries `taken`
- **THEN** the step is `wait` and nothing is launched

#### Scenario: Dry run

- **WHEN** the run is invoked without `--apply` and every precondition holds
- **THEN** the step reports the task, stage, repository and branch it would use, writes nothing and is `advance`

### Requirement: Stage contract

A stage SHALL declare: its id, its emoji, its prerequisites, its prompt for a task, its agent arguments, and its completion check against the task's tracker. A stage's prerequisites SHALL be checked by `launch` before anything is written, and what they read at launch MAY be given to its prompt. A stage SHALL be launchable only when an implementation is registered for its id. Registering a stage SHALL require no change to `reconcile` or `launch`.

#### Scenario: Stage registered later

- **WHEN** an implementation for `grill-me` is registered
- **THEN** `launch` can launch `grill-me` units without any change to the steps

#### Scenario: Stage without prerequisites

- **WHEN** the `test` stage is launched
- **THEN** its prerequisites hold without any check
