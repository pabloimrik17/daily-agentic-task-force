# autonomous-run Specification

## Purpose

The single entry point of the autonomous loop: runs the loop's steps in order and reports what happened, in a form both people and automation can check. Provisional — expected to change as further steps are added.

## Requirements

### Requirement: Single entry command

The `autonomous` plugin SHALL expose three commands: `/autonomous:run`, which advances one task by one stage, `/autonomous:loop`, the continuous mode, and `/autonomous:loop-stop`, which stops a running loop. All three SHALL execute the same step runner. The arguments of `/autonomous:run` SHALL be passed through to the step runner unchanged.

#### Scenario: Command invocation

- **WHEN** the user runs `/autonomous:run --apply --json`
- **THEN** the step runner is executed with `--apply --json`

#### Scenario: Three commands

- **WHEN** the plugin is installed
- **THEN** it offers `/autonomous:run`, `/autonomous:loop` and `/autonomous:loop-stop` and no other command

### Requirement: Ordered steps stop at the first non-advance

The run SHALL execute its steps in a fixed order: `reconcile`, `capacity`, `quota-gate`, `label-triage`, `select`, `launch`. Each step SHALL produce an outcome of `advance`, `wait` or `not-evaluable`, a list of human-checkable reasons, and step-specific data. The run SHALL stop at the first step whose outcome is not `advance`, and the run outcome SHALL be that step's outcome, or `advance` when every step advanced.

#### Scenario: Gate does not advance

- **WHEN** `quota-gate` returns `wait`
- **THEN** no later step runs and the run outcome is `wait`

#### Scenario: All steps advance

- **WHEN** every step returns `advance`
- **THEN** the run outcome is `advance`

#### Scenario: Reconcile runs before the gate

- **WHEN** a run starts
- **THEN** `reconcile` runs before `quota-gate`

#### Scenario: Capacity runs before the gate

- **WHEN** a run starts
- **THEN** `capacity` runs after `reconcile` and before `quota-gate`

#### Scenario: Supplied task

- **WHEN** the run is invoked with `--task beads:agentic-task-2x0`
- **THEN** `reconcile`, `capacity`, `quota-gate` and `launch` run, in that order

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

The run SHALL accept `--no-handoff`, which prevents the report from carrying a `handoff` and changes nothing else about the run. It is meant for invocations with no human present, such as a `/loop`. The flag MAY be combined with every run flag, and SHALL NOT be combined with `--bootstrap-labels`, `--answer` or `--transition`.

#### Scenario: Loop invocation

- **WHEN** `/loop` runs `/autonomous:run --apply --no-handoff`
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

The run SHALL accept `--task <source>:<id>`, which skips `label-triage` and `select` and gives that task to `launch`, and `--stage <stage>`, which names the stage to launch. `--stage` without `--task` is a usage error. Both MAY be combined with `--force`, `--json`, `--apply` and `--no-handoff`, and SHALL NOT be combined with `--bootstrap-labels`, `--answer`, `--discard` or `--transition`.

#### Scenario: Task supplied

- **WHEN** the run is invoked with `--task beads:agentic-task-2x0`
- **THEN** `reconcile`, `quota-gate` and `launch` run and `label-triage` and `select` do not

#### Scenario: Stage alone

- **WHEN** the run is invoked with `--stage test` and no `--task`
- **THEN** the run prints a usage message and exits with code 1

#### Scenario: Malformed task

- **WHEN** `--task` is given a value without `:` or with an unknown source
- **THEN** the run prints a usage message and exits with code 1

### Requirement: Discard mode

With `--discard <attempt-id>`, the run SHALL discard that attempt and exit, and no step SHALL run. Discard mode SHALL require `--apply` and MAY be combined with `--json` and `--release-workspace` only. With `--json` the report SHALL be one JSON document identified by `schema: "autonomous.discard.v1"`, holding the start time, the outcome, the attempt id, the task, and what was removed. The exit code SHALL be 0 when the attempt was discarded, 3 when it could not be, and 1 for a usage error.

#### Scenario: Discard without apply

