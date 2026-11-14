# Spec Delta

## ADDED Requirements

### Requirement: Questions before the loop starts

Before it starts the loop, `/autonomous:loop --apply` SHALL execute the step runner with `--triage-questions` once and ask every question the report lists, in the report's order, in rounds of at most 4, as `/autonomous:run` asks a run's handoff. After each round it SHALL apply that round's answers through answer mode. It SHALL start the loop when no question is left, or as soon as every question of a round is answered `Later`.

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

## MODIFIED Requirements

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

### Requirement: The command relays only notices

`/autonomous:loop --apply` SHALL start the loop in the background, wait for notices in the background, show each notice verbatim and wait again from the new count. Once the loop has started it SHALL NOT read the iteration log or add any text of its own, and SHALL stop waiting after a stop notice. The rounds of questions before the loop starts are the only other thing the command does.

#### Scenario: Quiet day

- **WHEN** the loop runs for a day and records no notice
- **THEN** the agent that started it receives nothing

#### Scenario: Notice relayed

- **WHEN** the wait prints `linear:DOT-98 grill-me → proposal` and `next: 4`
- **THEN** the agent shows that line and waits again with `--notices 4`
