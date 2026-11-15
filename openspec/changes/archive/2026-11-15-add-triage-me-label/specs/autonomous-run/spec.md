# Spec Delta

## ADDED Requirements

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