- **WHEN** the run is invoked with `--discard linear:DOT-109:test:1` and without `--apply`
- **THEN** the run prints a usage message and exits with code 1

#### Scenario: Discard JSON report

- **WHEN** the run is invoked with `--apply --discard linear:DOT-109:test:1 --json`
- **THEN** stdout contains exactly one JSON document with `schema` equal to `autonomous.discard.v1`

#### Scenario: Unknown attempt

- **WHEN** `--discard` names an attempt that does not exist
- **THEN** the run reports it and exits with code 3

### Requirement: Transition mode

With `--transition <source>:<task>`, the run SHALL run no step: it reads the task and acts by the stage label it carries. For `grill-me` it emits a handoff with the transition question and exits 0. For `proposal`, `implement` or `verify` with `HITL` it emits a handoff with the approval question and exits 0. For `proposal`, `implement` or `verify` with `AFK` it applies the transition to the next stage, `implement`, `verify` or `code-review`, itself, reads it back, emits no handoff and exits 0 when applied and 3 otherwise. The mode SHALL require `--apply` and MAY be combined with `--from` and `--json` only. Any other combination, or a value without `:` or with an unknown source, is a usage error. `--from <stage>` names the stage the caller expects the task to leave, `grill-me`, `proposal`, `implement` or `verify`: a task in another stage SHALL be reported with its labels, with no handoff and nothing written, and exit code 3. `--from` without `--transition`, with any other value, or given twice is a usage error. A task in none of these stages, a task in `proposal`, `implement` or `verify` whose autonomy is missing or in conflict, a task from a disabled source, or one that cannot be read SHALL be reported with the reason, with no handoff, and exit code 3.

#### Scenario: Task in grill-me

- **WHEN** the run is invoked with `--apply --transition linear:DOT-110` and DOT-110 carries `personal` and `grill-me`
- **THEN** no step runs, the report carries a handoff with one question, and the process exits with code 0

#### Scenario: HITL task in proposal

- **WHEN** the run is invoked with `--apply --transition linear:DOT-121` and DOT-121 carries `personal`, `HITL` and `proposal`
- **THEN** no step runs, the report carries a handoff with the approval question, nothing is written, and the process exits with code 0

#### Scenario: AFK task in proposal

- **WHEN** the run is invoked with `--apply --transition linear:DOT-110` and DOT-110 carries `personal`, `AFK` and `proposal`
- **THEN** DOT-110 carries `personal`, `AFK` and `implement`, the report says the transition was applied and carries no handoff, and the process exits with code 0

#### Scenario: AFK task in implement

- **WHEN** the run is invoked with `--apply --transition linear:DOT-121`, DOT-121 carries `personal`, `AFK` and `implement`, and its work is finished
- **THEN** DOT-121 carries `personal`, `AFK` and `verify`, the report says the transition was applied and carries no handoff, and the process exits with code 0

#### Scenario: HITL task in implement

- **WHEN** the run is invoked with `--apply --transition linear:DOT-121`, DOT-121 carries `personal`, `HITL` and `implement`, and its work is finished
- **THEN** no step runs, the report carries a handoff with the approval question, nothing is written, and the process exits with code 0

#### Scenario: AFK task in verify

- **WHEN** the run is invoked with `--apply --transition linear:DOT-121`, DOT-121 carries `personal`, `AFK` and `verify`, and its work is finished
- **THEN** DOT-121 carries `personal`, `AFK` and `code-review`, the report says the transition was applied and carries no handoff, and the process exits with code 0

#### Scenario: HITL task in verify

- **WHEN** the run is invoked with `--apply --transition linear:DOT-121`, DOT-121 carries `personal`, `HITL` and `verify`, and its work is finished
- **THEN** no step runs, the report carries a handoff with the approval question, nothing is written, and the process exits with code 0

#### Scenario: Task not in grill-me

- **WHEN** the run is invoked with `--apply --transition linear:DOT-110` and DOT-110 carries `personal`, `AFK` and `code-review`
- **THEN** the report says DOT-110 is in none of `grill-me`, `proposal`, `implement` and `verify`, carries no handoff, and the process exits with code 3

