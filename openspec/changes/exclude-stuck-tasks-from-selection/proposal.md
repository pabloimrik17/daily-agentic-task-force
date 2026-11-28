# Proposal

## Why

The loop can select a task that `launch` cannot start, and it selects it again on every iteration: on 2026-11-27 and 2026-11-28 it ran for 25 and 50 minutes with a work slot free and launched nothing (DOT-174, which absorbs DOT-120, DOT-141 and DOT-176). Selection never runs the checks that `launch` runs, so a task with no inferable repository, with failing stage prerequisites or with a retained attempt stays a candidate, against the glossary's own definition of one. The loop's notices say nothing about it, so the loop looks idle.

## What Changes

- Selection excludes, before the comparison, a task that has an open attempt, a task for which no single repository is inferred, and a task whose repository fails a repository-level prerequisite of its next stage (today: no OpenSpec root).
- The stage's per-task prerequisites are checked for the task the comparison chose. When they fail, the task is excluded and the choice is made again without it, at most 3 times per run.
- The exclusions that only a person can remove make the task a **stuck task**. The report and the JSON data list stuck tasks with their reason.
- The loop records a notice for the stuck tasks of the machine scope, once per task and reason for the life of the loop.
- `launch` keeps every precondition as a safety net and never tries another task.
- Nothing is written to a tracker: no `triage-me`, no new label. No repository aliases are added.

No breaking change and no new configuration.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `work-selection`: new exclusions (open attempt, repository, repository prerequisites, prerequisites of the chosen task), the repeated choice, stuck tasks in the report and the data, and the outcome when the choices run out.
- `stage-sessions`: a stage declares its repository-level prerequisites apart from its per-task ones; `launch` never tries another task.
- `autonomous-loop`: a new kind of notice, for stuck tasks.

## Impact

- `plugins/autonomous/src/select/`: `candidates.ts`, `step.ts`, `types.ts`, `render.ts` and their tests.
- `plugins/autonomous/src/attempts/launch.ts`: the stage environment and the open-attempt check become shared with selection; behaviour unchanged.
- `plugins/autonomous/src/stages/`: the stage contract and the OpenSpec stages (`proposal`, `implement`, `verify`, `code-review`).
- `plugins/autonomous/src/loop/`: `notices.ts`, `files.ts`, `loop.ts`.
- `plugins/autonomous/README.md`, `plugins/autonomous/GLOSSARY.md` (**Stuck task**, already added in the grill), `plugins/autonomous/commands/run.md` where it describes the exclusions.
- Selection reads the attempt records and the workspace root, and may call the comparison up to 4 times in a run.
- `one-notice-per-iteration` builds on this change and restyles its notices.
