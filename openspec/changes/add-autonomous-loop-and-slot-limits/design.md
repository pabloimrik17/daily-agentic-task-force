# Design

## Context

See `proposal.md` for the motivation and the decisions taken with the user.

The runner is one script, `plugins/autonomous/src/run.ts`. A run takes the run lock, executes an ordered list of steps (`runSteps` in `runner.ts`) and prints one report. Each step sees the results of the steps before it through `ctx.results`. Attempts live as records in the state directory; `reconcile` reads every record and reports it in `ReconcileData.attempts`, with its state after the step.

Three facts shape the approach:

- The stage of an attempt is part of its id (`<source>:<task>:<stage>:<n>`), and "open" is already defined by the stage-sessions spec. Slots need no new state.
- The configuration overlay of ADR 0003 (`overlay` in `config.ts`) already fills optional blocks from `config.defaults.json` and records the keys that took a default.
- `label-triage` keeps no memory between runs. This design does not change that (DOT-127 does).

Every part of this change is tier `code`. It adds no LLM call.

## Goals / Non-Goals

**Goals:**

- A loop that is a plain process: no agent, no tokens while it waits, and usable from a shell.
- One implementation of an iteration: the same steps a run executes, with a flag that enforces the limits.
- A context of the starting agent that stays empty on a quiet day.

**Non-Goals:**

- Any memory of undecided tasks, and any question asked by the loop (DOT-127).
- A scheduler abstraction, a daemon manager (launchd, cron) or a stop command.
- Changing how `reconcile` decides, how `launch` writes, or the run report schema id.

## Decisions

### D1 — Slots are derived from the attempt records

`capacity` counts the attempts that are open in the result of `reconcile` (`ctx.results`), by the stage in the attempt id: `grill-me` is a grill slot, every other stage a work slot. Nothing new is stored.

Alternative: count sessions of the session manager. Rejected: a retained attempt whose session is gone must still occupy its slot, and sessions made by hand must not.

### D2 — `capacity` is a step, and the loop flag is what enforces it

A new step `capacity` runs after `reconcile`. Its data holds, per kind, the occupied count, the limit, the source of the limit and the attempt ids. With `args.loop` it is `wait` when every kind is full; otherwise it is always `advance`. It runs with `--task` too, so every report shows the capacity.

It sits before `quota-gate` so that a full loop reads no quota, judges no task and compares no candidate.

Alternative: check the limit inside `launch`. Rejected: the LLM comparison would already have run, and `select` could not filter by kind.

### D3 — Limits resolve in one place: flag, then file, then default

`config.ts` gains the optional block `runner` (`grills`, `parallel`, `intervalMinutes`) through the existing overlay. A small function resolves each value and its source: a loop flag gives `flag`; a key listed in `defaulted` gives `default`; otherwise `file`. `capacity` and the loop both use it.

### D4 — Selection: slot filter, then stage order, then the existing choice

- `selectCandidates` gains a last exclusion, `no-free-slot`, applied only when `args.loop` is set, from the data of `capacity`.
- A pure function in `select/stage.ts` splits the candidates into the kept ones and the ones set aside. The order of stages is the order of `STAGE_LABELS` in the label contract, exported from `contract.ts`.
- `choose` receives the kept candidates only. `SelectData` gains `setAside`.

The order of stages comes from the contract so that the proposal stage change, which makes `proposal` supported, needs no edit here.

Alternative: pass the stage as a hint to the comparison. Rejected by the user: the rule must be deterministic.

### D5 — The loop wraps the pipeline

`run.ts` gains `runLoop`. It takes the loop lock, then repeats: run the pipeline with `loop: true` and no handoff, send the report to the log, record the notices, wait the interval. The clock, the wait and the stop signal are dependencies of `main`, so tests drive several iterations without real time.

Without `--apply`, `runLoop` runs one iteration, prints the report to standard output as a run does, and takes no loop lock.

A stop request (SIGINT or SIGTERM) ends the wait at once. During an iteration it is honoured when the iteration ends, so a launch is never cut in the middle. A thrown error ends the loop with code 1 after the stop notice.

