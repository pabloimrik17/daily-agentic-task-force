# Spec Delta

## MODIFIED Requirements

### Requirement: The launch step

`/autonomous:run` SHALL run a `launch` step last, after `select`. It SHALL take the selected work unit and, before anything else, check that the stage has an implementation, that a repository is inferred, that the stage's prerequisites hold for the task and that repository, that the task read again from its tracker carries no `taken`, and that no attempt of the task is open. A failed precondition SHALL make the step `wait` with that reason. Without `--apply` the step SHALL report what it would launch and `advance`.

#### Scenario: Stage without implementation

- **WHEN** the selected unit's stage has no stage implementation registered
- **THEN** the step is `wait` with a reason naming the stage

#### Scenario: Prerequisite not met

- **WHEN** the selected unit's stage is registered and one of its prerequisites fails
- **THEN** the step is `wait` with the prerequisite's reason, and no record, label, prompt or session is written

#### Scenario: Prerequisite about the repository

- **WHEN** a stage's prerequisite needs something in the task's repository and the repository lacks it
- **THEN** the step is `wait` with a reason naming the repository and what it lacks, and nothing is written

#### Scenario: No repository inferred

- **WHEN** no repository is inferred for the task
- **THEN** the step is `wait` with that reason, and the stage's prerequisites are not checked

#### Scenario: Taken since selection

- **WHEN** the task read again carries `taken`
- **THEN** the step is `wait` and nothing is launched

#### Scenario: Dry run

- **WHEN** the run is invoked without `--apply` and every precondition holds
- **THEN** the step reports the task, stage, repository and branch it would use, writes nothing and is `advance`