#### Scenario: Second run after a lost read-back

- **WHEN** the run is invoked with `--apply --transition linear:DOT-121 --from implement` and DOT-121 carries `personal`, `AFK` and `verify`
- **THEN** nothing is written, the report says DOT-121 is in `verify`, not `implement`, with its labels, carries no handoff, and the process exits with code 3

#### Scenario: From names the stage the task is in

- **WHEN** the run is invoked with `--apply --transition linear:DOT-121 --from verify`, DOT-121 carries `personal`, `AFK` and `verify`, and its work is finished
- **THEN** DOT-121 carries `personal`, `AFK` and `code-review`, as without `--from`, and the process exits with code 0

#### Scenario: From without transition

- **WHEN** the run is invoked with `--apply --from verify` and without `--transition`
- **THEN** the run prints a usage message and exits with code 1

#### Scenario: implement not bootstrapped

- **WHEN** the mode would apply the transition of an `AFK` task whose tracker has no `implement` label
- **THEN** nothing is written, the report names `--bootstrap-labels`, and the process exits with code 3

#### Scenario: verify not bootstrapped

- **WHEN** the mode would apply the transition of an `AFK` task in `implement` whose tracker has no `verify` label
- **THEN** nothing is written, the report names `--bootstrap-labels`, and the process exits with code 3

#### Scenario: code-review not bootstrapped

- **WHEN** the mode would apply the transition of an `AFK` task in `verify` whose tracker has no `code-review` label
- **THEN** nothing is written, the report names `--bootstrap-labels`, and the process exits with code 3

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

Answer mode SHALL route an answer whose id names the transition to it, and SHALL read the task again to know which transition it answers. For a task in `grill-me`, only a single `AFK` or `HITL` is valid. For a task in `proposal`, only a single `implement` is valid. For a task in `implement`, only a single `verify` is valid. For a task in `verify`, only a single `code-review` is valid. Any other value, a malformed id or a disabled source is `rejected`. A task that carries none of these stages, or no longer the one the value answers, is `skipped`. A tracker lacking a label the transition adds makes the answer `failed`, naming `--bootstrap-labels`, before any write. Otherwise the transition is applied and read back; a failed write or read-back is `failed`.

#### Scenario: Transition applied

- **WHEN** the answer `AFK` arrives for a Linear task carrying `work`, `HITL` and `grill-me`
- **THEN** the task carries `work`, `AFK` and `proposal`, and the answer is `applied`

#### Scenario: Proposal approved

- **WHEN** the answer `implement` arrives for a task carrying `personal`, `HITL` and `proposal`
- **THEN** the task carries `personal`, `HITL` and `implement`, and the answer is `applied`

#### Scenario: Implementation approved

- **WHEN** the answer `verify` arrives for a task carrying `personal`, `HITL` and `implement` whose work is finished
- **THEN** the task carries `personal`, `HITL` and `verify`, and the answer is `applied`

#### Scenario: Verification approved

- **WHEN** the answer `code-review` arrives for a task carrying `personal`, `HITL` and `verify` whose work is finished
- **THEN** the task carries `personal`, `HITL` and `code-review`, and the answer is `applied`

#### Scenario: Already moved on

- **WHEN** the answer `AFK` arrives for a task that no longer carries `grill-me`
- **THEN** the answer is `skipped` and nothing is written

#### Scenario: proposal not bootstrapped

- **WHEN** the answer `HITL` arrives for a GitHub task whose repository has no `proposal` label
- **THEN** the answer is `failed`, naming `--bootstrap-labels`, and the task's labels are unchanged

#### Scenario: Value outside the options

- **WHEN** the answer to the transition question is `grill-me`
- **THEN** it is `rejected` and nothing is written

#### Scenario: Autonomy answered for a task in proposal

- **WHEN** the answer `AFK` arrives for a task carrying `HITL` and `proposal`
- **THEN** it is `skipped` and nothing is written

### Requirement: Transition report

