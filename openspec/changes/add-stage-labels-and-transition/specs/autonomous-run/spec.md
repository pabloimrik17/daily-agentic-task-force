## MODIFIED Requirements

### Requirement: Run report

With `--json`, the run SHALL print a single JSON document identified by `schema: "autonomous.run.v2"`, containing the start time, the result of every executed step (step id, tier, outcome, reasons, data) and the run outcome. Step data SHALL name the label groups `scope`, `autonomy` and `stage`. Without `--json`, it SHALL print a pre-rendered text report of the same information. The report SHALL carry a `handoff` only as the handoff requirement defines; otherwise it carries none.

With `--bootstrap-labels`, the run SHALL instead print the bootstrap report. With `--json`, it is a single JSON document identified by `schema: "autonomous.bootstrap.v1"`, containing the start time, the outcome and, per source, the labels created, recoloured, present and failed; when the configuration cannot be loaded, it contains no sources and holds the configuration path and the error instead. Without `--json`, it is a text report of the same information, except that a configuration that cannot be loaded is reported on stderr only.

#### Scenario: JSON report

- **WHEN** the run is invoked with `--json` and without `--bootstrap-labels`, `--answer` or `--transition`
- **THEN** stdout contains exactly one JSON document with `schema` equal to `autonomous.run.v2`

#### Scenario: Text report

- **WHEN** the run is invoked without `--json`, `--bootstrap-labels`, `--answer` or `--transition`
- **THEN** stdout contains a readable report listing each executed step, its outcome and its reasons

#### Scenario: Bootstrap JSON report

- **WHEN** the run is invoked with `--bootstrap-labels --json`
- **THEN** stdout contains exactly one JSON document with `schema` equal to `autonomous.bootstrap.v1`, listing per enabled source the labels created, recoloured, present and failed

#### Scenario: Triage data groups

- **WHEN** the run is invoked with `--json` and `label-triage` runs
- **THEN** the step's counts per group are keyed `scope`, `autonomy` and `stage`, and no key is named `entry`

### Requirement: Label bootstrap mode

With `--bootstrap-labels`, the run SHALL execute only the label bootstrap of the label contract and exit; no step runs. The flag MAY be combined with `--json` only; any other flag with it is a usage error. The exit code SHALL be 0 when every enabled source has every contract label present, created or recoloured, 3 when the configuration cannot be loaded, any source was not evaluable, or any label could not be created or recoloured, and 1 for a usage error or a failure of the runner itself. The report SHALL list, per source, the labels created, recoloured, present and failed.

#### Scenario: Bootstrap only

- **WHEN** the run is invoked with `--bootstrap-labels`
- **THEN** no step runs and the bootstrap report is printed

#### Scenario: Bootstrap with apply

- **WHEN** the run is invoked with `--bootstrap-labels --apply`
- **THEN** the run prints a usage message and exits with code 1

#### Scenario: Label creation fails

- **WHEN** a label cannot be created
- **THEN** it is reported as failed and the process exits with code 3

#### Scenario: Recolour only

- **WHEN** every contract label exists and one had another colour, which the bootstrap changed
- **THEN** that label is reported as recoloured and the process exits with code 0

### Requirement: No-handoff flag

The run SHALL accept `--no-handoff`, which prevents the report from carrying a `handoff` and changes nothing else about the run. It is meant for invocations with no human present, such as a `/loop`. The flag MAY be combined with every run flag, and SHALL NOT be combined with `--bootstrap-labels`, `--answer` or `--transition`.

#### Scenario: Loop invocation

- **WHEN** `/loop` runs `/autonomous:run --account claude --apply --no-handoff`
- **THEN** the steps run and write as with `--apply`, and no question is asked

#### Scenario: Transition without a handoff

- **WHEN** the run is invoked with `--apply --transition linear:DOT-110 --no-handoff`
- **THEN** the run prints a usage message and exits with code 1

### Requirement: Answer mode

With one or more `--answer <id>=<value>[,<value>]` arguments, the run SHALL apply those answers and exit, and no step SHALL run. It needs neither quota nor a judgement. Answer mode SHALL require `--apply` and MAY be combined with `--json` only; `--answer` without `--apply`, with any other flag, with a value missing, or with the same id twice is a usage error. The run SHALL route each answer to the step or the transition its id names, and that step or the transition SHALL validate the answer and apply it under its own rules.

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

- **WHEN** an answer's id names no step of the run and not the transition
- **THEN** that answer is reported as `rejected`, the other answers are still processed, and the process exits with code 3

#### Scenario: Answer JSON report

- **WHEN** the run is invoked with `--apply --json` and one `--answer`
- **THEN** stdout contains exactly one JSON document with `schema` equal to `autonomous.answers.v1` and no `handoff`

#### Scenario: Transition answer

- **WHEN** the run is invoked with `--apply --answer transition:linear:DOT-110=AFK` and DOT-110 still carries `grill-me`
- **THEN** the transition is applied, the answer is reported as `applied` and the process exits with code 0

### Requirement: Supplied task flags

