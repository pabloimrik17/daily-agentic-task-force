# Proposal

## Why

The loop tells the person almost nothing: an iteration that launches a session, or that launches nothing, records no notice, so for half an hour the relay session shows no sign of what the loop is doing or when it will try again (DOT-174). The notices that do exist are bare strings with no time and no visual structure.

## What Changes

- Every iteration records exactly one summary line: the time, a symbol for the outcome, what happened (the launch, or why nothing was launched), how many stuck tasks need the person, and the time of the next iteration.
- What the iteration has to tell beyond that (finalised and retained attempts, tasks newly marked `triage-me`, stuck tasks) follows as detail lines indented under its summary line.
- Times are shown in the user's locale and time zone.
- Each kind of line has a fixed symbol, and a task's stage is shown with the stage's emoji. No colour: the relay shows notices in a code block.
- Nothing is recorded between iterations.
- The rule that a launch tells nothing is removed, and so is the "quiet day" with no notice.

No breaking change for a person. An agent or script that parsed the old notice strings must read the new ones; the `--notices <n>` protocol and the `next: <m>` line do not change.

This change builds on `exclude-stuck-tasks-from-selection`, which adds the stuck task notices, and is delivered as the pull request stacked on it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `autonomous-loop`: the "Notices" requirement is replaced by a summary line per iteration, detail lines, a stop line, their symbols and their times; the stuck task notices become detail lines; the command still relays notices verbatim, now at least once per iteration.

## Impact

- `plugins/autonomous/src/loop/`: `notices.ts`, `loop.ts` (the next iteration's time), their tests, and `wait-notices` tests where they quote notice text.
- `plugins/autonomous/src/stages/registry.ts`: read for the stage emoji.
- `plugins/autonomous/commands/loop.md` and `plugins/autonomous/README.md`: the notice format and the removal of "say nothing".
- The relay session spends one turn per iteration (6 per hour at the default 10-minute interval) instead of none on a quiet loop.