With `--json`, transition mode SHALL print one JSON document identified by `schema: "autonomous.transition.v1"`, holding the start time, the outcome, the task (source, id, title, labels; null when unreadable), the reasons and any handoff. Without `--json` it prints the same as text, ending, when a handoff is emitted, with `handoff: ` and the handoff as one line of JSON. A configuration that cannot be loaded is reported as in answer mode.

#### Scenario: Transition JSON report

- **WHEN** the run is invoked with `--apply --transition linear:DOT-110 --json` for a task in `grill-me`
- **THEN** stdout contains exactly one JSON document with `schema` equal to `autonomous.transition.v1` and a `handoff` with one question

#### Scenario: Transition text report

- **WHEN** the run is invoked with `--apply --transition linear:DOT-110` for a task in `grill-me`
- **THEN** the last line of stdout begins with `handoff: ` followed by the handoff as one line of JSON

### Requirement: Persist mode

With `--persist <attempt-id>`, the run SHALL run no step and SHALL persist what that attempt's stage defines: for `grill-me`, the definition and the stage summary; for `proposal`, `implement` and `verify`, the stage summary only. It SHALL require `--apply` and MAY be combined with `--json` only; any other flag with it, or a malformed attempt id, is a usage error. It SHALL exit 0 when the receipt is written and 3 otherwise. It takes no run lock.

#### Scenario: Persisted

- **WHEN** the run is invoked with `--apply --persist linear:DOT-121:grill-me:1` for a started attempt whose directory holds `definition.md` and `stage-summary.md`
- **THEN** no step runs, the definition and the comment are written and read back, the receipt is written and the process exits with code 0

#### Scenario: Proposal attempt persisted

- **WHEN** the run is invoked with `--apply --persist linear:DOT-121:proposal:1` for a started attempt whose directory holds `stage-summary.md`
- **THEN** the comment is written and read back, the task's description is unchanged, the receipt is written and the process exits with code 0

#### Scenario: Implementation attempt persisted

- **WHEN** the run is invoked with `--apply --persist linear:DOT-121:implement:1` for a started attempt whose directory holds `stage-summary.md`
- **THEN** the comment is written and read back, the task's description is unchanged, the receipt is written and the process exits with code 0

#### Scenario: Verification attempt persisted

- **WHEN** the run is invoked with `--apply --persist linear:DOT-121:verify:1` for a started attempt whose directory holds `stage-summary.md`
- **THEN** the comment is written and read back, the task's description is unchanged, the receipt is written and the process exits with code 0

#### Scenario: Persist without apply

- **WHEN** the run is invoked with `--persist linear:DOT-121:grill-me:1` and without `--apply`
- **THEN** the run prints a usage message and exits with code 1

### Requirement: Persist preconditions

Persist mode SHALL write nothing when the attempt is unknown, is not open, or belongs to a stage other than `grill-me`, `proposal`, `implement` and `verify`, or when its directory lacks a file its stage persists, or that file is empty: `definition.md` and `stage-summary.md` for `grill-me`, `stage-summary.md` for `proposal`, `implement` and `verify`. It SHALL report the reason and exit 3.

#### Scenario: Missing stage summary

- **WHEN** the attempt directory holds `definition.md` but no `stage-summary.md`
- **THEN** nothing is written to the tracker, the report names the missing file and the process exits with code 3

#### Scenario: Attempt already completed

- **WHEN** the attempt named is `completed`
- **THEN** nothing is written and the process exits with code 3

#### Scenario: Proposal attempt without a definition file

- **WHEN** a `proposal` attempt's directory holds `stage-summary.md` and no `definition.md`
- **THEN** persist mode does not report the definition as missing

#### Scenario: Test stage

- **WHEN** the attempt named belongs to the `test` stage
- **THEN** nothing is written and the process exits with code 3

#### Scenario: Verification attempt without a stage summary

- **WHEN** a `verify` attempt's directory holds no `stage-summary.md`
- **THEN** nothing is written, the report names the missing file and the process exits with code 3

### Requirement: Persist report

