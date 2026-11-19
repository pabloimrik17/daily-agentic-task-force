# Proposal

## Why

`/autonomous:run` advances one task by one stage and stops. Nothing repeats it, and nothing limits how many managed sessions are open at once, so the usual way to use the plugin, a loop that keeps working alone, does not exist. Linear DOT-111, a sub-issue of DOT-82, asks for that loop with a configurable cadence and session limits.

The decisions were settled with the user in a grill on 2026-11-13. They replace part of the policy recorded in DOT-111 on 2026-09-30: the limit is no longer "two sessions, one of them for the human" but two independent limits, and the limits bind only the loop.

## What Changes

- **A second command, `/autonomous:loop`**: the continuous mode. It repeats iterations at a fixed interval until a person stops it. Each iteration brings the open attempts up to date and then launches at most one session. `/autonomous:run` keeps its behaviour: one task, supplied or selected, advances one stage.
- **Slots**: every open attempt occupies one slot, whichever command launched it, until it is finalised or discarded. A retained attempt keeps its slot. A session made by hand occupies none.
- **Two kinds of slot, each with its own limit**: a _grill slot_ for an attempt of the grill stage and a _work slot_ for an attempt of any other stage. Grills never compete with work for capacity, so tasks keep being defined while the work slots are full.
- **The limits bind only the loop**: an iteration launches only into a slot kind that is below its limit. `/autonomous:run`, with or without `--task`, is never refused for capacity; what it opens occupies a slot, and its report says when a kind is over its limit. The loop then waits until the kind is below its limit again.
- **A `capacity` step** after `reconcile`: it reports the open attempts per slot kind against the limits, and where each limit came from. In an iteration it is `wait` when no kind has a free slot, so a full loop calls no LLM.
- **Most advanced stage first**: whenever the runner selects, it compares only the candidates at the most advanced stage. The machine scope stays a preference of the comparison inside that group. The rule is code, not a hint to the LLM, and it applies to both commands.
- **Configuration**: a new optional block `runner` with `grills`, `parallel` and `intervalMinutes`. The shipped defaults are 1, 2 and 10. `/autonomous:loop` accepts `--grills`, `--parallel` and `--interval`, which override the file for that loop. Zero is a valid limit. Not breaking: an existing file still parses.
- **A dry iteration**: `/autonomous:loop` without `--apply` runs one iteration that writes nothing, reports what the loop would do, and ends. No `--once` and no `--dry-run` flag.
- **The loop keeps going**: an iteration that is `wait` or `not-evaluable` does not stop it. Only a runner error or a person does.
- **One loop at a time**: a second loop on the same state directory refuses to start. A manual run between two iterations is allowed; the run lock already keeps a run and an iteration from overlapping.
- **Iteration log**: each iteration appends its full report to a log in the state directory.
- **Short notices for the agent that started the loop**: one line when a task moves from one stage to another, when an attempt is retained, and when the loop stops. Nothing else reaches that agent's context. A session that waits for the person is not a notice: the person sees it in the session.
- **Glossary and ADR**: the glossary gains slot, grill slot, work slot, loop and iteration. A new ADR records why the limits bind only the loop.

**Out of scope:**

- The `triage-me` label for tasks the label triage cannot decide (DOT-127). Until it lands, the loop judges an undecided task again on every iteration, and its questions are asked only by a manual `/autonomous:run --apply`.
- A command that advances one task stage by stage (DOT-128).
- Machine scope as a hard rule before the most advanced stage (DOT-129).
- More than one launch per iteration, a session time limit, quiet hours, limits per scope or per source, and automatic retries of retained attempts.
- A dashboard, a notification system, and a command that stops the loop.
- A `--once` flag: an external scheduler that drives single iterations is not needed today.

## Capabilities

### New Capabilities

- `slot-limits`: slots and their two kinds, what occupies one, the limits and where they come from, the `capacity` step, and the rule that only the loop is bound.
- `autonomous-loop`: the `/autonomous:loop` command, iterations and the interval, the dry iteration, what stops the loop, the loop lock, the iteration log and the notices.

### Modified Capabilities

- `autonomous-run`: the plugin exposes two commands; the step order gains `capacity`; the run accepts the loop flags and rejects them outside a loop.
- `work-selection`: candidates are reduced to the most advanced stage before the choice; in an iteration a candidate without a free slot is excluded; the report shows both.
- `label-contract`: the user configuration file gains the optional `runner` block with shipped defaults.

## Impact

- **Code**, all under `plugins/autonomous/`: `src/config.ts` and `config.defaults.json` (the `runner` block), `src/args.ts` (loop flags), a new capacity step, `src/select/` (stage order, slot filter, report), `src/run.ts` (loop mode, loop lock, log), a new notices reader, `src/attempts/reconcile.ts` (the stage a finalised task now carries), `src/report.ts`.
- **Command**: a new `commands/loop.md`.
- **Documentation**: `README.md`, `GLOSSARY.md`, `config.example.json`, a new ADR.
- **Dotfiles**: none. The user adds a `runner` block only to differ from the defaults.
- **Release**: a minor version of `autonomous`, by a `feat(autonomous)` commit.
- **Sibling work**: the proposal stage (`feature/propose-stage`) adds `proposal` to the supported stages. The stage order used here is the order of the stage labels in the label contract, so that change needs no coordination beyond a rebase.
- **Tracking**: Linear DOT-111. Its description still carries the 2026-09-30 policy and needs an update.
