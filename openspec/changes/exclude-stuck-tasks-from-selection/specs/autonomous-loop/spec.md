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
