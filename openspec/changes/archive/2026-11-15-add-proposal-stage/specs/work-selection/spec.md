# Spec Delta

## MODIFIED Requirements

### Requirement: Next stage of a task

The next stage of a task SHALL be the stage label it carries: `grill-me`, `proposal` or `implement`. A task without a stage label has no next stage and is excluded under classification. The supported stages SHALL be `grill-me` and `proposal`.

#### Scenario: grill-me task

- **WHEN** a task carries `personal` and `grill-me`
- **THEN** its next stage is `grill-me` and it is supported

#### Scenario: AFK task

- **WHEN** a task carries `personal`, `AFK` and `proposal`
- **THEN** its next stage is `proposal`, which is supported

#### Scenario: Task ready to implement

- **WHEN** a task carries `personal`, `AFK` and `implement`
- **THEN** its next stage is `implement`, which is not supported

### Requirement: Candidates and exclusions

A task SHALL be a candidate, whatever its scope, unless an exclusion applies. Each excluded task SHALL be reported once, under the first that applies, in this order:

1. **classification**: a scope, autonomy or stage group missing or in conflict, by present contract labels only; autonomy is not missing while the stage is `grill-me`;
2. **taken**: it carries `taken`;
3. **labelled this run**: `label-triage` labelled it, or tried to, this run;
4. **unsupported stage**: its next stage is not supported;
5. **blocked**: an open blocker;
6. **split**: an open child, or, for a task whose next stage is `proposal`, any child, open or closed.

#### Scenario: Small task that unblocks others

- **WHEN** a `grill-me` task has no open blocker and blocks two other tasks
- **THEN** it is a candidate and the tasks it blocks are part of what the comparison sees

#### Scenario: Taken grill-me task

- **WHEN** a task carries `personal`, `grill-me` and `taken`
- **THEN** it is excluded as taken

#### Scenario: AFK task already taken

- **WHEN** a task carries `personal`, `AFK`, `proposal` and `taken`
- **THEN** it is excluded as taken

#### Scenario: Task ready to implement

- **WHEN** a task carries `personal`, `AFK` and `implement`
- **THEN** it is excluded as unsupported stage

#### Scenario: Labelled by triage in this run

- **WHEN** `label-triage` applied `grill-me` to a task in this run
- **THEN** the task is excluded as labelled this run, and a later run may select it

#### Scenario: Write failed during triage

- **WHEN** a `label-triage` write to a task fails in this run after adding `grill-me`
- **THEN** the task is excluded as labelled this run, because a write was attempted and some labels may have landed

#### Scenario: Only proposed by triage

- **WHEN** `label-triage` only proposed or asked about a label for a task in this run
- **THEN** the task is not excluded as labelled this run

#### Scenario: Parent split into subtasks

- **WHEN** a `grill-me` task in Linear has an open child
- **THEN** it is excluded as split

#### Scenario: Split parent whose subtasks are closed

- **WHEN** a task carrying `personal`, `AFK` and `proposal` has two children, both closed
- **THEN** it is excluded as split

#### Scenario: Grill of a task whose subtasks are closed

- **WHEN** a task carrying `personal` and `grill-me` has one child, closed
- **THEN** it is not excluded as split

#### Scenario: Missing scope

- **WHEN** a task carries `grill-me` and no scope label, even with an alias for `work`
- **THEN** it is excluded under classification

#### Scenario: Missing stage

- **WHEN** a task carries `personal` and `AFK` and no stage label
- **THEN** it is excluded under classification

#### Scenario: Grill without autonomy

- **WHEN** a task carries `work` and `grill-me` and nothing else excludes it
- **THEN** it is a candidate

### Requirement: Selection report

The text report SHALL show:

- the machine scope;
- the selected work unit: source, id, title, next stage, autonomy (`none` for a task in `grill-me` without one), scope, explanation;
- the machine-scope exception reason, when there is one;
- the candidates compared;
- the excluded tasks, grouped by reason, each with its source, id and title;
- the tasks ready to close: each task excluded as split whose children are all closed;
- the note that GitHub dependencies were not evaluated, when GitHub is enabled.

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

## ADDED Requirements

### Requirement: Closed children are counted

For every source, the step SHALL read how many children a task has in all, closed ones included, beside its open children. A task that never had a child has none. The JSON data of the step SHALL carry, for each task ready to close, its source, id and title.

#### Scenario: Linear parent with closed sub-issues

- **WHEN** a Linear issue has three sub-issues, all completed
- **THEN** it has three children in all and no open child

#### Scenario: Task without children

- **WHEN** a Beads task was never a parent
- **THEN** it has no children in all, and it is not excluded as split
