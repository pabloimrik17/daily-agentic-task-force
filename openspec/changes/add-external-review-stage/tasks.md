# Tasks

## 1. Baseline

- [x] 1.1 Verify the starting point: `bun run test`, `bun run typecheck` and `bun run lint:fallow` pass before any code change, and the branch already holds the grill's documents (glossary terms External review, Review bot, Quiet round, Review round, Stage label; ADR 0009; the amended consequence of ADR 0007). Verify by running the three commands and `bun run lint:markdownlint`.

## 2. Configuration

- [x] 2.1 Add the optional `review.external` block to `config.ts`, `config.defaults.json` and `config.example.json` (design D3): `waitMinutes`, `answerWaitMinutes`, `rounds`, `bots` with `id`, `login`, `check`, `mention`; a user's `bots` replaces the list whole. Verify with `config.test.ts`, one test per scenario of the review-bots requirement "Review bot settings", every existing test unchanged.

## 3. The pull-request port

- [ ] 3.1 Add `state`, `ready`, `checkRuns`, `reviews` and `dismiss` to the pull-request port and its GitHub adapter (design D2). Verify with `github.test.ts` on a fake `Exec`: the command or query of each operation, the parsing of a draft and a ready pull request with its last ready time, a paginated check-run listing, a review listing with states, and a failed call reported with its label. Fixtures come from real responses with every machine and account detail removed.

## 4. Review bots

- [x] 4.1 Implement the classification in `review-bots/` (design D4): a bot's state for a head commit, the wait of a bot with no check run, and the checks of a pull request. Pure functions over check runs and a clock. Verify with unit tests, one per scenario of "A review bot's state for a head commit", "A review bot with no check run waits, then is not reviewing" and "The checks of a pull request".
- [x] 4.2 Implement settled (design D6), including the answer wait read from external review replies newer than the head commit. Verify with one test per scenario of "A settled pull request".
- [x] 4.3 Implement the report (design D7, D8, D9): findings from review bot threads with the login compared without its `[bot]` suffix, contested answers, review bodies as material, failed checks, human reviewers' threads, passed-on threads, the accounted threads, severity from each reporter's mark, the rounds that pushed fixes and the quiet report. Verify with unit tests on thread fixtures, one per scenario of "The reported findings of a round", "A contested answer is reported as such", "Review bodies are material", "Failed checks, human reviewers and passed-on threads are reported", "Severity comes from the reporter's own mark", "Rounds are counted from the pull request" and "A quiet report". The severity fixtures are the real first lines of a CodeRabbit `Major` and `Minor` comment and a Greptile `P1` and `P2` comment.

## 5. Selection and the wait

- [x] 5.1 Support `external-review` in `select/stage.ts` and put it last in the stage order. Verify with `stage.test.ts`, `step-stage.test.ts` and `candidates.test.ts`, one test per changed or new scenario of the work-selection deltas "Next stage of a task" and "Most advanced stage first".
- [ ] 5.2 Add the exclusion `waiting-for-review-bots` after split (design D5): find the pull request from the task's latest attempt record, classify, and with `--apply` mark a draft ready. Never applied to a supplied task. Verify with `candidates.test.ts` and `step.test.ts` on fakes, one test per scenario of the work-selection delta "Candidates and exclusions" and of the review-bots requirements "The pull request of a task in external-review" and "A draft pull request in external-review is marked ready".
- [ ] 5.3 Report the wait in the text and JSON reports (`select/render.ts`). Verify with `render.test.ts`, one test per scenario of "The wait is reported".

## 6. Transitions

- [ ] 6.1 Add the row `external-review → wrap-up` to the transition table, the approval question's text for an external review, and `--from external-review`. Verify with `transition.test.ts`, one test per new scenario of the autonomous-run deltas "Transition mode", "Transition answers", "Approval question" and "The transition waits for the persistence receipt", and of the label-contract delta "A transition replaces the stage" and the added "The autonomy decides whether leaving external-review needs an answer", every existing transition test unchanged.
- [ ] 6.2 In a transition whose target is `external-review`, run the check guard and mark the pull request ready before any label write (design D13). Verify with `transition.test.ts` and `guards.test.ts` on fakes, one test per scenario of "The transition into external-review marks the pull request ready" and "Entering external-review needs no failed check", and of the code-review-stage delta.
- [ ] 6.3 Guard leaving `external-review` (design D14): verification's guards, a current and quiet publish receipt, and no failed or running check. Verify with `guards.test.ts`, one test per scenario of "Leaving external-review needs a quiet round".

## 7. Completion of a round

- [x] 7.1 Accept the outcome `round-ended` in `attempts/result.ts`, add the optional check of an ended round to the stage contract, and complete such an attempt in reconcile only with both receipts, the publish receipt current (design D11). Verify with `result.test.ts` and `reconcile.test.ts`, one test per new scenario of the stage-sessions deltas "Completion needs two proofs" and "Stage contract", every existing reconcile test unchanged.

## 8. Publish mode

