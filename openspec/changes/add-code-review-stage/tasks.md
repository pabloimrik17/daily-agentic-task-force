# Tasks

## 1. Baseline

- [x] 1.1 Verify the starting point: `bun run test`, `bun run typecheck` and `bun run lint:fallow` pass before any code change, and the branch already holds the grill's glossary terms (Reviewer, Review round, Human round, Round, Orchestrator). Verify by running the three commands and `bun run lint:markdownlint`.

## 2. The external-review label

- [x] 2.1 Add `external-review` to the contract's stage labels, colours (`#8b5e3c`) and meanings (design D1), and let triage decide the autonomy of a task in `external-review` between `AFK` and `HITL`. Update the README's label contract section. Verify with `contract.test.ts`, `detect.test.ts`, `bootstrap.test.ts` and the triage decision tests, one test per new scenario of the label-contract deltas "Three label groups", "Meaning of each label" and "One spelling and one colour per label" and of the label-triage delta, and `bun run lint:markdownlint`.

## 3. The adversarial review skill

- [x] 3.1 Add the two optional caller parameters to `skills/adversarial-review/SKILL.md` (design D5): human rounds, each running the phases once on the human's comments, and reporters whose findings the refutation only advises on, with a fix of a finding that has no reproduction checked against its statement. Verify with `adversarial-review.test.ts`, one test per new scenario of the adversarial-review delta, every existing test unchanged, and update the README's adversarial review section; verify with `bun run lint:markdownlint`.

## 4. Shared stage pieces

- [x] 4.1 Let `loadPluginSkill` replace `${CLAUDE_PLUGIN_ROOT}` in a body with the plugin's own directory (design D3), and export a constant for the review team skill. Verify with `plugin-skill.test.ts`: the review team body read from the source tree holds no `${CLAUDE_PLUGIN_ROOT}` and names the plugin directory in its commands, and a missing file gives a reason naming its path.
- [x] 4.2 Move into `stages/openspec-stage.ts` whatever the code review prompt shares with `stages/verify/prompt.ts` and still lives there (design D2), with no change to the verification prompt's text. Verify that `verify.test.ts` passes unchanged and that `bun run lint:fallow` reports no new duplication.

## 5. GitHub review threads

- [x] 5.1 Add the review-thread operations to the pull-request port and its GitHub adapter through `gh api graphql` (design D8): read the threads with their comments, post a review of new threads with the event `COMMENT` (line and file-level anchors), reply, resolve and unresolve. Verify with `github.test.ts` on a fake `Exec`: the queries and variables of each operation, the parsing of a thread listing with markers, and a failed call reported with its label.

## 6. Publish mode

- [x] 6.1 Implement the record `findings.json` (`autonomous.findings.v1`) and its validator (design D7). Verify with `record.test.ts`, one test per scenario of the finding-threads requirements "The record of the findings" and "An invalid record publishes nothing", including a location outside the repository.
- [x] 6.2 Implement what is published and in which state, the comment format, the markers and the anchoring (design D9, D10, D12). Verify with unit tests, one per scenario of "Only surviving findings are published", "A thread's state follows the finding's outcome", "A finding passed on is addressed to its stage", "The comment format", "Hidden markers" and "Where a comment is anchored".
- [x] 6.3 Implement the publishing run: one review per round that opens threads, replies and resolutions of linked threads, idempotency within an attempt, the exact-match backstop, the stage's own threads only, the read-back and `published.json` with the record's digest (design D10, D11, D13). Verify with `publish.test.ts` on fakes, one test per scenario of "One review per round that opens threads", "Existing threads are answered, never duplicated", "Publishing is idempotent within an attempt", "An exact match continues an existing thread", "Only the stage's own threads are touched", "The publish receipt", "Comments are posted with the user's account" and "Publishing leaves the pull request a draft", plus a pending review of the same account refused before any post.
- [x] 6.4 Add `--publish <attempt-id>` to `args.ts` and `run.ts`, its preconditions and its report `autonomous.publish.v1` (design D6). Verify with `args.test.ts`, `run.test.ts` and `publish.test.ts`, one test per scenario of the autonomous-run requirements "Publish mode", "Publish preconditions" and "Publish report". Document publish mode, the finding threads and their format in the README and `commands/run.md`, and verify with `bun run lint:markdownlint`.

## 7. The walkthrough

- [x] 7.1 Implement the walkthrough's update in publish mode (design D14): the trailing "Code review fixes" section, a note per published finding inside one hunk and the overview line otherwise, validation with `review-team/guide.ts` against the final patch, the Plannotator save only when the digest changed, the rendering `walkthrough.md`, and no walkthrough, with its reason, on any failure. Verify with `walkthrough.test.ts` on fakes, one test per scenario of the walkthrough spec. Document it in the README's publish mode section and verify with `bun run lint:markdownlint`.

## 8. Transitions

