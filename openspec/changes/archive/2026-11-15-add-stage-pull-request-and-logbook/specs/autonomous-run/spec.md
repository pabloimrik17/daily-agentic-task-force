# Spec Delta

## ADDED Requirements

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

When a transition answer is applied to a task that has an open attempt, answer mode SHALL write, in that attempt's directory, a record of the answer: the labels answered and the time. The record SHALL be written only after the transition is applied and read back, and a failure to write it SHALL NOT change the status of the answer. A task with no open attempt leaves no record.

#### Scenario: Autonomy answered in a grill

- **WHEN** the human answers `HITL` to the transition question of a task whose grill-me attempt is started, and the transition is applied
- **THEN** that attempt's directory holds a record of the answer `HITL` and its time

#### Scenario: Manual transition

- **WHEN** a transition answer is applied to a task with no open attempt
- **THEN** no record is written and the answer is `applied`

#### Scenario: Later

- **WHEN** the human answers "Later"
- **THEN** no record is written