- [x] 8.1 Accept `external-review` attempts in publish mode and hold the threads they answer (design D12): reply under a resolution marker, no resolve or unresolve except for a finding thread of the runner, the status line of each outcome, and the reply's mention. Verify with `publish.test.ts`, `format.test.ts` and `run.test.ts`, one test per scenario of the finding-threads requirements "An external review holds the threads it answers open" and "A reply may mention its review bot", of the two modified requirements, and of the autonomous-run deltas "Publish mode" and "Publish preconditions".
- [x] 8.2 Implement the quiet round in publish mode (design D12): the record's `quiet` field and its validation, the resolution of the answered threads, the dismissal of a review bot's request for changes, the read-back and the receipt's quiet mark. Verify with `record.test.ts`, `publish.test.ts` and `receipt.test.ts`, one test per scenario of "The record may mark a quiet round", "The quiet round resolves the answered threads", "The quiet round dismisses a review bot's request for changes" and "The receipt records a quiet round".

## 9. Persist mode

- [x] 9.1 Add the `external-review` plan to persist mode. Verify with `persist.test.ts`: every existing test unchanged, plus one test per new scenario of the autonomous-run deltas "Persist mode" and "Persist preconditions" and of the external-review-stage scenario "Comment header".

## 10. The external review stage

- [ ] 10.1 Implement the prerequisites in `stages/external-review/` (design D1, D5): the shared checks, the change check, the adversarial review body, not a draft, settled, and the report with the code review's finding threads. Verify with `external-review.test.ts` in temporary repositories with a fake pull-request port, one test per scenario of "External review prerequisites" and "What the prerequisites read reaches the prompt".
- [ ] 10.2 Implement the prompt in its three shapes (a round, a quiet round, past the limit), `agentArgs`, the two completion checks, and register the stage (design D10, D15, D16, D17). Before writing the prompt's text, read the `autofix`, `greploop` and `check-pr` skills for wording about each bot's comment format worth adapting, and adopt none of their loops, pushes or resolutions. Verify with `external-review.test.ts`, one test per scenario of every other requirement of the external-review-stage spec, and that `bun run lint:fallow` reports no new duplication against `stages/code-review/prompt.ts`.

## 11. Documentation

- [ ] 11.1 Document in the README and `commands/run.md`: the external review stage (prerequisites, the round, the three ways it ends, the round limit, the blocked attempt, `HITL`), the review bots and `review.external`, the wait in the run's report, the sixth transition with its marking and guards, publish mode for external review, the result marker's second outcome, and the upgrade notes (design Migration Plan). Update the glossary's current-state wording that the grill did not touch: the opening paragraph, Result marker (the outcome `round-ended`), Stage contract, Transition (the `AFK` exceptions) and the transitions listed under Stage label. Widen ADR 0004 to leaving the external review. Verify with `bun run lint:markdownlint`.

## 12. Integration checks

- [ ] 12.1 Run the full toolchain and the strict validation: `bun run test`, `bun run typecheck`, `bun run lint:oxfmt`, `bun run lint:eslint`, `bun run lint:markdownlint`, `bun run lint:knip`, `bun run lint:fallow`, `bun run lint:marketplace` `openspec validate add-external-review-stage` and the same with `--strict`. Verify that every command passes, except that `--strict` may report only the length warning of the six MODIFIED requirements whose text was already over 500 characters in the main specs (Transition mode, Transition answers, Approval question, A transition replaces the stage, Stage contract, Candidates and exclusions), and that `bun.lock` is not modified by this change.

## 13. End-to-end verification

Results go to `openspec/changes/add-external-review-stage/evidence/external-review-verification.md`. Every tracker, pull request or repository write here needs the user's go-ahead first.

- [ ] 13.1 With the loop stopped, check that `wrap-up` exists on the trackers and bootstrap it with the user's go-ahead where it does not. Record the report.
- [ ] 13.2 Real task: take a task from `code-review` to `wrap-up` from this branch. Record the pull request marked ready by the transition, the wait as each run reports it, the check runs observed while a bot reviews (the state "reviewing" was only inferred in the design), each round's report, record, replies, push and logbook entry, the quiet round's resolutions and dismissal, the labels, and that no session was open during any wait.
- [ ] 13.3 Measure on that pull request, and record: whether Greptile and Pullfrog answer a reply without a mention, and whether a reply that mentions Greptile starts a full review. Propose the defaults of `mention` and `answerWaitMinutes` from it; change no default without the user's decision.
- [ ] 13.4 Sandbox cases, each recorded with its tracker and pull request state:
    1. a task already in `external-review` with a draft pull request, marked ready by a run with `--apply` and only reported without it;
    2. a transition from `code-review` refused for a failed check, then applied with a check still running;
    3. a bot that leaves no check run, classified as not reviewing when its wait runs out;
    4. a contested answer refuted twice in an `AFK` task, whose thread stays open through the quiet round;
    5. a round past the limit with a surviving finding, retained and listed by the next run;
    6. publish mode run twice in a quiet round, with no second reply, resolution or dismissal;
    7. a human reviewer's thread refuted in an `AFK` task, answered and left open.
