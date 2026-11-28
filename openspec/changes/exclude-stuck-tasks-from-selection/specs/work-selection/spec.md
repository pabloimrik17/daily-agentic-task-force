# Spec Delta

## ADDED Requirements

### Requirement: A task with an open attempt is excluded

A task that has an open attempt in the state directory, at any stage, SHALL be excluded as **open attempt**, after classification and before taken. The exclusion SHALL carry the attempt's id and state. It SHALL apply whether or not the task carries `taken`.

#### Scenario: Retained attempt

- **WHEN** `github:o/r#228:proposal:1` is retained and the task carries `personal`, `AFK` and `proposal`
- **THEN** the task is excluded as open attempt, with that attempt's id and `retained`

#### Scenario: Running attempt that also carries taken

- **WHEN** a task carries `taken` and its attempt is `started`
- **THEN** the task is excluded as open attempt, not as taken

#### Scenario: Discarded attempt

- **WHEN** the only attempt of a task is `discarded`
- **THEN** the task is not excluded as open attempt

#### Scenario: Attempt records cannot be read

- **WHEN** the attempt records cannot be read
- **THEN** the step is `not-evaluable` with the read error and no comparison is made

### Requirement: A task without a single repository is excluded

A task for which repository inference does not find exactly one repository SHALL be excluded as **repository**, after split and before no free slot. The exclusion SHALL carry the reason that `launch` would give: the signals that matched nothing, or the repositories that matched.

#### Scenario: No signal

- **WHEN** a Beads task carries only contract labels
- **THEN** it is excluded as repository, with the reason `no repository under the workspace root matches beads signals [none]`

#### Scenario: Signal that names no directory

- **WHEN** a Beads task carries `datf` and no directory under the workspace root is named `datf`
- **THEN** it is excluded as repository, and the reason lists `datf`

#### Scenario: Several repositories

- **WHEN** a Beads task carries `dotfiles` and `monolab`, and both are repositories under the workspace root
- **THEN** it is excluded as repository, and the reason names both

#### Scenario: Blocked task without a repository

- **WHEN** a task has an open blocker and no inferable repository
- **THEN** it is excluded as blocked, not as repository

#### Scenario: Workspace root cannot be read

- **WHEN** the workspace root cannot be listed
- **THEN** the step is `not-evaluable` with that error

### Requirement: A task whose repository fails a stage's repository prerequisites is excluded

A task whose inferred repository fails a repository prerequisite of the task's next stage SHALL be excluded as **repository prerequisites**, after repository and before no free slot, with the prerequisite's reason. The check SHALL be made once per stage and repository in a run.

#### Scenario: Repository without an OpenSpec root

- **WHEN** two tasks in `proposal` belong to a repository that has no OpenSpec root
- **THEN** both are excluded as repository prerequisites with the reason naming the repository, and the repository is checked once

#### Scenario: Grill in the same repository

- **WHEN** a task in `grill-me` belongs to a repository that has no OpenSpec root
- **THEN** it is not excluded as repository prerequisites

### Requirement: The chosen task's prerequisites are checked

After a choice, the step SHALL check the prerequisites of the chosen task's stage, as `launch` does. When they fail, the task SHALL be excluded as **prerequisites** with the prerequisite's reason, and the step SHALL choose again among the remaining candidates, applying the most-advanced-stage rule again. The step SHALL check at most 4 chosen tasks in a run. A prerequisite that cannot be read SHALL make the step `not-evaluable`.

#### Scenario: Second choice launches

- **WHEN** the chosen task's prerequisites fail and another candidate remains whose prerequisites hold
- **THEN** the first task is excluded as prerequisites, the second is selected, and the step is `advance`

#### Scenario: Less advanced stage after a failure

- **WHEN** the only `implement` candidate fails its prerequisites and two `proposal` candidates were set aside
- **THEN** the `implement` task is excluded as prerequisites and the choice is made between the two `proposal` candidates

