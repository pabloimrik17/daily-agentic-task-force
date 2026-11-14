# Spec Delta

## Purpose

The continuous mode of the runner: repeats iterations at a fixed interval under the slot limits, keeps going through waits and failed reads, and tells the agent that started it only what that agent needs to know.

## ADDED Requirements

### Requirement: The loop command

The plugin SHALL expose `/autonomous:loop`, which runs the step runner with `--loop` and the command's arguments unchanged. With `--apply` it SHALL start the loop; without `--apply` it SHALL run one dry iteration.

#### Scenario: Loop started

- **WHEN** the user runs `/autonomous:loop --account claude --apply`
- **THEN** the step runner is executed with `--loop --account claude --apply` and iterations start

#### Scenario: Loop from a shell

- **WHEN** the step runner is executed from a shell with `--loop --apply`
- **THEN** the loop runs without any agent session

### Requirement: An iteration

An iteration SHALL run the steps of a run without a supplied task, in the same order and under the same rules, with the slot limits enforced and with no handoff. It SHALL launch at most one session.

#### Scenario: One launch per iteration

- **WHEN** an iteration finds two free slots and three candidates
- **THEN** it launches one session and the next iteration may launch another

#### Scenario: Question left by triage

- **WHEN** `label-triage` cannot decide the scope of a task during an iteration
- **THEN** the iteration's report lists the group as left for the human and carries no handoff

### Requirement: The interval

The loop SHALL wait the interval between the end of one iteration and the start of the next. The interval SHALL be `runner.intervalMinutes`, an integer of 1 or more, and `--interval <minutes>` SHALL replace it for that loop.

#### Scenario: Shipped default

- **WHEN** the file has no `runner` block and `--interval` is not given
- **THEN** the next iteration starts 10 minutes after the previous one ended

#### Scenario: Interval flag

- **WHEN** the loop is started with `--interval 30`
- **THEN** the next iteration starts 30 minutes after the previous one ended

### Requirement: Dry iteration

`--loop` without `--apply` SHALL run exactly one iteration that writes nothing, print its report as a run does, and exit with the code of its outcome. It SHALL NOT take the loop lock, write the iteration log or write a notice.

#### Scenario: What the loop would do

- **WHEN** `/autonomous:loop` is invoked without `--apply` and a grill slot is free
- **THEN** the report shows the capacity, the unit the loop would launch, and nothing is written

### Requirement: The loop keeps going

An iteration whose outcome is `advance`, `wait` or `not-evaluable` SHALL NOT stop the loop. The loop SHALL stop only on a runner error or when its process is asked to stop. It SHALL exit with code 0 when a person stopped it and 1 on a runner error.

#### Scenario: Quota exhausted

- **WHEN** an iteration ends in `wait` because the Claude account has no quota
- **THEN** the loop waits the interval and runs the next iteration

#### Scenario: Tracker unreachable

- **WHEN** an iteration ends in `not-evaluable` because Linear cannot be read
- **THEN** the loop waits the interval and runs the next iteration

#### Scenario: Run lock held by a manual run

- **WHEN** an iteration starts while a manual run holds the run lock
- **THEN** the iteration is `not-evaluable` and the loop continues

#### Scenario: Stopped by the person

- **WHEN** the loop's process receives an interrupt or a termination signal
- **THEN** the loop releases its lock, writes the stop notice and exits with code 0

### Requirement: Loop lock

A loop SHALL hold a loop lock in the state directory from its start to its end. A loop that finds the lock held by a live process SHALL NOT start: it SHALL name the other loop and exit with code 3. A lock left by a process that no longer exists SHALL be reclaimed. The loop lock SHALL NOT keep a run from running.

#### Scenario: Second loop

- **WHEN** a loop starts while another loop is alive on the same state directory
- **THEN** the second loop exits with code 3, names the first and runs no iteration

#### Scenario: Loop that died

- **WHEN** the loop lock names a process that no longer exists
- **THEN** the new loop reclaims the lock and starts

#### Scenario: Manual run while the loop waits

- **WHEN** `/autonomous:run --apply` is invoked while a loop waits between two iterations
- **THEN** the run executes as usual

### Requirement: Iteration log

