# Tasks

## 1. Baseline

- [x] 1.1 Verify the starting point: `add-stage-pull-request-and-logbook` is fully implemented (every task in its `tasks.md` is checked, except its workflow follow-up), and `bun run test`, `bun run typecheck` and `bun run lint:fallow` pass before any code change.
- [x] 1.2 Bring in the documentation the grill wrote for this change: the glossary terms Proposal preparation and Proposal, the Stage label and Transition wording, and `docs/adr/0004-afk-proposal-transition-needs-no-answer.md`. The glossary text was set aside in `openspec/changes/add-proposal-stage/glossary-set-aside.patch`, committed with this proposal: restore it with `git apply openspec/changes/add-proposal-stage/glossary-set-aside.patch` (do not rewrite the terms), then delete the patch. The ADR was committed with this proposal and is already in place. Verify with `bun run lint:markdown` and that the glossary's opening paragraph no longer says the stages after the grill are unimplemented.

## 2. The implement label

- [x] 2.1 Add `implement` to the contract's stage labels, colours and meanings (design D1), and let triage decide the autonomy of a task in `implement` between `AFK` and `HITL`. Update the README's label contract section. Verify with `contract.test.ts`, `detect.test.ts`, `bootstrap.test.ts` and `decide.test.ts`, one test per new scenario of the label-contract deltas "Three label groups", "Meaning of each label" and "One spelling and one colour per label" and of the label-triage delta, and `bun run lint:markdown`.

## 3. Launch order and stage environment

- [x] 3.1 Infer the repository before the prerequisites in `attempts/launch.ts`, and extend `StageEnv` with the task, the repository, the branch and the readers (design D2); grill-me and the test stage ignore them. Update the README's launch section. Verify with `launch.test.ts` and `stages.test.ts`, one test per scenario of the stage-sessions delta, plus that every existing launch test still passes with the new order.

## 4. Task context

- [x] 4.1 Record the real output of each context read as a fixture, with read-only commands on existing tasks: `linear issue view --json` for an issue with relations and an attachment, `bd show --json --include-comments --include-dependents`, and `gh issue view --json comments,subIssues,parent,closedByPullRequestsReferences`. Verify that each fixture is committed under `src/context/fixtures/` and that the fields design D4 names are present, or note in the design which are not.
- [x] 4.2 Implement the `ContextReader` port and its three implementations in `src/context/` (design D4). Verify with one test file per source on the fixtures, one test per scenario of "The run gathers the task's context" and "Context that only some trackers have", plus a missing field that yields an empty list and a note.
- [x] 4.3 Render the Context section as a pure function in `src/context/render.ts`. Verify with `render.test.ts`: a full context, an empty one that renders no empty list, and comments in order.

## 5. Transitions

- [x] 5.1 Replace `FROM_STAGE` and `TO_STAGE` with the transition table, and extract the shared apply function from `transition/answer.ts` (design D6), with no change in behaviour for `grill-me`. Verify that `transition.test.ts` passes unchanged.
- [x] 5.2 Add the `proposal` row: the approval question for `HITL`, the direct apply for `AFK`, the receipt check by stage, the `applied` field of the report, the answer `implement`, and `by` in `transition.json`. Verify with `transition.test.ts`, one test per scenario of the autonomous-run deltas "Transition mode", "Transition answers", "The transition waits for the persistence receipt" and "Approval question", and of the label-contract requirements "A transition replaces the stage" and "The autonomy decides whether leaving proposal needs an answer".
- [x] 5.3 Document the second transition, the approval question and the `AFK` path in the README's transition sections and in `commands/run.md`. Verify with `bun run lint:markdown`.

## 6. Persist mode for the stage

- [x] 6.1 Make persist mode take its required files, steps and comment header from the attempt's stage (design D7). Verify with `persist.test.ts`: every existing grill-me test unchanged, plus one test per scenario of the autonomous-run deltas "Persist mode" and "Persist preconditions" and of "Proposal stage summary comment". Update the README's persist section and verify with `bun run lint:markdown`.

## 7. Selection

- [x] 7.1 Read `childCount` in the three readers' `detail` (design D8) from recorded outputs. Verify with the reader tests, one test per scenario of "Closed children are counted".
- [x] 7.2 Support `proposal` in `select/stage.ts`, exclude a `proposal` task with any child as split, and add `readyToClose` to the step's data and both reports. Update the README's select section. Verify with `stage.test.ts`, `candidates.test.ts` and `render.test.ts`, one test per scenario of the work-selection deltas, and `bun run lint:markdown`.

## 8. The proposal stage

- [x] 8.1 Implement the prerequisites in `stages/proposal/` (design D3, D4, D5): the tool, the OpenSpec root, the CLI, the `handoff` skill, the context read and the open pull request. Verify with `proposal.test.ts`, one test per scenario of "Proposal prerequisites", in a temporary repository with and without an `openspec` directory.
- [x] 8.2 Implement the prompt, `agentArgs` and `completed`, and register the stage (design D5, D9). Verify with `proposal.test.ts`, one test per scenario of "The proposal stage", "The proposal prompt", "The prompt follows the autonomy", "The proposal closing order", "A proposal's commits and pushes", "A new attempt continues the work", "A blocked AFK agent ends without a transition", "Public repositories" and "Proposal completion".
- [x] 8.3 Document the stage in the README: its prerequisites, what the session does per autonomy, the closing order, a blocked `AFK` agent, a re-attempt, and the upgrade note about `--bootstrap-labels`. Verify with `bun run lint:markdown`.

## 9. Integration checks

- [x] 9.1 Run the full toolchain and the strict validation: `bun run test`, `bun run typecheck`, `bun run lint:oxfmt`, `bun run lint:eslint`, `bun run lint:markdown`, `bun run lint:knip`, `bun run lint:fallow`, `bun run lint:marketplace` and `openspec validate add-proposal-stage --strict`. Verify that every command passes and that `bun.lock` is not modified.

## 10. End-to-end verification

Results go to `openspec/changes/add-proposal-stage/evidence/proposal-verification.md`. Every tracker or repository write here needs the user's go-ahead first.

- [x] 10.1 Bootstrap `implement` on the trackers with the user's go-ahead, and record the bootstrap report.
- [x] 10.2 Real task: run the stage on DOT-121 (`HITL`), or another task the user picks, through the review, the `Approve` answer, the logbook entry and the reconcile run that removes the session. Record the pull request, the stage summary comment and the labels.
- [x] 10.3 Sandbox cases, in the sandbox repository with OpenSpec initialised by the user, each recorded with its tracker state and the reconcile result:
    1. an `AFK` task from launch to `implement` with no question;
    2. a `Later` answer, which leaves the session open and no entry;
    3. a blocked `AFK` agent, on a task whose description contradicts itself, ending retained;
    4. a second attempt after a discard, which continues the same change and pull request;
    5. a dry run on a repository without OpenSpec, which waits with the reason;
    6. a split parent whose subtasks are closed, excluded as split and listed as ready to close.

    Clean up the sandbox tasks and pull requests afterwards.

## Workflow follow-up

- Commit as `feat(autonomous): …`, a minor with no `BREAKING CHANGE` footer, excluding `bun.lock`.
- Run `/opsx:verify` on this change, and archive it after `add-stage-pull-request-and-logbook` is archived.
- Follow-ups for the user to file: excluding in selection the tasks whose repository lacks OpenSpec, with DOT-120; the implement stage.
