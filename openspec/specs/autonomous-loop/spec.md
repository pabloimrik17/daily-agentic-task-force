# autonomous-loop Specification

## Purpose
The continuous mode of the runner: repeats iterations at a fixed interval under the slot limits, keeps going through waits and failed reads, and tells the agent that started it only what that agent needs to know.

## Requirements

### Requirement: The loop command

The plugin SHALL expose `/autonomous:loop`, which runs the step runner with `--loop` and the command's arguments unchanged. With `--apply` it SHALL start the loop; without `--apply` it SHALL run one dry iteration.

#### Scenario: Loop started

- **WHEN** the user runs `/autonomous:loop --apply`
- **THEN** the step runner is executed with `--loop --apply` and iterations start

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

The loop SHALL record a notice, one line each, only when: an iteration finalises an attempt, naming the task, the stage it completed and the stage label the task now carries, or `closed`; an iteration newly retains an attempt, naming the attempt and the reason; an iteration adds `triage-me` to one or more tasks, naming how many and at most five of them; the loop stops, naming the reason. A session that waits for the person SHALL NOT produce a notice. A task that already carried `triage-me` SHALL NOT produce a notice.

#### Scenario: Stage completed

- **WHEN** an iteration finalises `linear:DOT-98:grill-me:1` and the task now carries `proposal`
- **THEN** one notice says `linear:DOT-98 grill-me → proposal`

#### Scenario: Attempt retained

- **WHEN** an iteration retains `linear:DOT-77:grill-me:1` because its session exited
- **THEN** one notice names that attempt as retained, with the reason

#### Scenario: Tasks newly marked

- **WHEN** an iteration adds `triage-me` to `linear:DOT-130` and `beads:X-12`
- **THEN** one notice says `triage-me +2: linear:DOT-130, beads:X-12`

#### Scenario: Many tasks newly marked

- **WHEN** an iteration adds `triage-me` to eight tasks
- **THEN** one notice says `triage-me +8:`, names five of them and ends with `…`

#### Scenario: Marked in an earlier iteration

- **WHEN** an iteration reads two tasks that already carry `triage-me` and marks none
- **THEN** no notice is recorded for them

#### Scenario: Iteration with nothing to tell

- **WHEN** an iteration launches a session and finalises, retains or marks nothing
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

`/autonomous:loop --apply` SHALL start the loop in the background, wait for notices in the background, show each notice verbatim and wait again from the new count. Once the loop has started it SHALL NOT read the iteration log or add any text of its own, and SHALL stop waiting after a stop notice. The rounds of questions before the loop starts are the only other thing the command does.

#### Scenario: Quiet day

- **WHEN** the loop runs for a day and records no notice
- **THEN** the agent that started it receives nothing

#### Scenario: Notice relayed

- **WHEN** the wait prints `linear:DOT-98 grill-me → proposal` and `next: 4`
- **THEN** the agent shows that line and waits again with `--notices 4`

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

### Requirement: Questions before the loop starts

Before it starts the loop, `/autonomous:loop --apply` SHALL execute the step runner with `--triage-questions` once and ask every question the report lists, in the report's order, in rounds of at most 4, as `/autonomous:run` asks a run's handoff. After each round it SHALL apply that round's answers through answer mode. It SHALL start the loop when no question is left, or as soon as every question of a round is answered `Later`. When `--triage-questions` does not finish within the command's time limit, the command SHALL say so and start the loop without asking.

#### Scenario: Marked tasks when the loop starts

- **WHEN** the user runs `/autonomous:loop --apply` and three marked tasks each lack one group
- **THEN** the command asks three questions in one round, applies the answers, and then starts the loop

#### Scenario: More than one round waiting

- **WHEN** `--triage-questions` lists 9 questions
- **THEN** the command asks rounds of 4, 4 and 1, applies the answers after each, and then starts the loop

#### Scenario: A round left for later

- **WHEN** 9 questions are listed and the user chooses `Later` for the four questions of the first round
- **THEN** nothing is written, the other 5 questions are not asked, and the loop starts

#### Scenario: One question left for later

- **WHEN** the user answers three questions of a round and chooses `Later` for the fourth
- **THEN** the three answers are applied, the fourth is not asked again in this start, and the next round is asked

#### Scenario: Nothing marked

- **WHEN** `--triage-questions` reports no marked task
- **THEN** the command starts the loop without asking anything

