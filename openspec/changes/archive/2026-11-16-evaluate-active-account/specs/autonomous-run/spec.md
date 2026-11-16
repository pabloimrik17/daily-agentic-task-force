# Spec Delta

## MODIFIED Requirements

### Requirement: Single entry command

The `autonomous` plugin SHALL expose two commands: `/autonomous:run`, which advances one task by one stage, and `/autonomous:loop`, the continuous mode. Both SHALL execute the same step runner. The arguments of `/autonomous:run` SHALL be passed through to the step runner unchanged.

#### Scenario: Command invocation

- **WHEN** the user runs `/autonomous:run --apply --json`
- **THEN** the step runner is executed with `--apply --json`

#### Scenario: Two commands

- **WHEN** the plugin is installed
- **THEN** it offers `/autonomous:run` and `/autonomous:loop` and no other command

### Requirement: No-handoff flag

The run SHALL accept `--no-handoff`, which prevents the report from carrying a `handoff` and changes nothing else about the run. It is meant for invocations with no human present, such as a `/loop`. The flag MAY be combined with every run flag, and SHALL NOT be combined with `--bootstrap-labels`, `--answer` or `--transition`.

#### Scenario: Loop invocation

- **WHEN** `/loop` runs `/autonomous:run --apply --no-handoff`
- **THEN** the steps run and write as with `--apply`, and no question is asked

#### Scenario: Transition without a handoff

- **WHEN** the run is invoked with `--apply --transition linear:DOT-110 --no-handoff`
- **THEN** the run prints a usage message and exits with code 1

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

## ADDED Requirements

### Requirement: No account flag

The run SHALL NOT accept `--account`, in any mode. Passing it SHALL be a usage error with exit code 1, and the message SHALL say that the run evaluates the account Claude Code is logged in as.

#### Scenario: Account given to a run

- **WHEN** the run is invoked with `--account ana@example.com`
- **THEN** it runs no step, prints a message that says the run evaluates the account Claude Code is logged in as, and exits with code 1

#### Scenario: Account given to the loop

- **WHEN** the step runner is invoked with `--loop --apply --account claude@1a2b3c4d`
- **THEN** it starts no loop, prints the same message, and exits with code 1