With `--json`, persist mode SHALL print one JSON document identified by `schema: "autonomous.persist.v1"`. It holds the start time, the outcome, the attempt id, the task, what was written and read back, the reasons, the notes, and the receipt's path when one was written. `notes` SHALL always be present, empty by default, and list what did not stop the persistence. Without `--json`, it is a text report of the same information. A configuration that cannot be loaded is reported as in answer mode.

#### Scenario: Persist JSON report

- **WHEN** the run is invoked with `--apply --persist <attempt-id> --json`
- **THEN** stdout contains exactly one JSON document with `schema` equal to `autonomous.persist.v1` and `notes` equal to an empty array when nothing was noted

#### Scenario: Note in the report

- **WHEN** the tracker returns the description re-serialised, with the same text as the one written
- **THEN** the JSON report lists one note in `notes`, and the text report prints it in a `notes:` block after the `receipt:` line

#### Scenario: No note in the text report

- **WHEN** persist mode writes the receipt and has no note
- **THEN** the text report has no `notes:` line

### Requirement: The transition waits for the persistence receipt

Transition mode and a transition answer SHALL refuse a task that has an open attempt of the stage it is leaving, `grill-me`, `proposal`, `implement` or `verify`, whose directory holds no persistence receipt. Transition mode reports it with no handoff and exit code 3, and applies nothing. The answer is `rejected`, naming the attempt. A task with no open attempt of that stage SHALL be transitioned as before.

#### Scenario: Definition not persisted

- **WHEN** `--apply --transition linear:DOT-121` runs while attempt `linear:DOT-121:grill-me:1` is started and has no receipt
- **THEN** the report names the attempt and the missing receipt, carries no handoff, and the process exits with code 3

#### Scenario: Definition persisted

- **WHEN** the same attempt holds a receipt
- **THEN** transition mode emits its question as before

#### Scenario: Stage summary not persisted

- **WHEN** `--apply --transition linear:DOT-121` runs for an `AFK` task in `proposal` while attempt `linear:DOT-121:proposal:1` is started and has no receipt
- **THEN** nothing is written, the report names the attempt and the missing receipt, and the process exits with code 3

#### Scenario: Manual transition

- **WHEN** a task in `grill-me` has no open attempt
- **THEN** transition mode emits its question without checking any receipt

#### Scenario: Implementation summary not persisted

- **WHEN** `--apply --transition linear:DOT-121` runs for an `AFK` task in `implement` while attempt `linear:DOT-121:implement:1` is started and has no receipt
- **THEN** the report names the attempt and the missing receipt, nothing is written, and the process exits with code 3

#### Scenario: Verification summary not persisted

- **WHEN** `--apply --transition linear:DOT-121` runs for an `AFK` task in `verify` while attempt `linear:DOT-121:verify:1` is started and has no receipt
- **THEN** the report names the attempt and the missing receipt, nothing is written, and the process exits with code 3

### Requirement: Read-backs allow for a tracker's read lag

A read-back that follows a tracker write and does not show the write yet SHALL be repeated after 1, 2, 4, 8 and 15 s: six reads over 30 s. Only a read that shows the write counts, and a failed read is not repeated. A mismatch after the last read SHALL keep its message and add `(read 6 times over 30 s)` to it. This covers the transition's answer, persist mode's description and comment, the `taken` label and the writes of label triage.

#### Scenario: A lagging read settles

- **WHEN** a transition answer adds `AFK` and `proposal` and the first two reads still lack `proposal`
- **THEN** the third read, after waits of 1 s and 2 s, shows both labels, the removals follow and the answer is `applied`

#### Scenario: A read settles at once

- **WHEN** the first read after a write shows it
- **THEN** no wait happens

#### Scenario: A read never settles

- **WHEN** every one of the six reads after the additions lacks `proposal`
- **THEN** the answer is `failed`, the detail holds the read-back mismatch with its label sets and `(read 6 times over 30 s)`, and nothing was removed

#### Scenario: A failed read

- **WHEN** the tracker command of a read-back fails
- **THEN** the read is not repeated and the failure is reported as before, without the read count

#### Scenario: Every read-back waits

- **WHEN** the `taken` label is added at launch or removed on reconcile, or label triage adds a label, and the tracker is slow to show the write
- **THEN** the read-back repeats on the same schedule and settles on the first read that shows the write

