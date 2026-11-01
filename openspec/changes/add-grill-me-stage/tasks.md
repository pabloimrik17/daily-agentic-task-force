# Tasks

## 1. Baseline

- [ ] 1.1 Verify the starting point:
    - the stack layer `feature/DOT-110-grill-me-session` is rebased on `feature/DOT-110-grill-me-stage`: `gh stack view --json` shows `needsRebase` false;
    - change 1 is fully implemented: every task in `openspec/changes/add-stage-labels-and-transition/tasks.md` is checked, except its workflow follow-up;
    - `bun run test`, `bun run typecheck` and `bun run lint:fallow` pass before any code change.

## 2. Tracker abilities

- [ ] 2.1 Add `closed` to `TrackerTask`, filled by `readTask` and `listTasks` in the three trackers (design D6):
    - Beads: status `closed`;
    - GitHub: state `CLOSED`;
    - Linear: `isExcluded(type, status)`.

    Verify with `beads.test.ts`, `github.test.ts` and `linear.test.ts` on recorded outputs: an open task, a closed task, and a Linear canceled and duplicate task.
- [ ] 2.2 Add `updateDescription(id, file)`, `addComment(id, file)` and `readComments(id)` to the `Tracker` interface and the three trackers, with the commands of design D4. Verify with the three tracker tests:
    - the exact arguments each method issues;
    - `readComments` parses a recorded comment listing of each CLI into comment bodies;
    - a failing command returns an error naming it.

    The triage and selection fakes gain the methods, and none of their tests change.

## 3. Stage contract and launch

- [ ] 3.1 In `stages/stage.ts`, add `prerequisites(env)` and a `context` in `StagePromptInput` (design D1); the test stage returns `ok` with an empty context. In `attempts/launch.ts`, call it after the registry check and before the `taken`, open-attempt and repository checks, and pass the context to `prompt`. Document the contract change in the README's stage section. Verify with:
    - `stages.test.ts` and `launch.test.ts`, one test per scenario of the stage-sessions deltas: "Prerequisite not met" writes no record, label, prompt or session; "Stage without prerequisites" holds for `test`; the dry run still advances;
    - `bun run lint:markdown`.

## 4. The grill-me stage

- [ ] 4.1 Implement the skill lookup in `stages/grill-me/skills.ts` (design D2): read the registry, take the `mattpocock-skills@*` entry with scope `user` first, search `skills/` at most two levels deep, and strip the frontmatter. Verify with `skills.test.ts` in a temporary home:
    - a registry and plugin laid out like 1.3.2;
    - the same skills under another category and version directory;
    - a missing registry, a missing plugin entry and a missing skill, each with its own reason;
    - frontmatter stripped and the body intact.
- [ ] 4.2 Implement the stage in `stages/grill-me/` and register it in `stages/registry.ts` (design D3, D6, D8):
    - prerequisites: the tool is `claude`, plus the two skills;
    - the prompt: the frame plus the four sections, with the attempt's paths and commands, the definition template, and the GitHub rule;
    - `agentArgs`;
    - `completed`.

    Verify with `grill-me.test.ts`, one test per scenario of the grill-me-stage requirements that concern the prompt, prerequisites, identity and completion. This includes:
    - "Codex configured";
    - "Skill bodies in the prompt";
    - "Handoff redirected";
    - "Commands named";
    - "GitHub task" and "Linear task";
    - "Transitioned", "Transition not applied" and "Task closed by the human";
    - a `--stage grill-me` argument is accepted by `args.ts`.
- [ ] 4.3 Document the grill-me stage in the README: its prerequisites (Claude Code with `mattpocock-skills`), its model, what the session does and in which order, how a split and a "Later" answer behave, and that `codex` is not supported. Verify with `bun run lint:markdown`.

## 5. Persist mode

- [ ] 5.1 Add `--persist <attempt-id>` to `args.ts`: it requires `--apply`, combines with `--json` only, and needs a well-formed attempt id. Verify with `args.test.ts`: the valid form; a malformed id; `--persist` without `--apply`; `--persist` with `--account`, `--transition` and `--answer`.
- [ ] 5.2 Implement the description splice as a pure function in `src/persist/splice.ts` (design D4). Verify with `splice.test.ts`:
    - a first grill;
    - a second grill replacing only the part above the separator;
    - an empty original description;
    - a description that contains `---` but not the layout, which is treated as original text.
