# Spec Delta

## ADDED Requirements

### Requirement: Stuck task notices

Beside the notices that "Notices" lists, an iteration SHALL record one notice per stuck task of the machine scope that the loop has not yet told with that reason, as `stuck <source>:<id>: <reason>`. When more than five are new in one iteration, it SHALL record the first five and one more line with the count of the rest and where the full list is. A stuck task outside the machine scope SHALL NOT produce a notice.

#### Scenario: First time

- **WHEN** an iteration excludes `beads:X-12`, of the machine scope, as repository
- **THEN** one notice says `stuck beads:X-12:` followed by the reason

#### Scenario: Same task and reason in the next iteration

- **WHEN** the next iteration excludes `beads:X-12` for the same reason
- **THEN** no notice is recorded for it

#### Scenario: Reason changed

- **WHEN** `beads:X-12` gains a repository label and is then excluded as repository prerequisites
- **THEN** one notice names it with the new reason

#### Scenario: Many stuck tasks

- **WHEN** the first iteration finds 56 stuck tasks of the machine scope
- **THEN** five notices name one task each, and one notice says that 51 more are stuck and names the iteration log

#### Scenario: Other scope

- **WHEN** the machine scope is `personal` and a `work` task is excluded as repository
- **THEN** no notice is recorded for it, and the iteration's report still lists it as stuck

#### Scenario: New loop

- **WHEN** the loop is stopped and started again, and `beads:X-12` is still stuck for the same reason
- **THEN** the first iteration of the new loop records its notice again

### Requirement: Order of the stuck task notices

The stuck task notices of an iteration SHALL be ordered before the first five are taken: tasks stuck for a retained attempt, for prerequisites or for unreadable prerequisites, then for repository prerequisites, then for repository. Inside each group the order SHALL be the order of the report.

#### Scenario: Most actionable first

- **WHEN** an iteration finds, new and of the machine scope, six tasks stuck as repository and then one stuck as prerequisites
- **THEN** the first notice names the task stuck as prerequisites, four name tasks stuck as repository, and one says that 2 more are stuck

### Requirement: Unreadable prerequisites are remembered

When an iteration's selection is `not-evaluable` and names a task whose prerequisites could not be read, the loop SHALL remember that task and reason for the rest of the loop and SHALL record no notice for it. A new loop SHALL start with nothing remembered.

#### Scenario: Remembered without a notice

- **WHEN** an iteration's selection is `not-evaluable` because the prerequisites of `linear:DOT-1` cannot be read
- **THEN** no notice is recorded for it, and the next iteration's selection is given that the task was named

#### Scenario: Told when set aside

- **WHEN** the next iteration excludes `linear:DOT-1` as unreadable prerequisites and the task is of the machine scope
- **THEN** one notice says `stuck linear:DOT-1:` followed by the read error