### Requirement: Pull-request mode

With `--pull-request <attempt-id>`, the run SHALL run no step and SHALL find or open the pull request of that attempt's workspace branch as the stage logbook defines. It SHALL require `--apply` and MAY be combined with `--title <text>` and `--json` only. It SHALL exit 0 when a pull request is reported or the task needs none, and 3 otherwise. It takes no run lock.

#### Scenario: Pull request opened

- **WHEN** the run is invoked with `--apply --pull-request linear:DOT-121:grill-me:1 --title "feat(autonomous): read GitHub blockers"` for a started attempt
- **THEN** no step runs, the draft pull request is opened, its URL is reported and the process exits with code 0

#### Scenario: Pull-request mode without apply

- **WHEN** the run is invoked with `--pull-request linear:DOT-121:grill-me:1` and without `--apply`
- **THEN** the run prints a usage message and exits with code 1

### Requirement: Pull-request mode preconditions

Any other flag with `--pull-request`, a malformed attempt id, or `--title` without `--pull-request` SHALL be a usage error. Pull-request mode SHALL write nothing, and exit 3, when the attempt is unknown or not open.

#### Scenario: Title without the mode

- **WHEN** the run is invoked with `--apply --title "feat: x"` and no `--pull-request`
- **THEN** the run prints a usage message and exits with code 1

#### Scenario: Completed attempt

- **WHEN** the attempt named is `completed`
- **THEN** nothing is pushed or opened and the process exits with code 3

### Requirement: Pull-request report

With `--json`, pull-request mode SHALL print one JSON document identified by `schema: "autonomous.pull-request.v1"`. It holds the start time, the outcome, the attempt id, the task, the branch, the pull request's number and URL or null, whether it was opened or reused, whether an empty commit was added, and the reasons. Without `--json`, it is a text report of the same information. A configuration that cannot be loaded is reported as in answer mode.

#### Scenario: Pull-request JSON report

- **WHEN** the run is invoked with `--apply --pull-request <attempt-id> --json` for a branch whose pull request is already open
- **THEN** stdout contains exactly one JSON document with `schema` equal to `autonomous.pull-request.v1`, the pull request's URL, and the pull request marked as reused

### Requirement: Log mode

With `--log <attempt-id>`, the run SHALL run no step and SHALL publish that attempt's logbook entry as the stage logbook defines. It SHALL require `--apply` and MAY be combined with `--json` only; any other flag with it, or a malformed attempt id, is a usage error. It SHALL write nothing when the attempt is unknown or not open, or its directory lacks `logbook-entry.md`. It SHALL exit 0 when the receipt is written and 3 otherwise. It takes no run lock.

#### Scenario: Entry logged

- **WHEN** the run is invoked with `--apply --log linear:DOT-121:grill-me:1` for a started attempt with a valid body and an open pull request
- **THEN** no step runs, the entry is published and read back, the receipt is written and the process exits with code 0

#### Scenario: Log mode without apply

- **WHEN** the run is invoked with `--log linear:DOT-121:grill-me:1` and without `--apply`
- **THEN** the run prints a usage message and exits with code 1

#### Scenario: Body file missing

- **WHEN** the attempt's directory holds no `logbook-entry.md`
- **THEN** nothing is published, the report names the missing file and the process exits with code 3

### Requirement: Log report

With `--json`, log mode SHALL print one JSON document identified by `schema: "autonomous.log.v1"`. It holds the start time, the outcome, the attempt id, the task, the pull request, whether the entry was published now or was already there, the word count of the body, the reasons, and the receipt's path when one was written. Without `--json`, it is a text report of the same information.

#### Scenario: Log JSON report

- **WHEN** the run is invoked with `--apply --log <attempt-id> --json` and the body is rejected for its length
- **THEN** stdout contains exactly one JSON document with `schema` equal to `autonomous.log.v1`, the word count, a reason naming the limit, and no receipt

### Requirement: An applied transition leaves a record in the open attempt