### D6 — The loop lock reuses the run lock code

`attempts/lock.ts` takes the file name as a parameter. The loop holds `loop.lock` for its whole life and `run.lock` only during an iteration. A run never looks at `loop.lock`.

### D7 — Log and notices are two files in the state directory

- `loop.log`: one entry per iteration, the text report or one JSON line with `--json`. At the start of a loop the previous file is renamed `loop.log.1`, so the log is bounded to two loops.
- `loop.notices`: one line per notice. It is emptied at the start of a loop, so the count in `--notices <n>` belongs to the current loop.

Notices come from the iteration's `ReconcileData`: a finalised attempt gives `<source>:<task> <stage> → <stage now>`, a newly retained one gives `retained <attempt>: <reason>`. `ReconciledAttempt` gains the stage label the task carried when the stage's tracker check passed, or `closed`. The stop notice is `loop stopped: <reason>`.

### D8 — Waiting for notices is a mode of the same script

`--notices <n>` reads `loop.notices` every 2 s. It prints the lines after the first `n` and `next: <m>`, and exits. It also checks the owner of `loop.lock`: when no loop is alive and nothing is left to print, it prints `loop stopped: not running` and exits with code 2. A loop killed without a stop notice is therefore still reported.

The command starts the loop and the wait one after the other, so the wait may run before the loop holds its lock. Two guards cover that: with no live loop, the wait gives one 10 s to start before it decides; and while a loop is alive, a notices file older than the lock's start time counts as empty, because it belongs to an earlier loop. The loop takes its lock first and empties the file second, so a refused second loop never empties the first loop's notices.

Alternative: stream the loop's output to the agent. Rejected: a stream wakes the agent on a timer to renew it, even when nothing happened.

### D9 — The command

`commands/loop.md` has two paths. Without `--apply` it runs the script in the foreground and relays the report, as `run.md` does. With `--apply` it starts the script in the background, then starts `--notices 0` in the background; when that command ends it shows the lines verbatim and starts `--notices <m>` again, until a stop line. The command text forbids reading the log and adding text.

### D10 — Arguments

`args.ts` gains `--loop` (switch), `--grills`, `--parallel`, `--interval` and `--notices` (integers). The combination rules go in the existing `COMBINATIONS` table. `--no-handoff` is not accepted with `--loop`: an iteration never carries a handoff.

### D11 — ADR

A new ADR records that the slot limits bind only the loop: a manual launch is never refused and still occupies its slot. It takes the next free number when the change is applied, because sibling branches also add ADRs.

## Risks / Trade-offs

- [An undecided task is judged again on every iteration until DOT-127 lands, up to `judgement.cap` tasks each time] → The proposal states it. Do DOT-127 before the loop is left on for long.
- [A manual run that finalises an attempt between two iterations produces no notice] → Accepted: the person who ran it saw the report.
- [A loop started from an agent session may end when that session ends] → The loop runs from a shell as well, and `--notices` reports a loop that is gone.
- [A configuration error repeats on every iteration] → It is in the log each time and stops nothing. Accepted by the user.
- [`fallow audit` limits cyclomatic complexity; `args.ts` and `run.ts` already hold many branches] → The loop lives in its own module, and new argument rules are table rows, not branches.
- [The stage order rule cannot be seen in real use while `grill-me` is the only supported stage] → Unit tests cover it with both stages supported.

## Migration Plan

No migration. An existing configuration file parses unchanged and takes the three defaults. `/autonomous:run` behaves as before except for the `capacity` step in its report and the stage order rule. Rollback is a revert of the change.

## Open Questions

- Whether a background task of an agent session outlives that session. If it does not, closing the session that ran `/autonomous:loop --apply` stops the loop with no notice, because no agent is left to receive one. Task 7.3 checks it. If the loop dies, the README says so and names the shell as the way to run a loop that must outlive the session; a detached launch from the command is then a follow-up, not part of this change.
