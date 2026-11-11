## MODIFIED Requirements

### Requirement: Blockers, children and priority

For Beads and Linear, the step SHALL read each task's open blockers, the tasks it blocks, its open children and its tracker priority. A blocker or child counts as open unless it is closed: in Beads, unless its status is `closed`; in Linear, unless its state is completed or canceled. Beads decides which tasks are blocked by its own dependency rules. For GitHub, the step SHALL read each task's sub-issues as its children, open unless closed; GitHub tasks SHALL be treated as having no blockers and no tracker priority, and the report SHALL say that dependencies were not evaluated for GitHub.

#### Scenario: Linear blocker

- **WHEN** Linear `DOT-111` is blocked by `DOT-108`, whose state is `backlog`
- **THEN** `DOT-111` has the open blocker `DOT-108` and `DOT-108` blocks `DOT-111`

#### Scenario: GitHub task

- **WHEN** GitHub is enabled
- **THEN** no GitHub task is excluded as blocked, and the report says dependencies were not evaluated for GitHub

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
- the excluded tasks, grouped by reason, each with its source, id and title;
- the note that GitHub dependencies were not evaluated, when GitHub is enabled.

#### Scenario: Selected task in the text report

- **WHEN** Linear `DOT-120` is selected for its `grill-me` stage
- **THEN** the report names Linear, `DOT-120`, its title, stage `grill-me`, its autonomy, its scope and the explanation

#### Scenario: Grill selected without autonomy

- **WHEN** a task carrying `personal` and `grill-me` only is selected
- **THEN** the report gives its autonomy as `none`
