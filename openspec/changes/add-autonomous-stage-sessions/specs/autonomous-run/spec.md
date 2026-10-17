# Spec Delta

## ADDED Requirements

### Requirement: Supplied task flags

The run SHALL accept `--task <source>:<id>`, which skips `label-triage` and `select` and gives that task to `launch`, and `--stage <stage>`, which names the stage to launch. `--stage` without `--task` is a usage error. Both MAY be combined with `--account`, `--force`, `--json`, `--apply` and `--no-handoff`, and SHALL NOT be combined with `--bootstrap-labels`, `--answer` or `--discard`.

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

## MODIFIED Requirements

### Requirement: Ordered steps stop at the first non-advance

The run SHALL execute its steps in a fixed order: `reconcile`, `quota-gate`, `label-triage`, `select`, `launch`. Each step SHALL produce an outcome of `advance`, `wait` or `not-evaluable`, a list of human-checkable reasons, and step-specific data. The run SHALL stop at the first step whose outcome is not `advance`, and the run outcome SHALL be that step's outcome, or `advance` when every step advanced.

#### Scenario: Gate does not advance

- **WHEN** `quota-gate` returns `wait`
- **THEN** no later step runs and the run outcome is `wait`

#### Scenario: All steps advance

- **WHEN** every step returns `advance`
- **THEN** the run outcome is `advance`

#### Scenario: Reconcile runs before the gate

- **WHEN** a run starts
- **THEN** `reconcile` runs before `quota-gate`
