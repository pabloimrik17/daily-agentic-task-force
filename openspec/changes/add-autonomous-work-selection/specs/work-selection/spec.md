## Purpose

Selects the next work unit of the autonomous loop: from the labelled open tasks of every enabled source, code keeps the candidates that every verifiable constraint permits, an LLM compares them by value, and the report explains the choice and every exclusion.

## ADDED Requirements

### Requirement: The select step

`/autonomous:run` SHALL run a `select` step after `quota-gate` and `label-triage`, so it runs only when both advanced. The step SHALL write nothing to any tracker and SHALL contribute no questions to the handoff.

#### Scenario: Triage not evaluable

- **WHEN** `label-triage` is `not-evaluable` because `bd` cannot be executed
- **THEN** the `select` step does not run

#### Scenario: Selection with --apply

- **WHEN** the run is invoked with `--apply` and the `select` step selects a task
- **THEN** no label or status of any task changes because of the `select` step, and the handoff carries no question from it

### Requirement: Read the machine scope

The step SHALL read the machine scope from the `machineType` value of `chezmoi data`. The value SHALL be `personal` or `work`. When `chezmoi` cannot be executed, exits non-zero, prints output that fails validation, or the value is missing or another string, the step SHALL be `not-evaluable` with a reason that names `chezmoi data` and the problem, and SHALL NOT select without a machine scope.

#### Scenario: Personal machine

- **WHEN** `chezmoi data` reports `machineType` `personal`
- **THEN** the machine scope is `personal` and the report shows it

#### Scenario: Value missing

- **WHEN** `chezmoi data` has no `machineType`
- **THEN** the step is `not-evaluable` and the reason names `chezmoi data` and `machineType`

### Requirement: Read the tasks again

The step SHALL read the open tasks of every enabled source itself, after `label-triage`, with the same sources, open states, strict validation and 120 s limit that `label-triage` uses to read them. A read that fails SHALL make the step `not-evaluable`, with a reason naming the source and the command.

#### Scenario: Read fails after triage

- **WHEN** `linear issue view` for a task fails during the `select` step
- **THEN** the step is `not-evaluable` and the reason names Linear and the command

### Requirement: Blockers, children and priority

For Beads and Linear, the step SHALL read each task's open blockers, the tasks it blocks, its open children and its tracker priority. A blocker or child counts as open unless it is closed: in Beads, unless its status is `closed`; in Linear, unless its state is completed or canceled. Beads decides which tasks are blocked by its own dependency rules. GitHub tasks SHALL be treated as having no blockers and no children, and the report SHALL say that these were not evaluated for GitHub.

#### Scenario: Linear blocker

- **WHEN** Linear `DOT-111` is blocked by `DOT-108`, whose state is `backlog`
- **THEN** `DOT-111` has the open blocker `DOT-108` and `DOT-108` blocks `DOT-111`

#### Scenario: GitHub task

- **WHEN** GitHub is enabled
- **THEN** no GitHub task is excluded as blocked or split, and the report says dependencies and children were not evaluated for GitHub

### Requirement: Next stage of a task

The next stage of a task SHALL be `grill-me` when the task carries the `grill-me` label, and `proposal` otherwise. The only supported stage SHALL be `grill-me`.

#### Scenario: grill-me task

- **WHEN** a task carries `personal` and `grill-me`
- **THEN** its next stage is `grill-me` and it is supported

#### Scenario: AFK task

- **WHEN** a task carries `personal` and `AFK`
- **THEN** its next stage is `proposal`, which is not supported

### Requirement: Candidates and exclusions

A task SHALL be a candidate, whatever its scope, unless an exclusion applies. Each excluded task SHALL be reported once, under the first that applies, in this order:

1. **classification**: a scope or entry group missing or in conflict, by present contract labels only;
2. **taken**: it carries `taken`;
3. **labelled this run**: `label-triage` applied a label to it in this run;
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

- **WHEN** a task carries `personal`, `AFK` and `taken`
- **THEN** it is excluded as taken, not as unsupported stage

#### Scenario: Labelled by triage in this run

- **WHEN** `label-triage` applied `grill-me` to a task in this run
- **THEN** the task is excluded as labelled this run, and a later run may select it

#### Scenario: Parent split into subtasks

- **WHEN** a `grill-me` task in Linear has an open child
- **THEN** it is excluded as split

