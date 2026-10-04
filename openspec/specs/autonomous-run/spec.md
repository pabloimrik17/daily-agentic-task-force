# autonomous-run Specification

## Purpose

The single entry point of the autonomous loop: runs the loop's steps in order and reports what happened, in a form both people and automation can check. Provisional — expected to change as further steps are added.

## Requirements

### Requirement: Single entry command

The `autonomous` plugin SHALL expose `/autonomous:run` as its only command. Its arguments SHALL be passed through to the step runner unchanged.

#### Scenario: Command invocation

- **WHEN** the user runs `/autonomous:run --account claude`
- **THEN** the step runner is executed with `--account claude`

### Requirement: Ordered steps stop at the first non-advance

The run SHALL execute its steps in a fixed order. Each step SHALL produce an outcome of `advance`, `wait` or `not-evaluable`, a list of human-checkable reasons, and step-specific data. The run SHALL stop at the first step whose outcome is not `advance`, and the run outcome SHALL be that step's outcome, or `advance` when every step advanced.

#### Scenario: Gate does not advance

- **WHEN** the first step returns `wait`
- **THEN** no later step runs and the run outcome is `wait`

#### Scenario: All steps advance

- **WHEN** every step returns `advance`
- **THEN** the run outcome is `advance`

### Requirement: Run report

With `--json`, the run SHALL print a single JSON document identified by `schema: "autonomous.run.v1"`, containing the start time, the result of every executed step (step id, tier, outcome, reasons, data) and the run outcome. Without `--json`, it SHALL print a pre-rendered text report of the same information. The report SHALL carry a `handoff` only as the handoff requirement defines; otherwise it carries none.

With `--bootstrap-labels`, the run SHALL instead print the bootstrap report. With `--json`, it is a single JSON document identified by `schema: "autonomous.bootstrap.v1"`, containing the start time, the outcome and, per source, the labels created, present and failed; when the configuration cannot be loaded, it contains no sources and holds the configuration path and the error instead. Without `--json`, it is a text report of the same information, except that a configuration that cannot be loaded is reported on stderr only.

#### Scenario: JSON report

- **WHEN** the run is invoked with `--json` and without `--bootstrap-labels` or `--answer`
- **THEN** stdout contains exactly one JSON document with `schema` equal to `autonomous.run.v1`

#### Scenario: Text report

- **WHEN** the run is invoked without `--json`, `--bootstrap-labels` or `--answer`
- **THEN** stdout contains a readable report listing each executed step, its outcome and its reasons

#### Scenario: Bootstrap JSON report

- **WHEN** the run is invoked with `--bootstrap-labels --json`
- **THEN** stdout contains exactly one JSON document with `schema` equal to `autonomous.bootstrap.v1`, listing per enabled source the labels created, present and failed

### Requirement: Exit code reflects the outcome

The run SHALL exit with 0 for `advance`, 2 for `wait` and 3 for `not-evaluable`. Invalid arguments or an unexpected failure of the runner itself SHALL exit with 1.

#### Scenario: Waiting run

- **WHEN** the run outcome is `wait`
- **THEN** the process exits with code 2

#### Scenario: Unknown argument

- **WHEN** the run is invoked with an unrecognised flag
- **THEN** the process prints a usage message and exits with code 1

### Requirement: The command does not reinterpret the report

The command SHALL relay the runner's output as-is and SHALL act only on a `handoff` the report carries. When the report carries no `handoff`, the agent SHALL take no further action. When it carries one and the agent can ask the user, the agent SHALL run a single round:

1. Ask every question of the handoff in one round, with the header, question text, option labels and descriptions, and multi-choice setting as given, never rewording, reordering or adding to them.
2. Keep an answer only when every option chosen for it is one of that question's options with a non-null value, and turn each kept answer into `--answer <id>=<value>[,<value>]` from those values. An answer that chooses the null-valued option, or anything else, free text included, is not passed on.
3. When at least one answer was kept, run the runner once with `--apply`, the kept answers, and `--json` when the user gave it; relay its output as-is.
4. End.

When no answer is kept, or the agent cannot ask the user, the agent SHALL end after relaying the first report. The agent SHALL NOT ask a second round, compose a question or an option, retry an answer, or pass an answer the user did not give.

#### Scenario: Report without handoff

- **WHEN** the runner finishes without a `handoff`
- **THEN** the agent shows the report and ends the command

#### Scenario: Handoff answered

- **WHEN** the report carries a handoff with two questions and the user picks an option for each
- **THEN** the agent runs the runner once in answer mode with both answers, relays that report and ends

#### Scenario: Free-text answer

- **WHEN** the user answers a question by typing text through "Other"
- **THEN** that question is not answered and no `--answer` is passed for it

#### Scenario: Answer left for later

- **WHEN** the user chooses the option whose value is null
- **THEN** no `--answer` is passed for that question

#### Scenario: Nobody to ask

- **WHEN** the report carries a handoff and the session cannot ask the user
- **THEN** the agent shows the report and ends the command without running the answer mode

### Requirement: Label bootstrap mode

With `--bootstrap-labels`, the run SHALL execute only the label bootstrap of the label contract and exit; no step runs. The flag MAY be combined with `--json` only; any other flag with it is a usage error. The exit code SHALL be 0 when every enabled source has every contract label present or created, 3 when the configuration cannot be loaded, any source was not evaluable, or any label could not be created, and 1 for a usage error or a failure of the runner itself. The report SHALL list, per source, the labels created, present and failed.

#### Scenario: Bootstrap only