#### Scenario: The questions are not read in time

- **WHEN** `--triage-questions` is still running when the command's time limit ends
- **THEN** the command says the questions could not be read in time, does not run the mode again, and starts the loop without asking anything

### Requirement: The loop's process never asks

The loop's process SHALL never ask a question, and a loop started from a shell SHALL start without the rounds of questions. A dry iteration SHALL NOT execute `--triage-questions`. When `--triage-questions` exits with code 3, the command SHALL show the reason and start the loop without asking.

#### Scenario: Dry iteration

- **WHEN** the user runs `/autonomous:loop` without `--apply`
- **THEN** `--triage-questions` is not executed and no question is asked

#### Scenario: Loop from a shell

- **WHEN** the step runner is executed from a shell with `--loop --apply`
- **THEN** the loop starts and no question is asked

#### Scenario: Trackers unreachable before the start

- **WHEN** `--triage-questions` exits with code 3 because Linear cannot be read
- **THEN** the command shows the reason and starts the loop

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

### Requirement: The active account is read in every iteration

The loop SHALL read the active account again in every iteration. It SHALL NOT keep the account of an earlier iteration.

#### Scenario: Login switched between two iterations

- **WHEN** an iteration evaluates `ana@example.com`, and Claude Code is logged in as `luis@example.com` when the next iteration runs
- **THEN** the next iteration evaluates `luis@example.com`

### Requirement: Stuck task notices

Beside the notices that "Notices" lists, an iteration SHALL record one notice per stuck task of the machine scope that the loop has not yet told with that reason, as `stuck <source>:<id>: <reason>`. When more than five are new in one iteration, it SHALL record the first five and one more line with the count of the rest and where the full list is. A stuck task outside the machine scope SHALL NOT produce a notice.

#### Scenario: First time

- **WHEN** an iteration excludes `beads:X-12`, of the machine scope, as repository
- **THEN** one notice says `stuck beads:X-12:` followed by the reason

#### Scenario: Same task and reason in the next iteration

- **WHEN** the next iteration excludes `beads:X-12` for the same reason
- **THEN** no notice is recorded for it

#### Scenario: Reason changed

- **WHEN** `beads:X-12` gains a repository label and is then excluded as repository prerequisites
- **THEN** one notice names it with the new reason

#### Scenario: Many stuck tasks

- **WHEN** the first iteration finds 56 stuck tasks of the machine scope
- **THEN** five notices name one task each, and one notice says that 51 more are stuck and names the iteration log

#### Scenario: Other scope

- **WHEN** the machine scope is `personal` and a `work` task is excluded as repository
- **THEN** no notice is recorded for it, and the iteration's report still lists it as stuck

#### Scenario: Scope changed

- **WHEN** the machine scope is `personal` and `beads:X-12`, a `work` task excluded as repository, gains `personal` with the same reason
- **THEN** one notice names it

#### Scenario: New loop

- **WHEN** the loop is stopped and started again, and `beads:X-12` is still stuck for the same reason
- **THEN** the first iteration of the new loop records its notice again

### Requirement: Order of the stuck task notices

The stuck task notices of an iteration SHALL be ordered before the first five are taken: tasks stuck for a retained attempt, for prerequisites or for unreadable prerequisites, then for repository prerequisites, then for repository. Inside each group the order SHALL be the order of the report.

#### Scenario: Most actionable first

- **WHEN** an iteration finds, new and of the machine scope, six tasks stuck as repository and then one stuck as prerequisites
- **THEN** the first notice names the task stuck as prerequisites, four name tasks stuck as repository, and one says that 2 more are stuck

### Requirement: Unreadable prerequisites are remembered

When an iteration's selection is `not-evaluable` and names a task whose prerequisites could not be read, the loop SHALL remember that task and reason for the rest of the loop and SHALL record no notice for it. A new loop SHALL start with nothing remembered.

#### Scenario: Remembered without a notice

- **WHEN** an iteration's selection is `not-evaluable` because the prerequisites of `linear:DOT-1` cannot be read
- **THEN** no notice is recorded for it, and the next iteration's selection is given that the task was named

#### Scenario: Told when set aside

- **WHEN** the next iteration excludes `linear:DOT-1` as unreadable prerequisites and the task is of the machine scope
- **THEN** one notice says `stuck linear:DOT-1:` followed by the read error
