# Spec Delta

## MODIFIED Requirements

### Requirement: Single entry command

The `autonomous` plugin SHALL expose two commands: `/autonomous:run`, which advances one task by one stage, and `/autonomous:loop`, the continuous mode. Both SHALL execute the same step runner. The arguments of `/autonomous:run` SHALL be passed through to the step runner unchanged.

#### Scenario: Command invocation

- **WHEN** the user runs `/autonomous:run --account claude`
- **THEN** the step runner is executed with `--account claude`

#### Scenario: Two commands

- **WHEN** the plugin is installed
- **THEN** it offers `/autonomous:run` and `/autonomous:loop` and no other command

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
