# Tasks

## 1. Baseline

- [ ] 1.1 Check the starting point.
    - DOT-163 (`add-review-team-skill`, the layer below this one in the stack) is merged, or this branch is rebased on it.
    - `report.json` and the review team's directory parameter match what this change uses (design D1, D6). If they differ, reconcile this change with `openspec-update-change` first.
    - `bun run test`, `bun run typecheck` and `bun run lint:fallow` pass.

    Verify by running the three commands and `openspec validate add-code-review-stage --strict`.

## 2. The external-review label

- [ ] 2.1 Add `external-review` to the contract's stage labels, colours (`#a16207`) and meanings (design D8), and let triage decide a task in `external-review` between `AFK` and `HITL`. Update the README's label contract section. Verify with `contract.test.ts`, `detect.test.ts`, `bootstrap.test.ts` and `decide.test.ts`, one test per new scenario of the label-contract deltas "Three label groups", "Meaning of each label" and "One spelling and one colour per label" and of the label-triage delta, and with `bun run lint:markdownlint`.

## 3. Transitions, persist and selection

- [ ] 3.1 Add the `code-review → external-review` row, its approval text, its receipt entry and its persist plan (design D7). Verify with `transition.test.ts` and `persist.test.ts`, one test per new scenario of the autonomous-run deltas "Transition mode", "Transition answers", "Approval question", "Persist mode", "Persist preconditions" and "The transition waits for the persistence receipt", and of the label-contract requirements "A transition replaces the stage" and "The autonomy decides whether leaving code-review needs an answer". Every existing test stays unchanged.
- [ ] 3.2 Guard leaving `code-review` like leaving `verify` (design D7). Verify with `guards.test.ts`, one test per scenario of "Leaving code-review needs the work finished", on fakes.
- [ ] 3.3 Support `code-review` in selection, after `verify` in the order of advancement. Verify with the `select` tests, one per new scenario of the work-selection deltas.

## 4. The adversarial review's human round

- [ ] 4.1 Add the human's round to `skills/adversarial-review/SKILL.md` (design D5), with no fact about any stage. Verify with `adversarial-review.test.ts` finding each rule of the modified "The phases" and the added "The human's findings", the existing eval cases passing, and `bun run lint:markdownlint`.

## 5. Publish mode

- [ ] 5.1 Define `autonomous.threads.v1` and its validator, and render each kind of thread and the review's index from fixed templates (design D2, D3). Verify with snapshot tests of every kind (fixed, deferred created, deferred proposed, passed on, blocked, open doubt, resolution, review index) against the format the spec "The finding thread's format" requires, and a test that rejects content naming the home directory or an absolute path.
- [ ] 5.2 Anchor each thread to the pull request's diff: a line comment, a file comment (`subject_type: "file"`) or an entry in the review's body. Verify with tests on a recorded pull-request file list, for "Finding on an unchanged line" and a finding on a file outside the diff.
- [ ] 5.3 Read every page of the pull request's review threads and issue comments for markers. Then post one review, resolve the threads that need it, and reply to and resolve the earlier threads named. Read it all back. Verify with tests on a fake `gh` for "Threads published", "Published twice", "Missing threads file" and "Publish without apply", including more than 30 existing threads.
- [ ] 5.4 Import the walkthrough guide for the pull request when the attempt's directory holds it, and report a missing or failing Plannotator without failing (design D6). Also produce the guide's markdown rendering for the logbook entry. Verify with tests on a fake `plannotator` for "Plannotator not installed", and a rendering test.
- [ ] 5.5 Wire `--publish` into `args.ts` and `run.ts`, with its usage rules. Verify with `args.test.ts` and `run.test.ts`, and document publish mode in the README with `bun run lint:markdownlint`.

## 6. The stage

- [ ] 6.1 Register the stage: `code-review` in `STAGE_IDS` and the registry, with `src/stages/code-review/stage.ts` holding its prerequisites, agent arguments and completion check (design D1). Verify with `code-review.test.ts`, one test per scenario of "The code review stage", "Code review prerequisites", "The skills are the running plugin's" and "Code review completion".
- [ ] 6.2 Write `src/stages/code-review/prompt.ts` on the shared helpers, with AFK and HITL variants. It carries:
    - the adversarial review's parameters;
    - verification's inputs;
    - the rule against changing the proposal;
    - doubts;
    - publishing through `threads.json`;
    - the walkthrough at the close;
    - the human round (`HITL`);
    - commits, the re-attempt, follow-ups, the closing order, the blocked path, the stage summary and the public-content rule.

    Verify with tests that find each rule, one per remaining scenario of the code-review-stage spec, and that the `AFK` prompt has no human round and no question.

## 7. Documentation

- [ ] 7.1 Document the stage in the README: what it does, its prerequisites, the adversarial review as it runs it, the inputs from verification, publishing, the walkthrough, the human round, commits, closing, blocked path, completion and upgrading. Update the glossary (**Code review**, **Stage label**, **Transition**) and ADR 0007's consequence (design D9). Verify with `bun run lint:markdownlint`.

## 8. Integration

- [ ] 8.1 Run every gate: `bun run test`, `bun run typecheck`, `bun run lint:eslint`, `bun run lint:fallow`, `bun run lint:knip`, `bun run lint:oxfmt`, `bun run lint:markdownlint` and `openspec validate add-code-review-stage --strict`. Verify that each one passes.
- [ ] 8.2 With the user's go-ahead only, run one real `HITL` code review on a task of this repository whose pull request is a draft, after `--bootstrap-labels`. It should end with:
    - the threads published, and found idempotent when published again;
    - the walkthrough imported;
    - one human round;
    - the task in `external-review` with its pull request still a draft.

    Verify with the pull request's threads and the task's labels and comments, recorded in the change's `evidence/`.

## Workflow follow-up

- Sync the specs and archive the change after the merge.
- The external review stage (DOT-157) takes the task from `external-review`.
