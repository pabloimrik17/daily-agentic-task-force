# Tasks

## 1. Baseline

- [x] 1.1 Verify the starting point: `bun run test` and `bun run typecheck` pass before any code change.

## 2. Shared pieces out of `launch`

- [x] 2.1 Move the `StageEnv` builder and the open-attempt lookup out of `attempts/launch.ts` into a module both steps import, returning the open attempt's id and state as data and leaving `launch`'s wait reasons unchanged. Verify that `launch.test.ts` passes without edits to its expectations.
- [x] 2.2 Add `repositoryPrerequisites` to the stage contract (design D3), move the OpenSpec-root check of the OpenSpec stages into it and keep `prerequisites` calling it. Verify with `openspec-stage.test.ts` and `stages.test.ts`: one test per scenario of the stage-sessions delta "Repository prerequisites of a stage", and the existing no-OpenSpec-root wait of `launch.test.ts` still passes.

## 3. Exclusions before the comparison

- [x] 3.1 Extend `Exclusion` and `Excluded` (design D5) and add the open-attempt exclusion before `taken`, with the records read once in `select/step.ts` and a failed read making the step not evaluable. Verify with `candidates.test.ts` and `step.test.ts`: one test per scenario of "A task with an open attempt is excluded".
- [x] 3.2 Add the repository exclusion after split, listing the repositories once per run. Verify with `candidates.test.ts`: one test per scenario of "A task without a single repository is excluded", including a Linear task whose project is known only after `detail()`.
- [x] 3.3 Add the repository-prerequisites exclusion, memoised per stage and repository. Verify with `candidates.test.ts`: one test per scenario of that requirement, asserting a single check for two tasks of one repository.
- [x] 3.4 Keep `launch`'s `readUnit` free of the new exclusions (design D5). Verify with `launch.test.ts`: a supplied task with no repository still waits with the inference reason, and one with an open attempt with the attempt's reason; add the scenario of "Launch never tries another task".
- [x] 3.5 Keep `candidates.ts` and `step.ts` inside the fallow complexity budget by splitting the checks into small functions. Verify with `bunx fallow audit` on the staged files.

## 4. The chosen task's prerequisites

- [x] 4.1 After the choice, check the chosen task's prerequisites, exclude it on failure, re-apply the stage rule and choose again, at most 4 chosen tasks (design D4); a prerequisite that throws or cannot be read makes the step not evaluable. Verify with `step.test.ts`: one test per scenario of "The chosen task's prerequisites are checked" and of the modified "Outcome of the step".
- [x] 4.2 In a loop iteration, check before the comparison the tasks `loop.stuck` records with a prerequisites reason (design D6). Verify with `step.test.ts`: a remembered task that still fails is excluded with no comparison spent on it, and one that now passes is a candidate.

## 5. Report

- [x] 5.1 Render the stuck tasks apart from the other excluded tasks, with scope, exclusion and reason, and carry `detail` and `stuck` in the JSON data. Verify with `render.test.ts` and `step.test.ts`: one test per scenario of "Stuck tasks" and "Stuck tasks in the report".

## 6. Notices

- [x] 6.1 Add `loop.stuck` to `loop/files.ts`, reset by `startFiles`, with read and append helpers. Verify with a new `files.test.ts` case: a new loop starts with it empty.
- [x] 6.2 Emit the stuck notices in `loop/notices.ts` for the machine scope, once per task and reason, five per iteration plus the count line (design D7), and record what was told from `loop/loop.ts`. Verify with `notices.test.ts` and `loop.test.ts`: one test per scenario of "Stuck task notices", and the existing scenarios of "Notices" still pass.

## 7. Docs

- [x] 7.1 README: the selection section (the new exclusions, their order, the repeated choice, stuck tasks), the loop's notices, and how to release a stuck task (a repository label equal to the directory name, an OpenSpec root, discarding a retained attempt). Check **Stuck task** in the glossary against the spec's definition and `commands/run.md` and `commands/loop.md` against the new report and notices. Verify with `bun run lint:markdownlint`.

## 8. Checks

- [x] 8.1 `bun run test`, `bun run typecheck`, `bun run lint:eslint`, `bun run lint:oxfmt`, `bun run lint:knip`, `bun run lint:fallow` and `bun run lint:marketplace` pass, and `openspec validate exclude-stuck-tasks-from-selection --strict` passes.
- [x] 8.2 With the loop stopped, run one dry iteration against the real trackers (`run.ts --loop` without `--apply`) and verify that the report lists stuck tasks with reasons and that the selected task is one `launch` reports it would launch.

## 9. Unreadable prerequisites (design D8)

- [x] 9.1 Add the optional `unreadable` flag to a failed `StagePrerequisites` and set it in every stage check whose read failed (plugin registry read, parse or shape; `openspec --version`; task context; pull request lookup; git reads of the change check), leaving the checks that read and found something missing as plain failures. `launch` keeps waiting with the same reason texts. Verify with `skills.test.ts`, `openspec-stage.test.ts`, `stages.test.ts` and `launch.test.ts`: one test per scenario of the stage-sessions delta "Prerequisites that cannot be read".
- [x] 9.2 In `select`, a chosen or remembered task whose prerequisites fail as unreadable makes the step `not-evaluable` with the reason and excludes nothing. Verify with `step.test.ts` and `run.test.ts`: the scenarios "Prerequisites cannot be read" and "Cannot be read now".
- [x] 9.3 README: say that a prerequisite that cannot be read makes `select` not evaluable instead of excluding the task. Verify with `bun run lint:markdownlint`.
- [x] 9.4 The checks of 8.1 pass again.

## 10. A task whose prerequisites cannot be read again (design D9)

- [x] 10.1 Name, in the select data, the task whose unreadable prerequisites made the step not evaluable, and have the loop record it in `loop.stuck` as a memory entry with no notice. Verify with `step.test.ts`, `notices.test.ts` and `loop.test.ts`: the scenarios "First time" and "Remembered without a notice".
- [x] 10.2 In a loop iteration, check a remembered task's prerequisites before the comparison and exclude it as unreadable prerequisites, a stuck exclusion, when they cannot be read again. Verify with `step.test.ts`: one test per scenario of "Prerequisites that could not be read earlier in the loop".
- [x] 10.3 README and glossary: the new exclusion, when it applies and how the task comes back. Verify with `bun run lint:markdownlint`.

## 11. Which stuck tasks are named (design D7)

- [x] 11.1 Order the stuck notices before the cut of five: retained attempt, prerequisites and unreadable prerequisites, then repository prerequisites, then repository. Verify with `notices.test.ts`: the scenario "Most actionable first", and that `loop.stuck` records every task.
- [x] 11.2 The checks of 8.1 pass again.
