# Spec Delta

## ADDED Requirements

### Requirement: Stopping the loop

The step runner SHALL accept `--stop-loop`, which asks the live loop of the state directory to stop by sending its process one termination signal. It SHALL then wait up to 10 seconds for the loop to end. When the loop ends within that time it SHALL print `loop stopped`; otherwise it SHALL print `loop stopping: the iteration in progress ends first`. In both cases it SHALL exit with code 0. It SHALL need no `--apply` and no configuration, and SHALL take no lock.

#### Scenario: Loop waiting between iterations

- **WHEN** `--stop-loop` is invoked while the loop waits between two iterations
- **THEN** the loop records its stop notice, releases its lock and exits with code 0, and the command prints `loop stopped` and exits with code 0

#### Scenario: Iteration in progress

- **WHEN** `--stop-loop` is invoked during an iteration that lasts longer than 10 seconds
- **THEN** the command prints `loop stopping: the iteration in progress ends first` and exits with code 0, and the loop stops when that iteration ends

#### Scenario: Launch in progress

- **WHEN** `--stop-loop` is invoked while an iteration is launching a session
- **THEN** the launch completes before the loop stops

#### Scenario: Agent waiting for notices

- **WHEN** `--stop-loop` stops a loop while `--notices 3` is waiting in another session
- **THEN** that wait prints the stop notice `loop stopped: received SIGTERM` and `next: 4`

### Requirement: Stopping when no loop is alive

When `--stop-loop` finds no live loop it SHALL print `loop stopped: not running` and exit with code 2, without sending a signal. A loop lock left by a process that no longer exists SHALL count as no live loop and SHALL NOT be removed. When the stop request cannot be sent to a live loop, the command SHALL report the error on standard error and exit with code 1.

#### Scenario: No loop

- **WHEN** `--stop-loop` is invoked and the state directory has no loop lock
- **THEN** the command prints `loop stopped: not running` and exits with code 2

#### Scenario: Lock of a dead loop

- **WHEN** `--stop-loop` is invoked and the loop lock names a process that no longer exists
- **THEN** the command prints `loop stopped: not running`, exits with code 2 and leaves the lock in place

#### Scenario: Loop of another user

- **WHEN** `--stop-loop` is invoked and the loop's process cannot be signalled for lack of permission
- **THEN** the command reports the error on standard error and exits with code 1

### Requirement: Stopping leaves the launched sessions

`--stop-loop` SHALL NOT stop, discard or change any session or attempt. An attempt that was open when the loop stopped SHALL stay open and keep its slot.

#### Scenario: Open attempts

- **WHEN** `--stop-loop` stops a loop that has two open attempts
- **THEN** both sessions keep running, both attempts stay open, and the next run or loop brings them up to date

### Requirement: The stop command

The plugin SHALL expose `/autonomous:loop-stop`, which takes no arguments, asks nothing, executes the step runner once with `--stop-loop`, and shows its standard output and standard error verbatim followed by its exit code. It SHALL add no text of its own.

#### Scenario: Loop stopped from a new session

- **WHEN** the user closed the session that started the loop and runs `/autonomous:loop-stop` in a new one
- **THEN** the step runner is executed with `--stop-loop` and the session shows `loop stopped` and exit code 0

#### Scenario: Nothing to stop

- **WHEN** the user runs `/autonomous:loop-stop` and no loop is alive
- **THEN** the session shows `loop stopped: not running` and exit code 2, and nothing else

## MODIFIED Requirements

### Requirement: Loop flags

`--loop` SHALL combine only with `--apply`, `--account`, `--force`, `--json`, `--grills`, `--parallel` and `--interval`. `--grills`, `--parallel` and `--interval` SHALL require `--loop`. `--notices` SHALL combine with nothing. `--stop-loop` SHALL combine with nothing. A broken combination or a value that is not an integer in range SHALL be a usage error with exit code 1.

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
