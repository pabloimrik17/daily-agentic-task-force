# Spec Delta

## MODIFIED Requirements

### Requirement: The loop command

The plugin SHALL expose `/autonomous:loop`, which runs the step runner with `--loop` and the command's arguments unchanged. With `--apply` it SHALL start the loop; without `--apply` it SHALL run one dry iteration.

#### Scenario: Loop started

- **WHEN** the user runs `/autonomous:loop --apply`
- **THEN** the step runner is executed with `--loop --apply` and iterations start

#### Scenario: Loop from a shell

- **WHEN** the step runner is executed from a shell with `--loop --apply`
- **THEN** the loop runs without any agent session

### Requirement: Loop flags

`--loop` SHALL combine only with `--apply`, `--force`, `--json`, `--grills`, `--parallel` and `--interval`. `--grills`, `--parallel` and `--interval` SHALL require `--loop`. `--notices` SHALL combine with nothing. `--stop-loop` SHALL combine with nothing. A broken combination or a value that is not an integer in range SHALL be a usage error with exit code 1.

#### Scenario: Limit flag on a run

- **WHEN** `/autonomous:run --parallel 3` is invoked
- **THEN** the run prints a usage message and exits with code 1

#### Scenario: Loop with a supplied task

- **WHEN** the step runner is invoked with `--loop --task linear:DOT-120`
- **THEN** it prints a usage message and exits with code 1

#### Scenario: Interval of zero

- **WHEN** the loop is started with `--interval 0`
- **THEN** it prints a usage message and exits with code 1

#### Scenario: Stop with another flag

- **WHEN** the step runner is invoked with `--stop-loop --apply`
- **THEN** it prints a usage message and exits with code 1

## ADDED Requirements

### Requirement: The active account is read in every iteration

The loop SHALL read the active account again in every iteration. It SHALL NOT keep the account of an earlier iteration.

#### Scenario: Login switched between two iterations

- **WHEN** an iteration evaluates `ana@example.com`, and Claude Code is logged in as `luis@example.com` when the next iteration runs
- **THEN** the next iteration evaluates `luis@example.com`