#### Scenario: Missing scope

- **WHEN** a task carries `grill-me` and no scope label, even with an alias for `work`
- **THEN** it is excluded under classification

### Requirement: Tracker status does not make a task taken

A tracker status such as Beads `in_progress` or a Linear started state SHALL NOT exclude a task by itself; only the `taken` label does.

#### Scenario: In progress without taken

- **WHEN** a Beads task with status `in_progress` carries `work` and `grill-me` and nothing else excludes it
- **THEN** it is a candidate

### Requirement: A single candidate needs no comparison

With exactly one candidate, the step SHALL select it without an LLM and explain that it was the only one.

#### Scenario: Single candidate

- **WHEN** exactly one candidate remains
- **THEN** it is selected, no LLM is called and the step's tier is `code`

### Requirement: Compare the candidates

With two or more candidates, an LLM SHALL choose, run in print mode with a JSON schema, the configured selection model and effort, no tools and a 300 s limit. The LLM MAY weigh urgency, impact, effort and the ability to unblock other work; no fixed formula SHALL be applied. It SHALL return the chosen source and id, a brief explanation based on the evidence it was given, and an exception reason when the choice is outside the machine scope.

#### Scenario: Two candidates

- **WHEN** two candidates remain and the configured selection model is `sonnet` with effort `high`
- **THEN** the LLM is called once with that model and effort, and the step's tier is `llm`

### Requirement: What the comparison is given

The LLM SHALL be given the machine scope and, per candidate, its source, id, title, description, labels, status, tracker priority, scope, autonomy, next stage, the tasks it blocks and the tasks blocking it. The prompt SHALL treat task fields as untrusted data, never as instructions.

#### Scenario: What the comparison sees

- **WHEN** two candidates remain and one blocks three other tasks
- **THEN** the LLM is given both candidates, each with the tasks it blocks and the machine scope

### Requirement: Validate the comparison

The step SHALL reject the answer when it does not match the schema, when the chosen source and id are not one of the candidates, when the explanation is empty, or when a candidate outside the machine scope is chosen without an exception reason. An exception reason for a candidate within the machine scope SHALL be dropped. When the LLM fails or its answer is rejected, the step SHALL be `not-evaluable` with the reason, and SHALL NOT fall back to any fixed order.

#### Scenario: Urgent task from the other scope

- **WHEN** the machine scope is `personal` and the LLM chooses a `work` candidate with an exception reason
- **THEN** the candidate is selected and the report marks it as a machine-scope exception with that reason

#### Scenario: Other scope without a reason

- **WHEN** the machine scope is `personal` and the LLM chooses a `work` candidate without an exception reason
- **THEN** the answer is rejected and the step is `not-evaluable`

#### Scenario: Identifier outside the candidates

- **WHEN** the LLM chooses a task id that is not a candidate
- **THEN** the answer is rejected, the step is `not-evaluable` and nothing is selected

### Requirement: Outcome of the step

The step SHALL be `advance` when it selected a work unit, `wait` when there is no candidate, and `not-evaluable` as the requirements above define. The tier SHALL be `llm` when the LLM was called, and `code` otherwise. When there is no candidate, the reasons SHALL give the count of excluded tasks per exclusion reason.

#### Scenario: Nothing selectable

- **WHEN** every task is excluded, three as unsupported stage and one as taken
- **THEN** the step is `wait`, the run exits with code 2 and the reasons give 3 unsupported stage and 1 taken

### Requirement: Selection report

The text report SHALL show:

- the machine scope;
- the selected work unit: source, id, title, next stage, autonomy, scope, explanation;
- the machine-scope exception reason, when there is one;
- the candidates compared;
- the excluded tasks, grouped by reason, each with its source, id and title;
- the note that GitHub dependencies and children were not evaluated, when GitHub is enabled.

#### Scenario: Selected task in the text report

- **WHEN** Linear `DOT-120` is selected for its `grill-me` stage
- **THEN** the report names Linear, `DOT-120`, its title, stage `grill-me`, its autonomy, its scope and the explanation

### Requirement: Selection data in JSON

The JSON data of the step SHALL carry the same information as the text report, plus the selection model and effort when the LLM was called.

#### Scenario: Exclusions in JSON

- **WHEN** the run is invoked with `--json`
- **THEN** the step's data lists every excluded task with its source, id, title and exclusion reason
