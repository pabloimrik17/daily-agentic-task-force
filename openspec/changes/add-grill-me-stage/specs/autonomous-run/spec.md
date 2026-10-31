## ADDED Requirements

### Requirement: Persist mode

With `--persist <attempt-id>`, the run SHALL run no step and SHALL persist that attempt's definition and stage summary as the grill-me stage defines. It SHALL require `--apply` and MAY be combined with `--json` only; any other flag with it, or a malformed attempt id, is a usage error. It SHALL exit 0 when the receipt is written and 3 otherwise. It takes no run lock.

#### Scenario: Persisted

- **WHEN** the run is invoked with `--apply --persist linear:DOT-121:grill-me:1` for a started attempt whose directory holds `definition.md` and `stage-summary.md`
- **THEN** no step runs, the definition and the comment are written and read back, the receipt is written and the process exits with code 0

#### Scenario: Persist without apply

- **WHEN** the run is invoked with `--persist linear:DOT-121:grill-me:1` and without `--apply`
- **THEN** the run prints a usage message and exits with code 1

### Requirement: Persist preconditions

Persist mode SHALL write nothing when the attempt is unknown, is not open, belongs to a stage other than `grill-me`, or its directory lacks `definition.md` or `stage-summary.md`, or either file is empty. It SHALL report the reason and exit 3.

#### Scenario: Missing stage summary

- **WHEN** the attempt directory holds `definition.md` but no `stage-summary.md`
- **THEN** nothing is written to the tracker, the report names the missing file and the process exits with code 3

#### Scenario: Attempt already completed

- **WHEN** the attempt named is `completed`
- **THEN** nothing is written and the process exits with code 3

### Requirement: Persist report

With `--json`, persist mode SHALL print one JSON document identified by `schema: "autonomous.persist.v1"`. It holds the start time, the outcome, the attempt id, the task, what was written and read back, the reasons, and the receipt's path when one was written. Without `--json`, it is a text report of the same information. A configuration that cannot be loaded is reported as in answer mode.

#### Scenario: Persist JSON report

- **WHEN** the run is invoked with `--apply --persist <attempt-id> --json`
- **THEN** stdout contains exactly one JSON document with `schema` equal to `autonomous.persist.v1`

### Requirement: The transition waits for the persistence receipt

Transition mode and a transition answer SHALL refuse a task that has an open `grill-me` attempt whose directory holds no persistence receipt. Transition mode reports it with no handoff and exit code 3. The answer is `rejected`, naming the attempt. A task with no open grill-me attempt SHALL be transitioned as before.

#### Scenario: Definition not persisted

- **WHEN** `--apply --transition linear:DOT-121` runs while attempt `linear:DOT-121:grill-me:1` is started and has no receipt
- **THEN** the report names the attempt and the missing receipt, carries no handoff, and the process exits with code 3

#### Scenario: Definition persisted

- **WHEN** the same attempt holds a receipt
- **THEN** transition mode emits its question as before

#### Scenario: Manual transition

- **WHEN** a task in `grill-me` has no open attempt
- **THEN** transition mode emits its question without checking any receipt
