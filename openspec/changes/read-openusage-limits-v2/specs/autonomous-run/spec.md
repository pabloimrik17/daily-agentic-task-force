# Spec Delta

## MODIFIED Requirements

### Requirement: Single entry command

The `autonomous` plugin SHALL expose `/autonomous:run` as its only command. Its arguments SHALL be passed through to the step runner unchanged.

#### Scenario: Command invocation

- **WHEN** the user runs `/autonomous:run --account claude@1a2b3c4d`
- **THEN** the step runner is executed with `--account claude@1a2b3c4d`

### Requirement: No-handoff flag

The run SHALL accept `--no-handoff`, which prevents the report from carrying a `handoff` and changes nothing else about the run. It is meant for invocations with no human present, such as a `/loop`. The flag MAY be combined with every run flag, and SHALL NOT be combined with `--bootstrap-labels`, `--answer` or `--transition`.

#### Scenario: Loop invocation

- **WHEN** `/loop` runs `/autonomous:run --account claude@1a2b3c4d --apply --no-handoff`
- **THEN** the steps run and write as with `--apply`, and no question is asked

#### Scenario: Transition without a handoff

- **WHEN** the run is invoked with `--apply --transition linear:DOT-110 --no-handoff`
- **THEN** the run prints a usage message and exits with code 1
