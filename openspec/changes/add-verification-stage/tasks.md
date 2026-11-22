# Tasks

## 1. Baseline

- [x] 1.1 Verify the starting point: `bun run test`, `bun run typecheck` and `bun run lint:fallow` pass before any code change, and the branch already holds the grill's glossary terms (the review stages, the adversarial review, finding triage, finding, reproduction, follow-up task, the `code-review` wording of Stage label and Transition) and ADR 0007. Verify by running the three commands and `bun run lint:markdownlint`.

## 2. The code-review label

- [x] 2.1 Add `code-review` to the contract's stage labels, colours (`#a3e635`) and meanings (design D1), and let triage decide the autonomy of a task in `code-review` between `AFK` and `HITL`. Update the README's label contract section. Verify with `contract.test.ts`, `detect.test.ts`, `bootstrap.test.ts` and `decide.test.ts`, one test per new scenario of the label-contract deltas "Three label groups", "Meaning of each label" and "One spelling and one colour per label" and of the label-triage delta, and `bun run lint:markdownlint`.

## 3. Shared stage pieces

- [x] 3.1 Move what the implementation and the verification say the same way out of `stages/implement/` into `stages/openspec-stage.ts` (design D2): the change check, the orchestration section, the commit rules parametrised by the unit committed, the `AFK` retry of a refused transition parametrised by the stages left and reached, and the deviation rule per autonomy, with no change to the implementation prompt's text. Verify that `implement.test.ts` passes unchanged and that `bun run lint:fallow` reports no new duplication.
- [x] 3.2 Add the verify workflow to `stages/openspec-workflows.ts` (`openspec-verify-change`, `/opsx:verify`; design D5). Verify with `openspec-workflows.test.ts`: the skill, the command, both (the skill wins), and neither, whose reason names both forms.

## 4. The adversarial review skill

- [x] 4.1 Write `plugins/autonomous/skills/adversarial-review/SKILL.md` (design D4): a description that claims only a request naming an adversarial review, and a body that takes every parameter from its caller and holds the phases, the independence of who judges, the finding triage and its four outcomes, the severity floor, the human's say on the triage, the refutation and the reproduction, the fix and its untouched test, the fix check and its bound of two rejections, the follow-ups and the record, with no fact about the verification. Verify with a test that reads the body and finds each of those rules, one per scenario of the adversarial-review spec that the text itself decides, and with `bun run lint:markdownlint`.
- [x] 4.2 Implement the loader that reads a skill of the autonomous plugin from the running module's directory and returns its body without frontmatter (design D3). Verify with a test that it reads `adversarial-review` from the source tree, that the body has no frontmatter, and that a missing file gives a reason naming its path, one per scenario of the verification-stage requirement "The adversarial review is the running plugin's".
- [x] 4.3 Add two eval cases under `plugins/autonomous/evals/`: a session asked for an adversarial review by name, where the skill fires, and one asked to review a pull request, where it does not. Document the adversarial review in the README, its own section linked from the glossary's term. Verify by running both cases with the local eval suite and `bun run lint:markdownlint`.

## 5. Transitions

- [x] 5.1 Add the `verify → code-review` row to the transition table, the approval question's text for a verification and the receipt's `verify` entry (design D7). Verify with `transition.test.ts`, one test per new scenario of the autonomous-run deltas "Transition mode", "Transition answers", "Approval question" and "The transition waits for the persistence receipt", and of the label-contract requirements "A transition replaces the stage" and "The autonomy decides whether leaving verify needs an answer", with every existing transition test unchanged.
- [x] 5.2 Run the guards of leaving `implement` for a task leaving `verify` too (design D6). Verify with `guards.test.ts`, one test per scenario of "Leaving verify needs the work finished", on fakes.
- [x] 5.3 Document the fourth transition, the approval question for a verification and its guards in the README's transition sections and in `commands/run.md`, and widen ADR 0004 to cover leaving the verification. Verify with `bun run lint:markdownlint`.

## 6. Persist mode for the stage

- [x] 6.1 Add the `verify` plan to persist mode (design D8). Verify with `persist.test.ts`: every existing test unchanged, plus one test per new scenario of the autonomous-run deltas "Persist mode" and "Persist preconditions" and of the verification-stage requirement "Verification stage summary comment".

## 7. Selection