- [ ] 5.3 Implement persist mode in `src/persist/` and dispatch it from `run.ts` without the run lock (design D4):
    - the preconditions;
    - the fresh read;
    - the description write through a file in the attempt directory, with read-back;
    - posting the comment only when no comment carries the attempt's header, with read-back;
    - the atomic `persisted.json`;
    - the `autonomous.persist.v1` report in text and JSON.

    Verify with `persist.test.ts` on fake trackers, one test per scenario of "Definition layout", "Stage summary comment", "Persistence is read back and leaves a receipt", "Persist mode", "Persist preconditions" and "Persist report", plus:
    - a rerun after a failed comment read-back posts no second comment and writes the receipt;
    - a description read-back mismatch writes no receipt.
- [ ] 5.4 Document persist mode, its report and its exit codes in the README. Verify with `bun run lint:markdown`.

## 6. Transition waits for the receipt

- [ ] 6.1 In `src/transition/`, check for an open `grill-me` attempt of the task and its `persisted.json` before emitting the question and before applying an answer (design D5), and note the check in the README's transition section. Verify with:
    - `transition.test.ts`, one test per scenario of "The transition waits for the persistence receipt": no receipt gives exit 3 with no handoff; an answer is `rejected` naming the attempt; with a receipt the question is emitted; with no open attempt nothing is checked;
    - `bun run lint:markdown`.

## 7. GitHub children

- [ ] 7.1 Read sub-issues in the GitHub reader's `detail` (design D7) from a recorded `gh issue view --json subIssues` fixture, keep only the open ones as children, and change the report's GitHub note to dependencies only. Record the gh minimum version (2.100) in the README. Verify with:
    - `github.test.ts` for the reader, `candidates.test.ts` and `render.test.ts`, one test per scenario of the work-selection deltas: "GitHub task", "GitHub split" and "GitHub sub-issues all closed";
    - `bun run lint:markdown`.

## 8. Integration checks

- [ ] 8.1 Run the full toolchain and the strict validation:
    - `bun run test`, `bun run typecheck`, `bun run lint:oxfmt`, `bun run lint:eslint`, `bun run lint:markdown`, `bun run lint:knip`, `bun run lint:fallow` and `bun run lint:marketplace`;
    - `openspec validate add-grill-me-stage --strict`.

    Verify that every command passes and that `bun.lock` is not modified.

## 9. End-to-end verification

The stage is verified with real sessions and the user grilled in each. Results go to `openspec/changes/add-grill-me-stage/evidence/grill-verification.md`.

- [ ] 9.1 Prepare the sandbox, with the user's go-ahead before any creation:
    - a private repository for throwaway grills under the workspace root, cloned so that repository inference finds it;
    - Beads tasks for it, created through `labelling-new-tasks` with `personal`, `grill-me` and the repository's name as a label;
    - a GitHub issue there for the GitHub split.

    Verify with a dry run, `/autonomous:run --task beads:<id> --stage grill-me` without `--apply`, which reports the sandbox repository and branch.
- [ ] 9.2 Real task: run the stage on one real `grill-me` task the user picks (for example DOT-121), through to an AFK or HITL outcome. Record:
    - the persisted definition and stage summary;
    - the labels after the transition;
    - the reconcile run that removed the session and `taken`.
- [ ] 9.3 Sandbox cases, each recorded with its tracker state and the reconcile result:
    1. the other autonomy outcome (HITL or AFK);
    2. a confirmed split into two Beads subtasks, with the parent excluded as split by a following selection;
    3. a GitHub split creating sub-issues;
    4. an interruption before persistence: the session is killed before step 4, there is no receipt, the transition is refused, and the attempt is retained;
    5. a grill that ends with the task closed by the user, after which reconcile removes the session.

    Clean up the sandbox tasks afterwards.

## Workflow follow-up

- Commit as `feat(autonomous): …`, a minor with no `BREAKING CHANGE` footer, on the `feature/DOT-110-grill-me-session` layer, excluding `bun.lock`. Push it with `gh stack push` and keep the stack in sync.
- Run `/opsx:verify` on this change, and archive it after change 1 is archived.
- Before archiving, compare this change's `work-selection` "Selection report" block with the archived `openspec/specs/work-selection/spec.md`, and carry over any edit change 1 made to that requirement during its implementation or verify. Archive replaces the whole requirement, and validation does not catch a stale copy.
- After release, the grill-me stage runs from selection without `--task`. DOT-119, DOT-120 and DOT-121 follow up.
