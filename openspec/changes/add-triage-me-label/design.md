# Design

## Context

See `proposal.md` for the motivation and the decisions taken with the user.

`label-triage` (`plugins/autonomous/src/label-triage/`) reads every open task, detects the groups missing per task (`label-contract/detect.ts`), derives labels by rule and then by an LLM judgement (`decide.ts`, `judgement.ts`), writes the eligible ones additively with a read-back (`write.ts`), and turns the groups it leaves for the human into questions (`questions.ts`). Answer mode routes an answer back to `answer.ts`, which reads the task again and writes. Nothing is remembered between runs.

Three facts shape the approach:

- The contract already has a label outside every group: `taken` (`TAKEN_LABEL` in `label-contract/contract.ts`), with its colour, its meaning, its bootstrap and its rejection of aliases. `triage-me` follows the same path.
- Every tracker can already remove one named label with a read-back (`trackers/tracker.ts`), used today for `taken` and by transitions.
- A question is composed from the task and the group's record. The judgement only adds a confidence and a prefix to one option, so a question can be composed without one.

The change adds no LLM call and removes many. Marking, skipping, unmarking and the new mode are tier `code`.

## Goals / Non-Goals

**Goals:**

- A doubt costs one judgement, once.
- The mark lives in the tracker, where the person can see it, set it and clear it.
- The loop never asks and never waits for an answer.

**Non-Goals:**

- A local record of judgements or of asked questions.
- A different threshold, or any change to what a judgement decides.
- Changing the handoff: four questions, one round per invocation.

## Decisions

### D1. The label joins the contract beside `taken`

`TRIAGE_LABEL = "triage-me"` in `contract.ts`, with colour `#f2c94c` and its meaning. The two labels outside the groups become one list, so the bootstrap, the alias check of the configuration and the detection treat both alike. `detect.ts` reports, per task, whether it is marked.

Alternative considered: two labels, one per group in doubt. Rejected in the grill: the missing group is already visible as the group with no label.

### D2. The step marks at the end of its writes

`applyDerivations` in `write.ts` gains a last phase per task: when the task is unmarked and at least one of its records has status `asked` for the scope or autonomy group, add `triage-me`. It reuses the label check (`labelCheckFor`), the additive write, the read-back and the per-source stop.

The mark is written in the step, before any question is asked, not after the round. A manual run whose person answers at once adds the label and removes it seconds later. That costs two writes and keeps one rule for every caller: a run that is interrupted, an iteration, and a person who closes the question all leave the task marked.

Alternative considered: mark only what the round left unanswered. Rejected: the step would depend on the command coming back with answers, and a run cut after the report would leave doubts unmarked.

### D3. A marked task skips only the judgement

`selectForJudgement` in `decide.ts` filters marked tasks out before it applies the cap. Rules and aliases still run. A missing scope or autonomy group that no rule decides becomes a record with status `asked`, tier `marked`, no confidence and a fixed reason. The rule "the stage follows the autonomy" therefore still completes a task whose autonomy the person added by hand.

### D4. Questions need no change beyond the tier

`questionsFor` already builds a question from an `asked` record. With tier `marked` there is no confidence, so no option gets the judgement prefix. Order, header, options and id are unchanged, and an answer to such a question is routed and validated as today.

### D5. The mark is removed when the task is complete

A pure function decides completeness from a label set: a scope label, and either an autonomy label with a stage label or the stage `grill-me`, with no group in conflict. Two callers use it:

- The step, after the additive writes of a marked task succeeded, on the task's labels plus the labels just written.
- `answer.ts`, after an answer was applied, on the labels the read-back returned.

Both remove `triage-me` through the tracker's removal. A failed removal is reported and stops nothing: the next run tries again.

### D6. Selection excludes a marked task

`selectCandidates` gains the exclusion `triage-me` after `taken`. `select` reads the tasks again, so a task unmarked by this run's `label-triage` is read without the label. A mark that is stale in a run without `--apply` keeps the task out, which is the conservative side.

### D7. `--triage-questions` is a mode, not a step

A new mode in `run.ts`, beside `--bootstrap-labels`: it loads the configuration, reads the sources with the readers of `label-triage`, keeps the marked tasks, runs detection and rules without writing, and passes the `asked` records to `questionsFor`. The report builder of the handoff is reused. It takes no lock, because it reads no attempt and writes nothing.

Alternative considered: have the loop command run `/autonomous:run --apply` once before the loop. Rejected: that run would also judge, write and launch a session.

### D8. The loop command asks once, then starts

`commands/loop.md` gains a first step for `--apply`: run `--triage-questions --json`; when there is a handoff, ask it with the question tool, apply the answers with `--apply --answer`, and go on. The `remaining` questions are not asked: the person drains them with `/autonomous:run --triage-questions` whenever they want, or answers them in a manual run.

### D9. One notice per iteration that marks

The loop's notice writer reads the list of newly marked tasks from the data of `label-triage` and appends one line: the count and at most five task ids.

## Risks / Trade-offs

- **The first run with `--apply` after this lands marks up to the cap of judged tasks.** → Expected and visible: the report lists every mark, and the loop tells it in one line.
- **A marked task is stuck until a person acts.** → Intended. The count of marked tasks is in every report, and the loop command asks when it starts.
- **`triage-me` is missing on a tracker.** → The mark is not written and the task is judged again, as today. The report names `--bootstrap-labels`.
- **A person removes `triage-me` without adding the missing label.** → The task is judged again on the next run and marked again if the doubt stands.
- **A doubt that would resolve itself after the task's description changes stays marked.** → The person removes the label to ask for a new judgement. No automatic re-judgement.
- **Add then remove in a manual run** (D2). → Two extra writes per answered question.
- **The fallow complexity budget** on `write.ts` and `decide.ts`. → The new phases are separate functions.

## Migration Plan

1. Land after `add-autonomous-loop-and-slot-limits`.
2. Run `/autonomous:run --bootstrap-labels` once, with the user's go-ahead, to create `triage-me` on Linear and on the configured GitHub repositories.
3. No data migration: tasks get marked as runs find their doubts.

Rollback: revert the release. Tasks keep a `triage-me` label that nothing reads; the user may delete the label in the trackers.

## Open Questions

None.
