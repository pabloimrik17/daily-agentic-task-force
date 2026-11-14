# Proposal

## Why

`label-triage` keeps no memory between runs. A task whose scope or autonomy it cannot decide is judged again by the LLM on every run, for the same doubt, and the threshold of 0.95 makes doubts common. With the loop of `add-autonomous-loop-and-slot-limits` that cost repeats every interval, and the doubts are asked only when a person runs `/autonomous:run --apply` by hand. Linear DOT-127, a sub-issue of DOT-82, asks for a mark on those tasks so the loop never judges one twice and never blocks on one.

The decisions were settled with the user in the DOT-111 grill on 2026-11-13.

## What Changes

- **A new contract label, `triage-me`**: it marks a task whose scope or autonomy could not be decided without the human. One label serves both groups: the group in doubt is the one with no label on the task. Like `taken`, it belongs to no group, has no aliases and is created by `--bootstrap-labels`.
- **Any run with `--apply` marks its doubts**: when `label-triage` leaves a scope or autonomy group for the human as a question, it adds `triage-me` to the task. It does so in a manual run and in an iteration of the loop.
- **A marked task is not judged again**: `label-triage` requests no judgement for it and does not count it against the judgement cap. Rules and aliases still apply to it, because they cost nothing.
- **A marked task still has its question**: the question is composed from the task alone, without a judgement. A manual run hands it off like any other.
- **The mark comes off by itself**: a run with `--apply` that finds a marked task with no group missing removes `triage-me`. So does the answer that completes the task. The person can also add the missing label in the tracker; the next run removes the mark. This is the only label `label-triage` ever removes.
- **A marked task is never a candidate**, even when its labels are complete and the mark is only stale.
- **A read-only mode, `--triage-questions`**: it reads the trackers, runs no step and no LLM, lists the questions of every marked task and hands off the first four.
- **`/autonomous:loop --apply` empties the queue before it starts**: the command runs `--triage-questions` and asks every pending question, in rounds of four, applying the answers after each round. A round answered `Later` in full starts the loop at once. The loop itself asks nothing. A loop started from a shell asks nothing either.
- **One more notice for the agent that started the loop**: one line when an iteration marks new tasks.
- **Glossary**: the triage label, already written by the grill.

**Out of scope:**

- Sending an autonomy doubt to `grill-me`, a teammate that waits with the questions, and accepting the best guess below the threshold. The grill rejected the three.
- Marking a task at creation. The `labelling-new-tasks` skill keeps leaving groups to triage; the first run with `--apply` marks them.
- Marking a task whose present labels conflict, a task the LLM failed to judge, and a task beyond the judgement cap. None of them carries a doubt the human can settle with one answer, and the last two must be judged again.
- Remembering a judgement between runs. The mark is the only memory, and it lives in the tracker.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `label-contract`: the contract gains the `triage-me` label, with its colour, its meaning and its bootstrap.
- `label-triage`: the step marks the tasks it leaves for the human, skips the judgement of marked tasks, composes their questions, and removes the mark when the task is complete; the rule that triage never removes a label gains this one exception.
- `work-selection`: a task that carries `triage-me` is excluded.
- `autonomous-run`: a new mode, `--triage-questions`.
- `autonomous-loop`: the command asks the pending questions before it starts the loop; the notices gain the line for newly marked tasks.

## Impact

- **Code**, all under `plugins/autonomous/`: `src/label-contract/contract.ts` (the label), `src/label-contract/detect.ts` (whether a task is marked), `src/label-triage/` (decide, write, questions, answer, render, step), `src/select/candidates.ts` (the exclusion), `src/args.ts` and `src/run.ts` (the mode), the notices writer of the loop.
- **Commands**: `commands/loop.md` asks before it starts the loop; `commands/run.md` documents the mode.
- **Documentation**: `README.md`, `GLOSSARY.md`.
- **Trackers**: `triage-me` must exist on Linear and on each configured GitHub repository before it can be written. `--bootstrap-labels` creates it. Until then a run reports the mark as not written and judges the task again.
- **Dotfiles**: none. The label has no configuration.
- **Release**: a minor version of `autonomous`, by a `feat(autonomous)` commit.
- **Depends on**: `add-autonomous-loop-and-slot-limits` (DOT-111). This change modifies the `autonomous-loop` capability that change creates, so it is implemented and archived after it. The parts that touch only `/autonomous:run` do not depend on the loop.
- **Tracking**: Linear DOT-127.