#### Scenario: Choices run out

- **WHEN** four chosen tasks in a row fail their prerequisites
- **THEN** all four are excluded as prerequisites and no fifth choice is made

#### Scenario: Prerequisites cannot be read

- **WHEN** the chosen task's prerequisites fail as unreadable
- **THEN** the step is `not-evaluable` with that reason, the task is not excluded, and no other task is chosen

#### Scenario: Supplied stage

- **WHEN** the run is given `--task`
- **THEN** selection does not run, and `launch` alone checks the prerequisites

### Requirement: Prerequisites that failed earlier in the loop

In an iteration of the loop, a task that an earlier iteration of the same loop excluded as prerequisites SHALL have its prerequisites checked before the comparison, and SHALL be excluded as prerequisites while they still fail. Outside an iteration nothing SHALL be remembered.

#### Scenario: Still failing

- **WHEN** the previous iteration excluded a task as prerequisites and nothing about the task changed
- **THEN** this iteration excludes it as prerequisites before the comparison, and the comparison is not given it

#### Scenario: Fixed since

- **WHEN** the previous iteration excluded a task as prerequisites and its prerequisites now hold
- **THEN** the task is a candidate

#### Scenario: Cannot be read now

- **WHEN** the previous iteration excluded a task as prerequisites and its prerequisites now fail as unreadable
- **THEN** the step is `not-evaluable` with that reason

#### Scenario: Manual run

- **WHEN** `/autonomous:run` runs after a loop excluded a task as prerequisites
- **THEN** the task reaches the comparison unless another exclusion applies

### Requirement: Stuck tasks

An excluded task SHALL be a **stuck task** when its exclusion is repository, repository prerequisites or prerequisites, or open attempt with a retained attempt. No other exclusion SHALL make a task stuck. The step SHALL NOT write to any tracker because a task is stuck.

#### Scenario: Retained attempt

- **WHEN** a task is excluded as open attempt and the attempt is `retained`
- **THEN** the task is stuck

#### Scenario: Running attempt

- **WHEN** a task is excluded as open attempt and the attempt is `started`
- **THEN** the task is not stuck

#### Scenario: No free slot

- **WHEN** a task is excluded as no free slot
- **THEN** the task is not stuck

#### Scenario: No tracker write

- **WHEN** a run with `--apply` finds three stuck tasks
- **THEN** no label is added to or removed from any of them

### Requirement: Stuck tasks in the report

The text report SHALL list the stuck tasks apart from the other excluded tasks, each with its source, id, title, scope, exclusion and reason. The JSON data SHALL carry, for every excluded task, the reason text of its exclusion when there is one and whether the task is stuck.

#### Scenario: Stuck task in the text report

- **WHEN** Beads `X-12` is excluded as repository
- **THEN** the report lists it under the stuck tasks with the signals that matched nothing

#### Scenario: Stuck task in JSON

- **WHEN** the run is invoked with `--json` and a task is excluded as prerequisites
- **THEN** its entry carries the exclusion, the prerequisite's reason and that it is stuck

## MODIFIED Requirements

### Requirement: Outcome of the step

The step SHALL be `advance` when it selected a work unit, `wait` when there is no candidate or when every chosen task failed its prerequisites, and `not-evaluable` as the requirements above define. The tier SHALL be `llm` when the LLM was called, and `code` otherwise. When the step is `wait`, the reasons SHALL give the count of excluded tasks per exclusion reason.

#### Scenario: Nothing selectable

- **WHEN** every task is excluded, three as unsupported stage and one as taken
- **THEN** the step is `wait`, the run exits with code 2 and the reasons give 3 unsupported stage and 1 taken

#### Scenario: Every choice failed its prerequisites

- **WHEN** four chosen tasks in a row fail their prerequisites while other candidates remain
- **THEN** the step is `wait`, the reasons say that 4 choices failed their prerequisites and give the counts per exclusion reason, and the tier is `llm`
