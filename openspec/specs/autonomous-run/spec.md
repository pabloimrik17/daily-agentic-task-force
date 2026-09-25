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

With `--json`, the run SHALL print a single JSON document identified by `schema: "autonomous.run.v1"`, containing the start time, the result of every executed step (step id, tier, outcome, reasons, data) and the run outcome. Without `--json`, it SHALL print a pre-rendered text report of the same information. The report MAY include a `handoff` field, reserved for future steps that require an agent to act; this iteration never emits it.

#### Scenario: JSON report

- **WHEN** the run is invoked with `--json`
- **THEN** stdout contains exactly one JSON document with `schema` equal to `autonomous.run.v1`

#### Scenario: Text report

- **WHEN** the run is invoked without `--json`
- **THEN** stdout contains a readable report listing each executed step, its outcome and its reasons

### Requirement: Exit code reflects the outcome

The run SHALL exit with 0 for `advance`, 2 for `wait` and 3 for `not-evaluable`. Invalid arguments or an unexpected failure of the runner itself SHALL exit with 1.

#### Scenario: Waiting run

- **WHEN** the run outcome is `wait`
- **THEN** the process exits with code 2

#### Scenario: Unknown argument

- **WHEN** the run is invoked with an unrecognised flag
- **THEN** the process prints a usage message and exits with code 1

### Requirement: The command does not reinterpret the report

The command SHALL relay the runner's output as-is. When the report carries no `handoff`, the agent SHALL take no further action.

#### Scenario: Report without handoff

- **WHEN** the runner finishes without a `handoff`
- **THEN** the agent shows the report and ends the command