The run SHALL accept `--task <source>:<id>`, which skips `label-triage` and `select` and gives that task to `launch`, and `--stage <stage>`, which names the stage to launch. `--stage` without `--task` is a usage error. Both MAY be combined with `--account`, `--force`, `--json`, `--apply` and `--no-handoff`, and SHALL NOT be combined with `--bootstrap-labels`, `--answer`, `--discard` or `--transition`.

#### Scenario: Task supplied

- **WHEN** the run is invoked with `--task beads:agentic-task-2x0`
- **THEN** `reconcile`, `quota-gate` and `launch` run and `label-triage` and `select` do not

#### Scenario: Stage alone

- **WHEN** the run is invoked with `--stage test` and no `--task`
- **THEN** the run prints a usage message and exits with code 1

#### Scenario: Malformed task

- **WHEN** `--task` is given a value without `:` or with an unknown source
- **THEN** the run prints a usage message and exits with code 1

## ADDED Requirements

### Requirement: Transition mode

With `--transition <source>:<task>`, the run SHALL run no step: it reads the task and, when the task carries `grill-me`, emits a handoff with the transition question and exits 0. The mode SHALL require `--apply` and MAY be combined with `--json` only. Any other combination, or a value without `:` or with an unknown source, is a usage error. A task without `grill-me`, from a disabled source, or that cannot be read SHALL be reported with the reason, with no handoff, and exit code 3.

#### Scenario: Task in grill-me

- **WHEN** the run is invoked with `--apply --transition linear:DOT-110` and DOT-110 carries `personal` and `grill-me`
- **THEN** no step runs, the report carries a handoff with one question, and the process exits with code 0

#### Scenario: Task not in grill-me

- **WHEN** the run is invoked with `--apply --transition linear:DOT-110` and DOT-110 carries `personal`, `AFK` and `proposal`
- **THEN** the report says DOT-110 is not in `grill-me`, carries no handoff, and the process exits with code 3

#### Scenario: Transition without apply

- **WHEN** the run is invoked with `--transition linear:DOT-110` and without `--apply`
- **THEN** the run prints a usage message and exits with code 1

### Requirement: Transition question

The transition question SHALL have an id that names the transition, the source and the task, and `transition` as its step. Its header SHALL be the task id when it has at most 12 characters, and `autonomy` otherwise. Its text names the source, task id, title and labels. Its options SHALL be `AFK` and `HITL` with their meanings, each prefixed `current ·` when the task carries it, plus `Later` with a null value, and it SHALL accept a single choice. It SHALL NOT ask for scope.

#### Scenario: Autonomy decided before the grill

- **WHEN** the transition question is composed for a task carrying `HITL` and `grill-me`
- **THEN** it offers `AFK`, `HITL` and `Later`, and only the description of `HITL` begins with `current ·`

#### Scenario: No autonomy yet

- **WHEN** the transition question is composed for a task carrying `work` and `grill-me`
- **THEN** no option is marked `current`

### Requirement: Transition answers

Answer mode SHALL route an answer whose id names the transition to it. Only a single `AFK` or `HITL` is valid; any other value, a malformed id or a disabled source is `rejected`. A task, read again, that no longer carries `grill-me` is `skipped`. A tracker lacking `proposal` or the answered autonomy makes the answer `failed`, naming `--bootstrap-labels`, before any write. Otherwise the transition is applied and read back; a failed write or read-back is `failed`.

#### Scenario: Transition applied

- **WHEN** the answer `AFK` arrives for a Linear task carrying `work`, `HITL` and `grill-me`
- **THEN** the task carries `work`, `AFK` and `proposal`, and the answer is `applied`

#### Scenario: Already moved on

- **WHEN** the answer `AFK` arrives for a task that no longer carries `grill-me`
- **THEN** the answer is `skipped` and nothing is written

#### Scenario: proposal not bootstrapped

- **WHEN** the answer `HITL` arrives for a GitHub task whose repository has no `proposal` label
- **THEN** the answer is `failed`, naming `--bootstrap-labels`, and the task's labels are unchanged

#### Scenario: Value outside the options

- **WHEN** the answer to the transition question is `grill-me`
- **THEN** it is `rejected` and nothing is written

### Requirement: Transition report

With `--json`, transition mode SHALL print one JSON document identified by `schema: "autonomous.transition.v1"`, holding the start time, the outcome, the task (source, id, title, labels; null when unreadable), the reasons and any handoff. Without `--json` it prints the same as text, ending, when a handoff is emitted, with `handoff: ` and the handoff as one line of JSON. A configuration that cannot be loaded is reported as in answer mode.

#### Scenario: Transition JSON report

- **WHEN** the run is invoked with `--apply --transition linear:DOT-110 --json` for a task in `grill-me`
- **THEN** stdout contains exactly one JSON document with `schema` equal to `autonomous.transition.v1` and a `handoff` with one question

#### Scenario: Transition text report

- **WHEN** the run is invoked with `--apply --transition linear:DOT-110` for a task in `grill-me`
- **THEN** the last line of stdout begins with `handoff: ` followed by the handoff as one line of JSON