When a transition is applied to a task that has an open attempt of the stage it leaves, the run SHALL write, in that attempt's directory, a record of the transition: the labels it set, the time, and whether the human or the agent decided it. The record SHALL be written only after the transition is applied and read back, and a failure to write it SHALL NOT change the status of the answer. A task with no open attempt of the stage it leaves gets no record.

#### Scenario: Autonomy answered in a grill

- **WHEN** the human answers `HITL` to the transition question of a task whose grill-me attempt is started, and the transition is applied
- **THEN** that attempt's directory holds a record of the answer `HITL`, its time, and that the human decided it

#### Scenario: AFK task leaves proposal

- **WHEN** transition mode moves an `AFK` task from `proposal` to `implement` while its proposal attempt is open
- **THEN** that attempt's directory holds a record of `implement`, its time, and that the agent decided it

#### Scenario: Manual transition

- **WHEN** a transition answer is applied to a task with no open attempt
- **THEN** no record is written and the answer is `applied`

#### Scenario: Later

- **WHEN** the human answers "Later"
- **THEN** no record is written

### Requirement: Approval question

The question for an `HITL` task in `proposal`, `implement` or `verify` SHALL have the same id shape and step as the transition question, and the same header rule with `approval` in place of `autonomy`. Its text names the source, task id, title and labels, and says that the proposal is ready, for a task in `proposal`, that the implementation is ready, for a task in `implement`, or that the verification is ready, for a task in `verify`. Its options SHALL be `Approve`, with the value of the next stage, `implement`, `verify` or `code-review`, and `Later`, with a null value, and it SHALL accept a single choice. It SHALL NOT ask for autonomy or scope.

#### Scenario: Options

- **WHEN** the approval question is composed for a task carrying `personal`, `HITL` and `proposal`
- **THEN** it offers `Approve` and `Later` only

#### Scenario: Later

- **WHEN** the human answers `Later`
- **THEN** no answer is applied and the task keeps `proposal`

#### Scenario: Implementation ready

- **WHEN** the approval question is composed for a task carrying `personal`, `HITL` and `implement`
- **THEN** it says the implementation is ready, and `Approve` carries the value `verify`

#### Scenario: Verification ready

- **WHEN** the approval question is composed for a task carrying `personal`, `HITL` and `verify`
- **THEN** it says the verification is ready, and `Approve` carries the value `code-review`

### Requirement: Triage questions mode

With `--triage-questions`, the run SHALL read the open tasks of every enabled source as `label-triage` does, compose the questions of the marked tasks as that step does, print them and exit. For a marked task with a question whose listing carries no description, it SHALL read the task for its description; a read that fails SHALL leave the question without one. No step SHALL run, no judgement SHALL be requested and nothing SHALL be written. It needs no quota and takes no lock.

#### Scenario: Marked tasks waiting

- **WHEN** the run is invoked with `--triage-questions` and six marked tasks each lack one group
- **THEN** no step runs, nothing is written and the report lists six questions

#### Scenario: Nothing marked

- **WHEN** the run is invoked with `--triage-questions` and no task carries `triage-me`
- **THEN** the report says there is no marked task and the process exits with code 0

#### Scenario: Description not listed

- **WHEN** the run is invoked with `--triage-questions` and a marked Linear task lacks an autonomy label
- **THEN** the task is read and its question includes the first 300 characters of its description

#### Scenario: Description unreadable

- **WHEN** the description of a marked Linear task cannot be read
- **THEN** its question is listed without a description and the exit code is 0

### Requirement: Triage questions report

The report of `--triage-questions` SHALL carry the count of marked tasks, every question, and a `handoff` in the form of "Handoff of questions for the human": at most 4 questions and `remaining`. The `handoff` SHALL be emitted without `--apply` and SHALL be absent when there is no question. With `--json` the report SHALL be one JSON document identified by `schema: "autonomous.triage-questions.v1"`. The answers SHALL be applied by answer mode.

#### Scenario: More questions than a round holds

- **WHEN** six marked tasks each lack one group
- **THEN** the `handoff` carries the first 4 questions and `remaining` equal to 2

#### Scenario: No question

