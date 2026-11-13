# Spec Delta

## ADDED Requirements

### Requirement: No free slot

In an iteration of the loop, a candidate whose slot kind is full SHALL be excluded as **no free slot**, after every other exclusion. Outside an iteration this exclusion SHALL NOT apply.

#### Scenario: Grill slots full

- **WHEN** an iteration finds the grill kind full, a free work slot, one `grill-me` task and one `proposal` task, both otherwise candidates, and `proposal` is supported
- **THEN** the `grill-me` task is excluded as no free slot and the `proposal` task is a candidate

#### Scenario: Blocked task with no free slot

- **WHEN** a `grill-me` task has an open blocker and the grill kind is full
- **THEN** it is excluded as blocked, not as no free slot

#### Scenario: Manual run with the grill kind full

- **WHEN** `/autonomous:run` is invoked with the grill kind full and a `grill-me` task that nothing else excludes
- **THEN** the task is a candidate

### Requirement: Most advanced stage first

Before the choice, the step SHALL keep only the candidates whose next stage is the most advanced among the candidates, in the order of the stage labels of the label contract: `grill-me`, then `proposal`. The other candidates SHALL be set aside for this run and reported as such. The rule SHALL apply whatever the scope of the candidates, in a run and in an iteration.

#### Scenario: Proposal over grill

- **WHEN** one candidate is in `grill-me` and one in `proposal`, and both stages are supported
- **THEN** only the `proposal` candidate is kept, and the `grill-me` candidate is set aside

#### Scenario: Other scope at a later stage

- **WHEN** the machine scope is `work`, a `personal` candidate is in `proposal` and a `work` candidate is in `grill-me`, and both stages are supported
- **THEN** the `personal` candidate is kept and selected as a machine-scope exception

#### Scenario: Same stage

- **WHEN** every candidate is in `grill-me`
- **THEN** every candidate is kept and none is set aside

## MODIFIED Requirements

### Requirement: A single candidate needs no comparison

With exactly one candidate kept, the step SHALL select it without an LLM and explain that it was the only one. When that candidate is outside the machine scope, the step SHALL mark the selection as a machine-scope exception whose reason is that it was the only candidate.

#### Scenario: Single candidate

- **WHEN** exactly one candidate remains
- **THEN** it is selected, no LLM is called and the step's tier is `code`

#### Scenario: Single candidate outside the machine scope

- **WHEN** the machine scope is `personal` and the only candidate is a `work` task
- **THEN** it is selected without an LLM, and the report marks it as a machine-scope exception because it was the only candidate

#### Scenario: Single candidate at the most advanced stage

- **WHEN** three candidates remain, one in `proposal` and two in `grill-me`, and both stages are supported
- **THEN** the `proposal` candidate is selected, no LLM is called and the step's tier is `code`

### Requirement: Compare the candidates

With two or more candidates kept, an LLM SHALL choose among them, run in print mode with a JSON schema, the configured selection model and effort, no tools and a 300 s limit. The LLM MAY weigh urgency, impact, effort and the ability to unblock other work; no fixed formula SHALL be applied. It SHALL return the chosen source and id, a brief explanation based on the evidence it was given, and an exception reason when the choice is outside the machine scope.

#### Scenario: Two candidates

- **WHEN** two candidates remain and the configured selection model is `sonnet` with effort `high`
- **THEN** the LLM is called once with that model and effort, and the step's tier is `llm`

#### Scenario: Candidates set aside are not compared

- **WHEN** two candidates are in `proposal` and one in `grill-me`, and both stages are supported
- **THEN** the LLM is given the two `proposal` candidates only

### Requirement: Selection report

The text report SHALL show:

- the machine scope;
- the selected work unit: source, id, title, next stage, autonomy (`none` for a task in `grill-me` without one), scope, explanation;
- the machine-scope exception reason, when there is one;
- the candidates compared;
- the candidates set aside because a candidate at a more advanced stage exists, each with its source, id, title and stage;
- the excluded tasks, grouped by reason, each with its source, id and title;
- the note that GitHub dependencies were not evaluated, when GitHub is enabled.

#### Scenario: Selected task in the text report

- **WHEN** Linear `DOT-120` is selected for its `grill-me` stage
- **THEN** the report names Linear, `DOT-120`, its title, stage `grill-me`, its autonomy, its scope and the explanation

#### Scenario: Grill selected without autonomy

- **WHEN** a task carrying `personal` and `grill-me` only is selected
- **THEN** the report gives its autonomy as `none`

#### Scenario: Candidate set aside in the report

- **WHEN** a `grill-me` candidate is set aside because a `proposal` candidate exists
- **THEN** the report lists it as set aside with its stage, and not among the excluded tasks