- [x] 7.1 Support `verify` in `select/stage.ts` and add `verify` to `STAGE_IDS` (design D1). Update the README's select section. Verify with `stage.test.ts` and `candidates.test.ts`, one test per new scenario of the work-selection deltas, and `bun run lint:markdownlint`.

## 8. The verification stage

- [x] 8.1 Implement the prerequisites in `stages/verify/` (design D2, D3, D5): the shared checks with the verify and update workflows, the change check, and the adversarial review's body. Verify with `verify.test.ts`, one test per scenario of "Verification prerequisites" and "The OpenSpec workflows the verification needs", in temporary repositories.
- [x] 8.2 Implement the prompt, `agentArgs` (`--model opus --effort high`) and `completed`, and register the stage (design D2, D4, D9, D10, D11). Verify with `verify.test.ts`, one test per scenario of "The verification stage", "The verification prompt", "What the verification checks", "The verification corrects through one adversarial review", "The verification's boundary", "Which way a fix goes", "A proposal that contradicts the definition", "A new attempt resumes the verification", "Verification commits", "Follow-up tasks", "The verification prompt follows the autonomy", "The verification closing order", "The verification leaves the pull request a draft", "A blocked AFK verification ends without a transition", "Public repositories in the verification" and "Verification completion".
- [x] 8.3 Document the stage in the README: its prerequisites, what it checks and its boundary, the adversarial review's parameters, the direction of a fix, the follow-up tasks per autonomy, the commit rules, the closing order, the guards, a blocked `AFK` verification, a re-attempt, and the upgrade notes (`--bootstrap-labels` for `code-review`, stopping the loop before the upgrade, the rollback; design Migration Plan). Update the glossary's opening paragraph, which still says verification does not run as a stage, and replace the README's bare "triage" with "label triage" where it means the label triage. Verify with `bun run lint:markdownlint`.

## 9. The implementation prompt's boundary

- [x] 9.1 Add the boundary paragraph and the lighter `HITL` review to the implementation prompt (design D12). Verify with `implement.test.ts`: one test per scenario of the implementation-stage deltas "The implementation prompt follows the autonomy" and "The implementation leaves the review stages theirs", every other implementation test unchanged. Update the README's implementation section to match, and verify with `bun run lint:markdownlint`.

## 10. Integration checks

- [x] 10.1 Run the full toolchain and the strict validation: `bun run test`, `bun run typecheck`, `bun run lint:oxfmt`, `bun run lint:eslint`, `bun run lint:markdownlint`, `bun run lint:knip`, `bun run lint:fallow`, `bun run lint:marketplace` and `openspec validate add-verification-stage --strict`. Verify that every command passes and that `bun.lock` is not modified.

## 11. End-to-end verification

Results go to `openspec/changes/add-verification-stage/evidence/verification-verification.md`. Every tracker or repository write here needs the user's go-ahead first.

- [x] 11.1 With the loop stopped, bootstrap `code-review` on the trackers with the user's go-ahead, and record the bootstrap report.
- [ ] 11.2 Real task: run the stage on DOT-121 (`HITL`, pull request #90, in `verify`) by hand from this branch, through the report, the finding triage the human reviews, the refutation, the fixes and their checks, the review, the `Approve` answer, the logbook entry and the reconcile run that removes the session. Record the teammates' models and efforts as the session reports them, the record of findings, the commits, the stage summary comment, the labels and the pull request's draft state.
- [x] 11.3 Sandbox cases, each recorded with its tracker state and the reconcile result:
    1. an `AFK` task from launch to `code-review` with no question, and no follow-up task created;
    2. the guards refusing a transition out of `verify` with an uncommitted fix, then with an unpushed one;
    3. a dry run on a repository with neither the skill `openspec-verify-change` nor the command `/opsx:verify`, which waits with the reason naming both;
    4. a launch from this branch while the installed plugin has no adversarial review skill, whose prompt holds the branch's skill body.

    Clean up the sandbox tasks and pull requests afterwards.

## Workflow follow-up

- Commit as `feat(autonomous): …`, a minor with no `BREAKING CHANGE` footer, excluding `bun.lock`.
- Run the verify workflow on this change, then archive it by hand (who archives in the stages is DOT-147).
- Keep the loop stopped after 11.2 until the release with this change is installed: the installed version does not know `code-review`, sees DOT-121 as missing a stage, and its triage would derive `proposal` (design, rollback note). Restart it then.
