## MODIFIED Requirements

### Requirement: Next stage of a task

The next stage of a task SHALL be the stage label it carries: `grill-me` or `proposal`. A task without a stage label has no next stage and is excluded under classification. The only supported stage SHALL be `grill-me`.

#### Scenario: grill-me task

- **WHEN** a task carries `personal` and `grill-me`
- **THEN** its next stage is `grill-me` and it is supported

#### Scenario: AFK task

- **WHEN** a task carries `personal`, `AFK` and `proposal`
- **THEN** its next stage is `proposal`, which is not supported

### Requirement: Candidates and exclusions

A task SHALL be a candidate, whatever its scope, unless an exclusion applies. Each excluded task SHALL be reported once, under the first that applies, in this order:

1. **classification**: a scope, autonomy or stage group missing or in conflict, by present contract labels only; autonomy is not missing while the stage is `grill-me`;
2. **taken**: it carries `taken`;
3. **labelled this run**: `label-triage` labelled it, or tried to, this run;
4. **unsupported stage**: its next stage is not supported;
5. **blocked**: an open blocker;
6. **split**: an open child.

#### Scenario: Small task that unblocks others

- **WHEN** a `grill-me` task has no open blocker and blocks two other tasks
- **THEN** it is a candidate and the tasks it blocks are part of what the comparison sees

#### Scenario: Taken grill-me task

- **WHEN** a task carries `personal`, `grill-me` and `taken`
- **THEN** it is excluded as taken

#### Scenario: AFK task already taken

- **WHEN** a task carries `personal`, `AFK`, `proposal` and `taken`
- **THEN** it is excluded as taken, not as unsupported stage

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
- the note that GitHub dependencies and children were not evaluated, when GitHub is enabled.

#### Scenario: Selected task in the text report

- **WHEN** Linear `DOT-120` is selected for its `grill-me` stage
- **THEN** the report names Linear, `DOT-120`, its title, stage `grill-me`, its autonomy, its scope and the explanation

#### Scenario: Grill selected without autonomy

- **WHEN** a task carrying `personal` and `grill-me` only is selected
- **THEN** the report gives its autonomy as `none`
