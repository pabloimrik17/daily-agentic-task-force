## ADDED Requirements

### Requirement: GitHub reads that are cut short

A GitHub listing whose `blockedBy` or `blocking` list for a task has a `totalCount` higher than the number of nodes returned SHALL be incomplete and SHALL count as a failed read, so the step is `not-evaluable`. The reason SHALL name the task's id. A blocker the token cannot see, which counts in `totalCount` without a node, SHALL fail the read the same way.

#### Scenario: Blockers cut short

- **WHEN** `gh issue list` returns `demo/one#7` with a `blockedBy.totalCount` of 51 and 50 nodes
- **THEN** the read is incomplete, the step is `not-evaluable` and the reason names `demo/one#7`

#### Scenario: Blocked tasks cut short

- **WHEN** `gh issue list` returns `demo/one#7` with a `blocking.totalCount` of 51 and 50 nodes
- **THEN** the read is incomplete, the step is `not-evaluable` and the reason names `demo/one#7`

#### Scenario: Blocker the token cannot see

- **WHEN** `gh issue list` returns `demo/one#7` with a `blockedBy.totalCount` of 1 and no node
- **THEN** the step is `not-evaluable` and the reason names `demo/one#7`

## MODIFIED Requirements

### Requirement: Blockers, children and priority

For Beads, Linear and GitHub, the step SHALL read each task's open blockers and the tasks it blocks. For Beads and Linear, it SHALL also read each task's open children and its tracker priority. A blocker or child counts as open unless it is closed: in Beads, unless its status is `closed`; in Linear, unless its state is completed or canceled; in GitHub, unless its state is `CLOSED`, whatever the reason it was closed. Beads decides which tasks are blocked by its own dependency rules. For GitHub, the step SHALL read a task's blockers and the tasks it blocks from the same `gh issue list` call that lists the task, with no further call per task; an open blocker or blocked task SHALL count from any repository, including one outside `sources.github.repos`, under the id `<owner/name>#<number>`. The step SHALL read each GitHub task's sub-issues as its children, open unless closed. GitHub tasks SHALL be treated as having no tracker priority.

#### Scenario: Linear blocker

- **WHEN** Linear `DOT-111` is blocked by `DOT-108`, whose state is `backlog`
- **THEN** `DOT-111` has the open blocker `DOT-108` and `DOT-108` blocks `DOT-111`

#### Scenario: GitHub task

- **WHEN** GitHub is enabled
- **THEN** each GitHub task's open blockers and the tasks it blocks are read from its listing, and the report does not say that dependencies were not evaluated for GitHub

#### Scenario: GitHub open blocker

- **WHEN** GitHub `demo/one#7` is blocked by `demo/one#3`, whose state is `OPEN`
- **THEN** `demo/one#7` has the open blocker `demo/one#3` and is excluded as blocked

#### Scenario: GitHub closed blocker

- **WHEN** every blocker of GitHub `demo/one#7` is `CLOSED`, one closed as completed and one as not planned
- **THEN** `demo/one#7` has no open blocker and is not excluded as blocked

#### Scenario: GitHub blocker in another repository

- **WHEN** GitHub `demo/one#7` is blocked by `other/elsewhere#12`, whose state is `OPEN`, and `other/elsewhere` is not in `sources.github.repos`
- **THEN** `demo/one#7` has the open blocker `other/elsewhere#12` and is excluded as blocked

#### Scenario: GitHub tasks blocked

- **WHEN** GitHub `demo/one#3` is blocking `demo/one#7`, whose state is `OPEN`, and `other/elsewhere#12`, whose state is `CLOSED`
- **THEN** `demo/one#3` blocks `demo/one#7` only

#### Scenario: GitHub split

- **WHEN** a GitHub issue carrying `personal` and `grill-me` has an open sub-issue
- **THEN** it is excluded as split

#### Scenario: GitHub sub-issues all closed

- **WHEN** every sub-issue of a GitHub issue is closed
- **THEN** the issue has no open children

### Requirement: Selection report

The text report SHALL show:

- the machine scope;
- the selected work unit: source, id, title, next stage, autonomy (`none` for a task in `grill-me` without one), scope, explanation;
- the machine-scope exception reason, when there is one;
- the candidates compared;
- the candidates set aside because a candidate at a more advanced stage exists, each with its source, id, title and stage;
- the excluded tasks, grouped by reason, each with its source, id and title;
- the tasks ready to close: each task excluded as split whose children are all closed.

The report SHALL NOT carry a note that dependencies were not evaluated for any source.

#### Scenario: Selected task in the text report

- **WHEN** Linear `DOT-120` is selected for its `grill-me` stage
- **THEN** the report names Linear, `DOT-120`, its title, stage `grill-me`, its autonomy, its scope and the explanation

#### Scenario: Grill selected without autonomy

- **WHEN** a task carrying `personal` and `grill-me` only is selected
- **THEN** the report gives its autonomy as `none`

#### Scenario: Parent ready to close

- **WHEN** a task in `proposal` is excluded as split and every one of its children is closed
- **THEN** the report lists it as ready to close, and no tracker write is issued for it

#### Scenario: Parent with an open subtask

- **WHEN** a task excluded as split still has an open child
- **THEN** the report does not list it as ready to close

#### Scenario: Candidate set aside in the report

- **WHEN** a `grill-me` candidate is set aside because a `proposal` candidate exists
- **THEN** the report lists it as set aside with its stage, and not among the excluded tasks

#### Scenario: GitHub enabled

- **WHEN** GitHub is enabled
- **THEN** the report has no `not evaluated:` line
