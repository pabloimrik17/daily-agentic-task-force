# Tasks

## 1. Baseline

- [x] 1.1 Verify the starting point: the OpenSpec workflow check of `stages/openspec-workflows.ts` (#99) maps `apply` and `update`, and `bun run test`, `bun run typecheck` and `bun run lint:fallow` pass before any code change, and the glossary already holds Implementation, Verification, Orchestrator and Teammate and the `verify` wording of Stage label and Transition, written in the grill. Verify by running the three commands and `bun run lint:markdownlint`.

## 2. The verify label

- [x] 2.1 Add `verify` to the contract's stage labels, colours (`#d6409f`) and meanings (design D1), and let triage decide the autonomy of a task in `verify` between `AFK` and `HITL`. Update the README's label contract section. Verify with `contract.test.ts`, `detect.test.ts`, `bootstrap.test.ts` and `decide.test.ts`, one test per new scenario of the label-contract deltas "Three label groups", "Meaning of each label" and "One spelling and one colour per label" and of the label-triage delta, and `bun run lint:markdownlint`.

## 3. Shared stage pieces

- [x] 3.1 Move the prompt pieces and prerequisite checks that proposal preparation and the implementation stage share out of `stages/proposal/` into one shared module under `stages/` (design D2), with no change to proposal preparation's behaviour or prompt text. Verify that `proposal.test.ts` passes unchanged and that `bun run lint:fallow` reports no new duplication.
- [x] 3.2 Implement the function that finds the change a branch adds, with git against the merge base of `origin/<default branch>` (design D3), with an injected exec. Verify with a test on a temporary repository: one change, no change, two changes, a change only under `archive/`, and a branch that also touches a glossary file.

## 4. Transitions

- [x] 4.1 Add the `implement → verify` row to the transition table, generalise the autonomy rule to the stage being left, and make the approval question's text and `Approve` value depend on the row (design D7). Verify with `transition.test.ts`, one test per new scenario of the autonomous-run deltas "Transition mode", "Transition answers", "Approval question" and "The transition waits for the persistence receipt", and of the label-contract requirements "A transition replaces the stage" and "The autonomy decides whether leaving implement needs an answer", with every existing transition test unchanged.
- [x] 4.2 Implement the guards on leaving `implement` (design D6): the workspace from the task's latest attempt record, the change found by 3.2, unchecked tasks from `openspec list --json`, uncommitted changes, and unpushed commits after a fetch, with injected execs. Call them from transition mode before it emits a question or applies, and from answer mode before it applies. Verify with one test per scenario of "Leaving implement needs the work finished", on fakes.
- [x] 4.3 Document the third transition, the approval question for an implementation and the guards in the README's transition sections and in `commands/run.md`, and widen ADR 0004 to cover leaving the implementation stage. Verify with `bun run lint:markdownlint`.

## 5. Persist mode for the stage

- [x] 5.1 Add the `implement` plan to persist mode (design D8). Verify with `persist.test.ts`: every existing test unchanged, plus one test per new scenario of the autonomous-run deltas "Persist mode" and "Persist preconditions" and of the implementation-stage requirement "Implementation stage summary comment".

## 6. Selection

- [x] 6.1 Support `implement` in `select/stage.ts` and add `implement` to `STAGE_IDS` (design D1). Update the README's select section. Verify with `stage.test.ts` and `candidates.test.ts`, one test per new scenario of the work-selection deltas, and `bun run lint:markdownlint`.

## 7. The implementation stage

- [x] 7.1 Implement the prerequisites in `stages/implement/` (design D2, D3, D4): the shared checks, the apply and update workflows through the workflow check, and the change to implement. Verify with `implement.test.ts`, one test per scenario of "Implementation prerequisites" and "The change to implement", in temporary repositories.
- [x] 7.2 Implement the prompt, `agentArgs` (`--model opus --effort high`) and `completed`, and register the stage (design D2, D5). Verify with `implement.test.ts`, one test per scenario of "The implementation stage", "The implementation prompt", "A new attempt resumes the work", "Orchestration is stated as intent", "Deviations from the proposal", "Implementation commits", "The checks pass before the transition", "The implementation prompt follows the autonomy", "The implementation closing order", "The pull request stays a draft", "A blocked AFK orchestrator ends without a transition", "Public repositories in the implementation" and "Implementation completion".
- [x] 7.3 Document the stage in the README: its prerequisites, what the orchestrator does per autonomy, the commit rules, the closing order, the guards, a blocked `AFK` orchestrator, a re-attempt, and the upgrade notes (`--bootstrap-labels` for `verify`, and stopping the loop before the upgrade, design Migration Plan). Update the glossary's opening paragraph, which still says the implementation stage does not exist. Verify with `bun run lint:markdownlint`.
- [x] 7.4 Make an `AFK` orchestrator whose transition is refused fix what the refusal names and run it once more, and, when it is refused again, publish a blocked logbook entry, write no result marker and stop (design D9). Update the README's closing paragraph and its blocked `AFK` section. Verify with `implement.test.ts`, one test per scenario of "The implementation closing order", and `bun run lint:markdownlint`.

## 8. Integration checks

- [x] 8.1 Run the full toolchain and the strict validation: `bun run test`, `bun run typecheck`, `bun run lint:oxfmt`, `bun run lint:eslint`, `bun run lint:markdownlint`, `bun run lint:knip`, `bun run lint:fallow`, `bun run lint:marketplace` and `openspec validate add-implementation-stage --strict`. Verify that every command passes and that `bun.lock` is not modified.

## 9. End-to-end verification

Results go to `openspec/changes/add-implementation-stage/evidence/implementation-verification.md`. Every tracker or repository write here needs the user's go-ahead first.

- [ ] 9.1 With the loop stopped, bootstrap `verify` on the trackers with the user's go-ahead, and record the bootstrap report.
- [ ] 9.2 Real task: run the stage on DOT-121 (`HITL`, pull request #90) by hand, through the orchestration, the commits, the review, the `Approve` answer, the logbook entry and the reconcile run that removes the session. Record the teammates' models and efforts as the session reports them, the commits, the stage summary comment, the labels and the pull request's draft state.
- [ ] 9.3 Sandbox cases, each recorded with its tracker state and the reconcile result:
    1. an `AFK` task from launch to `verify` with no question;
    2. the guards refusing a transition with an unchecked task, then with an uncommitted change;
    3. a blocked `AFK` orchestrator whose check cannot pass, ending retained with its work pushed;
    4. a second attempt after a discard without `--release-workspace`, which resumes from the checked tasks and commits the uncommitted changes;
    5. a dry run on a repository with neither the skill `openspec-update-change` nor the command `/opsx:update`, which waits with the reason naming both.

    Clean up the sandbox tasks and pull requests afterwards.

## Workflow follow-up

- Commit as `feat(autonomous): …`, a minor with no `BREAKING CHANGE` footer, excluding `bun.lock`.
- Run `/opsx:verify` on this change, then archive it.
- Restart the loop after 9.2.
