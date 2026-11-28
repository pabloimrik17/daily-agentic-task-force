# Design

## Context

See proposal.md - Why. After `exclude-stuck-tasks-from-selection`:

- `loop/loop.ts` `iteration` runs the pipeline, appends the report to `loop.log` and appends `iterationNotices(report)` to `loop.notices`. It knows `io.now()` and `io.intervalMs()`.
- `loop/notices.ts` builds bare strings from the reconcile, label-triage and select data.
- `--notices <n>` counts lines of `loop.notices`; `commands/loop.md` shows them verbatim in a code block and says nothing else.
- Every registered stage declares an `emoji` (`stages/stage.ts`).

## Goals / Non-Goals

**Goals:**

- A person watching the relay session always knows what the last iteration did and when the next one is.
- Lines that read at a glance: one symbol per kind, detail indented under its iteration.

**Non-Goals:**

- A debug mode or a detailed log (the iteration log already holds every report).
- Colour, and a direct terminal output of the loop.
- Lines between iterations, countdowns, reminders by age.
- Changing the `--notices` protocol or the iteration log.

## Decisions

### D1. One summary line per iteration, nothing in between

Between two iterations the loop only sleeps, so the one fact to tell is when it wakes, and the summary line's `next` time says it. Each batch of notices costs the relay session one turn; a countdown would multiply that for no information. Alternative rejected: a notice only when something changed since the last iteration. It brings back the silence this change removes: the person cannot tell a quiet loop from a dead one.

### D2. Summary and detail are appended in one write

`iterationNotices` returns the summary line first and the detail lines after it, and `appendNotices` already writes its lines in one `appendFile`. A wait for notices therefore sees the whole iteration or none of it, and the relay spends one turn per iteration.

### D3. What the summary says comes from the report, by code

The outcome is read from the run report: `launch` advanced with an attempt → `▶ launched <emoji> <stage> <source>:<id>`; otherwise the first step that did not advance gives `⏸ nothing to launch: <step>: <first reason>` for `wait` and `✖ not evaluable: <step>: <first reason>` for `not-evaluable`. An iteration that could not run at all (run lock held) has no steps and uses the report's own reason. No LLM takes part. Only the first reason is shown: `select`'s wait lists a count per exclusion, which belongs in the log.

### D4. Symbols, no colour

`▶ ⏸ ✖ ✔ ⚠ ■` are single-width, render in the relay's code block and need no terminal support. ANSI colour would show as escape codes there, so it is left out until the loop has an output of its own. The stage emoji comes from the stage registry, the same one the session title uses; a stage with no registered implementation is never launched, so the lookup cannot miss.

### D5. Times through `Intl.DateTimeFormat` with the process defaults

`new Intl.DateTimeFormat(locale, { timeStyle: "short" })` with no `timeZone` formats in the process's local zone. `locale` is `undefined` (the runtime default) unless that default ignores the user's settings: task 2.1 verifies under Bun that `LC_ALL`, `LC_TIME` and `LANG` are honoured, and if they are not, the formatter derives the locale from those variables in that order, falling back to the runtime default. The formatter is injected through `LoopIo`, so tests fix the locale and the zone. The date is not shown: a loop's notices are read as they arrive, and the log carries full timestamps.

The `next` time is the moment the summary is built plus `io.intervalMs()`, the same value the loop then waits.

### D6. The stop line keeps the time and drops `next`

`stopNotice` gains the time and the `■` symbol. `wait-notices` recognises the end of the loop from the lock, not from the text, so nothing else changes.

## Risks / Trade-offs

- [One relay turn per iteration costs tokens on a loop that runs all day] → 6 short turns per hour at the default interval; the person can lengthen the interval, and the relay adds no text of its own.
- [A reader that parsed the old strings breaks] → the only known reader is `commands/loop.md`, which shows lines verbatim; the README documents the format.
- [Emoji and symbols render double-width in some terminals and misalign] → nothing depends on alignment: lines are not padded into columns.
- [The runtime's default locale differs from the user's] → D5's check and fallback.

## Migration Plan

This change modifies "Stuck task notices", which `exclude-stuck-tasks-from-selection` added. That change is archived in the pull request below this one, so the requirement is in the main spec. "Order of the stuck task notices" and "Unreadable prerequisites are remembered", which it also added, are not modified: the order applies to the detail lines as it applied to the notices.

No data migration. `loop.notices` is reset when a loop starts, so old and new formats never mix in one file. Rollback is reverting the change.
