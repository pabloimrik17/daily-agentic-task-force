# Spec Delta

## REMOVED Requirements

### Requirement: Notices

**Reason**: Notices were recorded only for a few events, so an iteration that launched a session or launched nothing told the person nothing. The requirement is replaced by "Iteration summary line", "Detail lines", "Stop line", "Notice symbols" and "Notice times".

**Migration**: Every event that produced a notice still produces a line, now as a detail line under its iteration's summary line, with a symbol in front. A reader that matched the old strings matches the text after the symbol. The loop's stop notice becomes the stop line.

## ADDED Requirements

### Requirement: Iteration summary line

Every iteration SHALL record exactly one summary line, whatever its outcome, in the form `<time> <symbol> <what happened> · next <time>`. What happened SHALL be the launch, naming the stage and the task; or that nothing was launched, naming the step that waited and its first reason; or that the iteration was not evaluable, naming the step and its first reason. The loop SHALL record nothing between iterations.

#### Scenario: Launch

- **WHEN** an iteration that ends at 10:40 launches `beads:X-12` for `proposal` and the interval is 10 minutes
- **THEN** its summary line is `10:40 ▶ launched 📝 proposal beads:X-12 · next 10:50`, with the emoji the `proposal` stage declares

#### Scenario: Slots full

- **WHEN** an iteration waits at `capacity` because every slot kind is full
- **THEN** its summary line carries `⏸ nothing to launch: capacity:` and that step's first reason

#### Scenario: Not evaluable

- **WHEN** an iteration finds the run lock held by another process
- **THEN** its summary line carries `✖ not evaluable:` and the reason

#### Scenario: Between iterations

- **WHEN** the loop waits out its interval
- **THEN** no line is recorded

### Requirement: Stuck count in the summary line

When the iteration's selection found stuck tasks of the machine scope, the summary line SHALL carry `· <n> need you` before the next iteration's time, counting all of them, told or not. With none, or when selection did not run, it SHALL carry no count.

#### Scenario: Three stuck tasks already told

- **WHEN** an iteration launches a session and its selection excluded three stuck tasks of the machine scope, all told by an earlier iteration
- **THEN** the summary line carries `· 3 need you` and no detail line names them

#### Scenario: Selection did not run

- **WHEN** an iteration waits at the quota gate
- **THEN** the summary line carries no count

### Requirement: Detail lines

After its summary line, an iteration SHALL record one detail line, indented by two spaces, for each of: an attempt it finalised, with the task, the stage it completed and the stage label the task now carries, or `closed`; an attempt it newly retained, with the reason; the tasks it newly marked `triage-me`, as a count and at most five names; each stuck task notice. A session that waits for the person and a task that already carried `triage-me` SHALL produce no line.

#### Scenario: Stage completed

- **WHEN** an iteration finalises `linear:DOT-98:grill-me:1` and the task now carries `proposal`
- **THEN** a detail line says `✔ linear:DOT-98 grill-me → proposal`

#### Scenario: Attempt retained

- **WHEN** an iteration retains `linear:DOT-77:grill-me:1` because its session exited
- **THEN** a detail line starts with `⚠ retained linear:DOT-77:grill-me:1:` and gives the reason

#### Scenario: Tasks newly marked

- **WHEN** an iteration adds `triage-me` to `linear:DOT-130` and `beads:X-12`
- **THEN** a detail line says `⚠ triage-me +2: linear:DOT-130, beads:X-12`

#### Scenario: Many tasks newly marked

- **WHEN** an iteration adds `triage-me` to eight tasks
- **THEN** the detail line says `⚠ triage-me +8:`, names five of them and ends with `…`

#### Scenario: Stuck task

- **WHEN** an iteration tells `beads:X-12` as stuck for the first time
- **THEN** a detail line says `⚠ stuck beads:X-12:` followed by the reason

#### Scenario: Nothing beyond the summary

- **WHEN** an iteration launches a session and finalises, retains, marks and newly tells nothing
- **THEN** it records its summary line and no detail line

#### Scenario: Session waiting for the person

- **WHEN** an iteration observes a session that needs a person
- **THEN** no detail line is recorded for it

### Requirement: An iteration's lines are recorded together

The summary line of an iteration and its detail lines SHALL be recorded in one write, the summary line first.

#### Scenario: Recorded together