- **WHEN** no task carries `triage-me`
- **THEN** the report carries no `handoff`

#### Scenario: Answer to a question of the mode

- **WHEN** the user answers `AFK` to a question handed off by `--triage-questions` and the run is invoked with `--apply --answer <id>=AFK`
- **THEN** the answer is applied under the rules of `label-triage`

### Requirement: Triage questions flags and exit code

`--triage-questions` MAY be combined with `--json` only; any other flag SHALL be a usage error with exit code 1. The exit code SHALL be 0 when every enabled source was read, and 3 when a source or the configuration could not be read; in that case the report SHALL give the reason and print no question.

#### Scenario: Source unreachable

- **WHEN** the run is invoked with `--triage-questions` and Linear cannot be read
- **THEN** the reason names Linear and the command, no question is printed, and the process exits with code 3

#### Scenario: Combined with apply

- **WHEN** the run is invoked with `--triage-questions --apply`
- **THEN** the run prints a usage message and exits with code 1

### Requirement: No account flag

The run SHALL NOT accept `--account`, in any mode. Passing it SHALL be a usage error with exit code 1, and the message SHALL say that the run evaluates the account Claude Code is logged in as.

#### Scenario: Account given to a run

- **WHEN** the run is invoked with `--account ana@example.com`
- **THEN** it runs no step, prints a message that says the run evaluates the account Claude Code is logged in as, and exits with code 1

#### Scenario: Account given to the loop

- **WHEN** the step runner is invoked with `--loop --apply --account claude@1a2b3c4d`
- **THEN** it starts no loop, prints the same message, and exits with code 1

### Requirement: Leaving implement needs the work finished

Transition mode and a transition answer SHALL refuse a task in `implement` while, in the task's workspace, the change the stage implements has an unchecked task, the working tree has uncommitted changes, or the branch has commits its remote branch lacks. The change SHALL be found as the stage's prerequisites find it. Transition mode reports every reason that holds, with no handoff and exit code 3; the answer is `rejected`, naming them. Nothing SHALL be written.

#### Scenario: Unchecked task

- **WHEN** `--apply --transition linear:DOT-121` runs for an `AFK` task in `implement` whose change has 11 of 12 tasks checked
- **THEN** the report names the change and the count of unchecked tasks, nothing is written, and the process exits with code 3

#### Scenario: Uncommitted changes

- **WHEN** the workspace of an `HITL` task in `implement` has an uncommitted change
- **THEN** transition mode emits no approval question, names the uncommitted changes, and exits with code 3

#### Scenario: Unpushed commits

- **WHEN** the answer `verify` arrives for a task in `implement` whose branch has two commits its remote branch lacks
- **THEN** the answer is `rejected`, naming the unpushed commits, and the task keeps `implement`

#### Scenario: No workspace

- **WHEN** the transition out of `implement` is requested for a task that has no workspace
- **THEN** nothing is written and the reason says there is no workspace to check

#### Scenario: Work finished

- **WHEN** every task of the change is checked, the working tree is clean and the branch is pushed
- **THEN** the guards pass and the transition proceeds by the task's autonomy

### Requirement: Leaving verify needs the work finished

Transition mode and a transition answer SHALL refuse a task in `verify` on the same guards as a task in `implement`: an unchecked task of the change, uncommitted changes in the working tree, or commits the remote branch lacks, with the change found as the stage's prerequisites find it. Every reason that holds SHALL be reported, and nothing SHALL be written.

#### Scenario: Uncommitted fix

- **WHEN** `--apply --transition linear:DOT-121` runs for an `AFK` task in `verify` whose workspace has an uncommitted change
- **THEN** the report names the uncommitted changes, nothing is written, and the process exits with code 3

#### Scenario: Unpushed fix

- **WHEN** the answer `code-review` arrives for a task in `verify` whose branch has a commit its remote branch lacks
- **THEN** the answer is `rejected`, naming the unpushed commit, and the task keeps `verify`

#### Scenario: Work finished

- **WHEN** every task of the change is checked, the working tree is clean and the branch is pushed
- **THEN** the guards pass and the transition proceeds by the task's autonomy
