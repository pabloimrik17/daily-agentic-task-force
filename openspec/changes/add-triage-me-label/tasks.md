# Tasks

Implement after `add-autonomous-loop-and-slot-limits`. Groups 1 to 5 touch only `/autonomous:run` and can start before the loop exists; group 6 needs it.

## 1. The label in the contract

- [x] 1.1 Add `triage-me` to `label-contract/contract.ts` with colour `#f2c94c` and its meaning, in one list with `taken` of the labels outside every group (design D1). Verify with `contract.test.ts`: the label is in the vocabulary, belongs to no group and has the colour.
- [x] 1.2 Reject aliases for `triage-me` in the configuration, and create it in the bootstrap. Verify with `config.test.ts` (alias rejected with its path) and `bootstrap.test.ts` (created on Linear and GitHub, nothing on Beads).
- [x] 1.3 Report in `label-contract/detect.ts` whether a task is marked, without making the label missing or in conflict. Verify with `detect.test.ts`: the scenarios of "The triage label" and "Who sets the triage label".

## 2. Skip the judgement of marked tasks

- [x] 2.1 Filter marked tasks out of `selectForJudgement` before the cap, and give their undecided scope or autonomy group a record with status `asked`, tier `marked` and no confidence (design D3). Verify with `decide.test.ts`: the scenarios of "A marked task is not judged" and "Listed without a judgement".
- [x] 2.2 Check that `questionsFor` composes the question of a `marked` record with no confidence and no judgement prefix, and fix it where it assumes a judgement (design D4). Verify with `questions.test.ts`: the other two scenarios of "Questions of marked tasks".

## 3. Mark and unmark

- [x] 3.1 Add the pure function that tells whether a label set is complete (design D5). Verify with a unit test: scope plus autonomy plus stage, scope plus `grill-me`, a missing group, a group in conflict.
- [x] 3.2 Add the marking phase to `write.ts`, after a task's additive writes (design D2). Verify with `write.test.ts`: every scenario of "Mark the tasks left for the human" and of "Doubts that are not marked".
- [x] 3.3 Add the removal phase to `write.ts` for a marked task that is complete (design D5). Verify with `write.test.ts`: every scenario of "Remove the mark from a complete task" and of "A failed removal of the mark".
- [x] 3.4 Remove the mark in `answer.ts` after an applied answer that completes the task. Verify with `answer.test.ts`: the three scenarios of "An answer removes the mark", plus a failed removal named in the detail of an `applied` answer.
- [x] 3.5 Render the marks in text and JSON, with the count of marked tasks read. Verify with `render.test.ts` and `step.test.ts`: the scenarios of "Marks in the triage report".

## 4. Selection

- [x] 4.1 Add the `triage-me` exclusion to `selectCandidates` after `taken`, and show it in the selection report. Verify with `candidates.test.ts`: the three scenarios of "A marked task is excluded".

## 5. The triage questions mode

- [x] 5.1 Add `--triage-questions` to `args.ts`, combinable with `--json` only, and to the usage text. Verify with `args.test.ts`: alone, with `--json`, and rejected with `--apply` and with `--task`.
- [x] 5.2 Add the mode to `run.ts`: read the sources, keep the marked tasks, compose their questions and the handoff, write nothing and take no lock (design D7). Verify with `run.test.ts`: every scenario of "Triage questions mode", "Triage questions report" and "Triage questions flags and exit code", and that no tracker write and no LLM call is issued.
- [x] 5.3 Document the label, the mark's life and the mode in `README.md` and in `commands/run.md`. Verify with `bun run lint:markdown`.

## 6. The loop

- [x] 6.1 Record the notice for newly marked tasks from the data of `label-triage` (design D9). Verify with the notices test: the scenarios "Tasks newly marked", "Many tasks newly marked" and "Marked in an earlier iteration".
- [x] 6.2 Add the rounds of questions to `commands/loop.md` before the loop starts, for `--apply` only: every listed question, four per round, stopping at a round answered `Later` in full (design D8). Verify by reading the command against every scenario of "Questions before the loop starts" and of "The loop's process never asks".
- [x] 6.3 Remove from `README.md` the sentence, written by the loop change, that says the loop judges an undecided task again on every iteration. Verify with `bun run lint:markdown`.

## 7. Glossary

- [x] 7.1 Check that `GLOSSARY.md` carries the triage label as the grill wrote it; it is already committed on this branch. Add "Marked task" only if the code needs the term. Verify with `bun run lint:markdown`.

## 8. Integration

- [x] 8.1 Run `bun run lint:oxfmt`, `bun run lint:eslint`, `bun run lint:knip`, `bun run lint:fallow`, `bun run lint:marketplace`, `bun run typecheck` and `bun run test`. Verify that all pass.
- [ ] 8.2 On the real trackers, with the user's go-ahead, run `/autonomous:run --bootstrap-labels` and check that `triage-me` exists on Linear and on each configured GitHub repository. Keep the report as evidence in the change folder.
- [ ] 8.3 On the real trackers, run `/autonomous:run` without `--apply` and check the marks it proposes against the tasks it leaves for the human. Keep the report as evidence.
- [ ] 8.4 On the real trackers, with the user's go-ahead, run `/autonomous:run --apply` once, then `--triage-questions`, answer one question and check that its task loses `triage-me`. Run again and check that no marked task is judged. Keep the evidence in the change folder.

## Workflow follow-up

- [ ] Update Linear DOT-127 when the change is implemented, with the user's go-ahead.
- [ ] Archive the change after `add-autonomous-loop-and-slot-limits` is archived.