- [x] 8.1 Add the `code-review → external-review` row, the approval question's text for a code review and the receipt's `code-review` entry (design D17). Verify with `transition.test.ts`, one test per new scenario of the autonomous-run deltas "Transition mode", "Transition answers", "Approval question" and "The transition waits for the persistence receipt", and of the label-contract requirements "A transition replaces the stage" and "The autonomy decides whether leaving code-review needs an answer", every existing transition test unchanged.
- [x] 8.2 Run verification's guards for a task leaving `code-review`, and refuse an open attempt whose `published.json` is missing or names another digest than its `findings.json` (design D13). Verify with `guards.test.ts` and `transition.test.ts`, one test per scenario of "Leaving code-review needs the work finished" and "The transition waits for the publish receipt", on fakes.
- [x] 8.3 Document the fifth transition, the approval question for a code review, its guards and the publish receipt in the README's transition sections and `commands/run.md`; widen ADR 0004 to leaving the code review, and make ADR 0007's consequence name `external-review`. Verify with `bun run lint:markdownlint`.

## 9. Persist mode and selection

- [x] 9.1 Add the `code-review` plan to persist mode (design D18). Verify with `persist.test.ts`: every existing test unchanged, plus one test per new scenario of the autonomous-run deltas "Persist mode" and "Persist preconditions" and of the code-review-stage requirement "Code review stage summary".
- [x] 9.2 Support `code-review` in `select/stage.ts` and add it to `STAGE_IDS` (design D1). Update the README's select section. Verify with `stage.test.ts` and `candidates.test.ts`, one test per new scenario of the work-selection deltas, and `bun run lint:markdownlint`.

## 10. The code review stage

- [x] 10.1 Implement the prerequisites in `stages/code-review/` (design D2, D3): the shared checks with no workflow, the change check, the two skill bodies with the plugin root resolved, and the finding threads read at launch. Verify with `code-review.test.ts`, one test per scenario of "Code review prerequisites", "The review skills are the running plugin's", "Optional tools are never prerequisites" and "Finding threads read at launch", in temporary repositories with a fake pull-request port.
- [x] 10.2 Implement the prompt, `agentArgs` (`--model opus --effort high`) and `completed`, and register the stage (design D2, D4, D15, D16). Verify with `code-review.test.ts`, one test per scenario of every other requirement of the code-review-stage spec.
- [x] 10.3 Document the stage in the README: its prerequisites, the adversarial review's parameters, the input from verification, the boundaries, doubts, the human round, the walkthrough for `HITL`, commits, follow-up tasks, the closing order, the logbook section, a blocked `AFK` code review, a re-attempt and the upgrade notes (design Migration Plan). Update the glossary's current-state wording: the opening paragraph, Code review (it now runs), Stage label (with `external-review` and the fifth transition) and Transition (the `AFK` exceptions). Verify with `bun run lint:markdownlint`.

## 11. Integration checks

- [x] 11.1 Run the full toolchain and the strict validation: `bun run test`, `bun run typecheck`, `bun run lint:oxfmt`, `bun run lint:eslint`, `bun run lint:markdownlint`, `bun run lint:knip`, `bun run lint:fallow`, `bun run lint:marketplace` and `openspec validate add-code-review-stage --strict`. Verify that every command passes and that `bun.lock` is not modified.

## 12. End-to-end verification

Results go to `openspec/changes/add-code-review-stage/evidence/code-review-verification.md`. Every tracker or repository write here needs the user's go-ahead first.

- [ ] 12.1 With the loop stopped, bootstrap `external-review` on the trackers with the user's go-ahead, and record the bootstrap report.
- [ ] 12.2 Real task: run the stage on DOT-121 (`HITL`, pull request #90, in `code-review`) by hand from this branch, through the review team's report, the finding triage the human reviews, the refutation, the fixes and their checks, publish mode, the walkthrough in the Inbox, at least one human round, the `Approve` answer, the logbook entry and the reconcile run that removes the session. Record the review team's tier and skipped reviewers, the record of findings, the threads and their states, the walkthrough, the commits, the stage summary comment, the labels and the pull request's draft state.
- [ ] 12.3 Sandbox cases, each recorded with its tracker and pull request state:
    1. an `AFK` task from launch to `external-review` with no question, its doubts published as open `question (blocking)` threads and no follow-up task created;
    2. publish mode run twice in one attempt, and a second attempt that finds a finding already published, with no duplicate thread;
    3. the transition refused while `published.json` is missing, then while it names an older digest;
    4. a launch with `plannotator` off the `PATH`, which runs with no walkthrough and says why.

    Clean up the sandbox tasks and pull requests afterwards.

## Workflow follow-up

- Commit as `feat(autonomous): …`, a minor with no `BREAKING CHANGE` footer, excluding `bun.lock`.
- Run the verify workflow on this change, then archive it by hand.
- Keep the loop stopped after 12.2 until the release with this change is installed: the installed version does not know `external-review`, sees DOT-121 as missing a stage, and its triage would derive `proposal` (design, rollback note). Restart it then.