- **WHEN** an iteration has a summary line and three detail lines
- **THEN** a wait for notices that ends because of this iteration prints all four lines

### Requirement: Stop line

When the loop stops, it SHALL record one line `<time> ■ loop stopped: <reason>`, with no next iteration's time.

#### Scenario: Stopped by the person

- **WHEN** the loop receives a stop request at 11:02
- **THEN** the last line of its notices is `11:02 ■ loop stopped:` followed by the reason

### Requirement: Notice symbols

Each line SHALL start, after its time when it has one, with the symbol of its kind: `▶` a launch, `⏸` nothing to launch, `✖` not evaluable, `✔` an attempt finalised, `⚠` something that needs the person, `■` the loop stopped. A stage named in a launch SHALL be preceded by the emoji that stage declares. Lines SHALL carry no colour or other terminal control sequence.

#### Scenario: No control sequences

- **WHEN** any notice is recorded
- **THEN** it holds no escape character

#### Scenario: One symbol per kind

- **WHEN** an iteration retains an attempt and tells a stuck task
- **THEN** both detail lines start with `⚠`

### Requirement: Notice times

Every time in a notice SHALL be the hour and minute in the time zone and the locale of the user who runs the loop, in that locale's short time format. The time of a summary line SHALL be when the iteration ended, and its next time SHALL be when the following iteration is due.

#### Scenario: Spanish locale in Madrid

- **WHEN** the loop runs with locale `es-ES` and time zone `Europe/Madrid`, and an iteration ends at 09:40 UTC in winter
- **THEN** its summary line starts with `10:40`

#### Scenario: Twelve-hour locale

- **WHEN** the loop runs with locale `en-US` and the same iteration ends at 15:40 local time
- **THEN** its summary line starts with `3:40 PM`

#### Scenario: Interval changed

- **WHEN** the configured interval is 5 minutes and an iteration ends at 10:40
- **THEN** its summary line ends with `next 10:45`

## MODIFIED Requirements

### Requirement: Stuck task notices

An iteration SHALL record, as detail lines, one notice per stuck task of the machine scope that the loop has not yet told with that reason, as `⚠ stuck <source>:<id>: <reason>`. When more than five are new in one iteration, it SHALL record the first five and one more line with the count of the rest and where the full list is. A stuck task outside the machine scope SHALL NOT produce a notice.

#### Scenario: First time

- **WHEN** an iteration excludes `beads:X-12`, of the machine scope, as repository
- **THEN** one detail line says `⚠ stuck beads:X-12:` followed by the reason

#### Scenario: Same task and reason in the next iteration

- **WHEN** the next iteration excludes `beads:X-12` for the same reason
- **THEN** no detail line is recorded for it

#### Scenario: Reason changed

- **WHEN** `beads:X-12` gains a repository label and is then excluded as repository prerequisites
- **THEN** one detail line names it with the new reason

#### Scenario: Many stuck tasks

- **WHEN** the first iteration finds 56 stuck tasks of the machine scope
- **THEN** five detail lines name one task each, and one says that 51 more are stuck and names the iteration log

#### Scenario: Other scope

- **WHEN** the machine scope is `personal` and a `work` task is excluded as repository
- **THEN** no detail line is recorded for it, and the iteration's report still lists it as stuck

#### Scenario: Scope changed

- **WHEN** the machine scope is `personal` and `beads:X-12`, a `work` task excluded as repository, gains `personal` with the same reason
- **THEN** one detail line names it

#### Scenario: New loop

- **WHEN** the loop is stopped and started again, and `beads:X-12` is still stuck for the same reason
- **THEN** the first iteration of the new loop records its detail line again

### Requirement: The command relays only notices

`/autonomous:loop --apply` SHALL start the loop in the background, wait for notices in the background, show each notice verbatim and wait again from the new count. Once the loop has started it SHALL NOT read the iteration log or add any text of its own, and SHALL stop waiting after a stop notice. The rounds of questions before the loop starts are the only other thing the command does.

#### Scenario: Quiet day

- **WHEN** the loop runs for a day and no iteration launches, finalises, retains, marks or tells anything
- **THEN** the agent that started it receives one summary line per iteration and nothing else

#### Scenario: Notice relayed

- **WHEN** the wait prints the detail line `✔ linear:DOT-98 grill-me → proposal`, indented by two spaces, and `next: 4`
- **THEN** the agent shows that line, with its indentation, and waits again with `--notices 4`