- **WHEN** the run is invoked with `--bootstrap-labels`
- **THEN** no step runs and the bootstrap report is printed

#### Scenario: Bootstrap with apply

- **WHEN** the run is invoked with `--bootstrap-labels --apply`
- **THEN** the run prints a usage message and exits with code 1

#### Scenario: Label creation fails

- **WHEN** a label cannot be created
- **THEN** it is reported as failed and the process exits with code 3

### Requirement: Explicit apply flag

The run SHALL accept `--apply` and pass it to every step. Neither a step nor answer mode SHALL write to a tracker unless `--apply` was given; without it, a run has no side effects beyond the CLIs' own caches.

#### Scenario: Run without apply

- **WHEN** the run is invoked without `--apply`
- **THEN** no step issues a write to any tracker

#### Scenario: Run with apply

- **WHEN** the run is invoked with `--apply`
- **THEN** steps that write do so under their own rules

### Requirement: Handoff of questions for the human

A run SHALL emit the report's `handoff` only when it was invoked with `--apply`, without `--no-handoff`, and at least one executed step contributed a question. The `handoff` SHALL hold `questions`, at most 4 of them, and `remaining`, the number of contributed questions left out. Questions SHALL be taken in step order and, within a step, in that step's own order. Each question SHALL carry:

- `id`: an identifier that names the step and the question's target, and is unique within the handoff;
- `step`: the id of the step that contributed it;
- `header`: at most 12 characters;
- `question`: the question text;
- `options`: two to four entries, each a `label` shown to the human, a `value` passed back as the answer, and a `description`;
- `multiSelect`: whether several options may be chosen.

Every question SHALL include exactly one option whose `value` is null, meaning "no answer for now"; choosing it answers nothing. The run SHALL compose every part of a question itself; nothing in a question is left for the command to write. A question left out of the handoff SHALL still appear in its step's own report. With `--json` the handoff is the report's `handoff` field. Without `--json` the text report SHALL end with one line made of `handoff: ` and the same handoff as a single-line JSON document. A run that emits no handoff SHALL carry neither the field nor that line.

#### Scenario: Apply run with questions

- **WHEN** a run with `--apply` leaves six questions for the human
- **THEN** the report carries a `handoff` with the first 4 questions and `remaining` equal to 2

#### Scenario: Run without apply

- **WHEN** a run without `--apply` leaves questions for the human
- **THEN** the report carries no `handoff` and the questions appear only in the step's report

#### Scenario: Unattended run

- **WHEN** a run is invoked with `--apply --no-handoff` and leaves questions for the human
- **THEN** the report carries no `handoff`

#### Scenario: Text report

- **WHEN** a run without `--json` emits a handoff
- **THEN** the last line of stdout begins with `handoff: ` followed by the handoff as one line of JSON

### Requirement: No-handoff flag

The run SHALL accept `--no-handoff`, which prevents the report from carrying a `handoff` and changes nothing else about the run. It is meant for invocations with no human present, such as a `/loop`. The flag MAY be combined with every run flag, and SHALL NOT be combined with `--bootstrap-labels` or `--answer`.

#### Scenario: Loop invocation

- **WHEN** `/loop` runs `/autonomous:run --account claude --apply --no-handoff`
- **THEN** the steps run and write as with `--apply`, and no question is asked

### Requirement: Answer mode

With one or more `--answer <id>=<value>[,<value>]` arguments, the run SHALL apply those answers and exit, and no step SHALL run. It needs neither quota nor a judgement. Answer mode SHALL require `--apply` and MAY be combined with `--json` only; `--answer` without `--apply`, with any other flag, with a value missing, or with the same id twice is a usage error. The run SHALL route each answer to the step its id names, and that step SHALL validate the answer and apply it under its own rules.

Each answer SHALL be reported with its id, its labels, a status and a detail:

| Status     | When                                                                                            |
| ---------- | ----------------------------------------------------------------------------------------------- |
| `applied`  | the answer was written and confirmed                                                            |
| `skipped`  | its target no longer needs it                                                                   |
| `rejected` | it is not valid for its question: unknown step or target, or a value the question does not accept |
| `failed`   | a read or write failed                                                                          |

With `--json` the report SHALL be one JSON document identified by `schema: "autonomous.answers.v1"`, holding the start time, the outcome and one entry per answer. Without `--json` it is a text report of the same information. When the configuration cannot be loaded, the error SHALL be printed on stderr and, with `--json`, the document SHALL hold the configuration path and the error and no answers. The answer report SHALL never carry a `handoff`.

The exit code SHALL be:

- 0 when every answer is applied or skipped;
- 3 when any answer is rejected or failed, or the configuration cannot be loaded;
- 1 for a usage error or a failure of the runner itself.

#### Scenario: Answers applied

- **WHEN** the run is invoked with `--apply --answer <id>=HITL` for a question of the last run whose task still lacks that group
- **THEN** no step runs, the label is written, the answer is reported as `applied` and the process exits with code 0

#### Scenario: Answer without apply

- **WHEN** the run is invoked with `--answer <id>=HITL` and without `--apply`
- **THEN** the run prints a usage message and exits with code 1

#### Scenario: Unknown step

- **WHEN** an answer's id names no step of the run
- **THEN** that answer is reported as `rejected`, the other answers are still processed, and the process exits with code 3

#### Scenario: Answer JSON report

- **WHEN** the run is invoked with `--apply --json` and one `--answer`
- **THEN** stdout contains exactly one JSON document with `schema` equal to `autonomous.answers.v1` and no `handoff`