The loop SHALL append the report of every iteration to a log in the state directory, with the iteration's start time, in the form `--json` selects. The log SHALL be the only place where a full iteration report is written.

#### Scenario: Iteration recorded

- **WHEN** an iteration ends in `wait` because every slot kind is full
- **THEN** the log gains that iteration's report and the loop's standard output gains nothing

### Requirement: Notices

The loop SHALL record a notice, one line each, only when: an iteration finalises an attempt, naming the task, the stage it completed and the stage label the task now carries, or `closed`; an iteration newly retains an attempt, naming the attempt and the reason; the loop stops, naming the reason. A session that waits for the person SHALL NOT produce a notice.

#### Scenario: Stage completed

- **WHEN** an iteration finalises `linear:DOT-98:grill-me:1` and the task now carries `proposal`
- **THEN** one notice says `linear:DOT-98 grill-me → proposal`

#### Scenario: Attempt retained

- **WHEN** an iteration retains `linear:DOT-77:grill-me:1` because its session exited
- **THEN** one notice names that attempt as retained, with the reason

#### Scenario: Iteration with nothing to tell

- **WHEN** an iteration launches a session and finalises or retains nothing
- **THEN** no notice is recorded

#### Scenario: Session waiting for the person

- **WHEN** an iteration observes a session that needs a person
- **THEN** no notice is recorded

### Requirement: Waiting for notices

The step runner SHALL accept `--notices <n>`, which prints the notices recorded after the first `n` of the current loop, one per line, followed by a line `next: <m>` with the new count, and exits with code 0. While there is none and the loop is alive it SHALL wait.

#### Scenario: Notice arrives

- **WHEN** `--notices 0` is waiting and the loop records its first notice
- **THEN** the command prints that notice and `next: 1`, and exits with code 0

### Requirement: Waiting when no loop is alive

When `--notices <n>` finds no live loop, it SHALL first wait up to 10 seconds for one to start. If none starts, it SHALL print the notices it has as usual or, when there is none, print `loop stopped: not running` and exit with code 2. Notices left by an earlier loop SHALL NOT be printed for a loop that has just started.

#### Scenario: Wait started before the loop

- **WHEN** `--notices 0` starts a moment before the loop takes its lock, and the notices of an earlier loop are still on disk
- **THEN** the command prints none of the earlier notices and waits for the new loop's first notice

#### Scenario: Loop killed

- **WHEN** `--notices 3` is waiting and the loop's process disappears without recording a stop notice
- **THEN** the command prints `loop stopped: not running` and exits with code 2

#### Scenario: Stop notice not yet read

- **WHEN** `--notices 3` starts after the loop stopped and recorded its stop notice as the fourth
- **THEN** the command prints the stop notice and `next: 4`, and exits with code 0

### Requirement: The command relays only notices

`/autonomous:loop --apply` SHALL start the loop in the background, wait for notices in the background, show each notice verbatim and wait again from the new count. It SHALL NOT read the iteration log or add any text of its own, and SHALL stop waiting after a stop notice.

#### Scenario: Quiet day

- **WHEN** the loop runs for a day and records no notice
- **THEN** the agent that started it receives nothing

#### Scenario: Notice relayed

- **WHEN** the wait prints `linear:DOT-98 grill-me → proposal` and `next: 4`
- **THEN** the agent shows that line and waits again with `--notices 4`

### Requirement: Loop flags

`--loop` SHALL combine only with `--apply`, `--account`, `--force`, `--json`, `--grills`, `--parallel` and `--interval`. `--grills`, `--parallel` and `--interval` SHALL require `--loop`. `--notices` SHALL combine with nothing. A broken combination or a value that is not an integer in range SHALL be a usage error with exit code 1.

#### Scenario: Limit flag on a run

- **WHEN** `/autonomous:run --parallel 3` is invoked
- **THEN** the run prints a usage message and exits with code 1

#### Scenario: Loop with a supplied task

- **WHEN** the step runner is invoked with `--loop --task linear:DOT-120`
- **THEN** it prints a usage message and exits with code 1

#### Scenario: Interval of zero

- **WHEN** the loop is started with `--interval 0`
- **THEN** it prints a usage message and exits with code 1
