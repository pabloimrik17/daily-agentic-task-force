# Design

## Context

See proposal.md - Why. The relevant code today:

- `select/candidates.ts` applies ordered exclusions; only `unsupported-stage` overlaps with what `launch` checks.
- `attempts/launch.ts` `preconditions` checks, in order: stage registered, repository inferred (`workspace/infer.ts`), stage prerequisites (`Stage.prerequisites(env)`), `taken`, no open attempt (`openAttempt`).
- `select/compare.ts` asks the LLM for one winner, not an order.
- The only repository-level prerequisite is the OpenSpec root, checked inside the OpenSpec stages' `prerequisites` (`stages/openspec-stage.ts`).
- `loop/notices.ts` derives notices from the iteration's report; `loop/files.ts` resets `loop.log` and `loop.notices` when a loop starts.
- Measured on 2026-11-28: of the open Beads tasks, 929 `work`, 54 `personal` and 66 unscoped ones carry no label that names a directory under this machine's workspace root, and 2 `personal` ones name two. Work repositories are not cloned on a personal machine, so most of those are expected, not mistakes.

## Goals / Non-Goals

**Goals:**

- A task `launch` would refuse is not a candidate, so one such task cannot hold the loop.
- The person learns which tasks need them, without a line per task of another machine's scope.

**Non-Goals:**

- Falling through in `launch`, a ranking from the LLM, repository aliases, a title-prefix signal, any tracker write.
- The one-line-per-iteration summary and the notice styling (`one-notice-per-iteration`).
- A label that keeps a task out of the loop on purpose (DOT-142).

## Decisions

### D1. Filter in `select`; `launch` stays a safety net

`select` learns the checks; `launch` keeps all of them unchanged and waits on a failure. Alternative rejected: `launch` tries the next candidate after a wait. It needs a ranking or one more LLM call per stuck task on every iteration, and it leaves **Candidate** contradicting the glossary. The window between the two steps is one run long, so a wait in `launch` is a rare race that the next iteration resolves.

### D2. Where each exclusion sits

Order after this change: classification, **open attempt**, taken, triage-me, labelled this run, unsupported stage, blocked, split, **repository**, **repository prerequisites**, no free slot; then **prerequisites** for the chosen task only.

- Open attempt comes before `taken` because a retained attempt keeps `taken`: the more specific reason must win, or a retained task would never be stuck. The records are read once per run with `readRecords`; a failed read is `not-evaluable` (every read fails closed, as today).
- Repository comes after split because Linear's signal, the project, is only known after `detail()`, and because a blocked or split task is not worth a stuck notice yet. It adds no tracker read: tasks that reach it are detailed today.
- `listRepositories(root)` runs once per run, not per task.

### D3. Repository prerequisites as a separate, optional member of the stage contract

`Stage` gains `repositoryPrerequisites?(repository: string): Promise<{ ok: true } | { ok: false; reason: string }>`. The OpenSpec stages move their OpenSpec-root check there and keep calling it from `prerequisites`, so `launch` behaves as before. `select` memoises the result per `stage id + repository`. Alternative rejected: run the whole `prerequisites` for every candidate. They read the tracker, the pull request and git for each task; with hundreds of candidates that is minutes of reads per iteration.

### D4. Per-task prerequisites for the chosen task, then choose again

After `choose`, `select` builds the same `StageEnv` as `launch` (the builder moves out of `launch.ts` into a shared module) and calls `stage.prerequisites`. On failure it removes the task, re-applies `splitByStage` to what remains and calls `choose` again. At most 4 chosen tasks are checked (3 re-elections). Re-applying the stage rule is what lets `proposal` tasks launch when the only `implement` task fails (DOT-141). Cost: up to 3 extra comparisons, each bounded by the existing 300 s limit, only in runs where a chosen task fails; after the first run the person is told and fixes or the same task fails again next iteration. To keep that from repeating forever at LLM cost, see D6.

`launch` runs the prerequisites again for the selected task, because it needs their `context` for the prompt and because of D1. The double read is one task per run.

### D5. `Excluded` carries a detail and a stuck flag

`Excluded` gains `detail: string | null` (the reason text `launch` would give, or the attempt id and state) and `stuck: boolean`. `Exclusion` gains `open-attempt`, `repository`, `repository-prerequisites` and `prerequisites`. Stuck is derived in one place: the three repository and prerequisite exclusions, and `open-attempt` when the attempt's state is `retained`. The report schema stays `autonomous.run.v2`: the fields are additions.

`launch`'s `readUnit` passes a supplied task through `selectCandidates`. It must not get the new exclusions there, or its waits would lose their specific reasons and order (spec stage-sessions, "The launch step"). `selectCandidates` takes the attempt records and the repositories as optional dependencies; `readUnit` passes neither, as it passes no slots outside the loop.

### D6. Remembering failed prerequisites within a loop

A task excluded as prerequisites is not known to fail until it is chosen, so without memory the comparison would pick it first on every iteration and spend a re-election each time. The loop keeps `loop.stuck` in the state directory: one line per stuck task the loop has met, of any scope, with its exclusion and reason, whether or not it was told. `select` in a loop iteration receives the task keys recorded there with a prerequisites reason and checks those tasks' prerequisites before the comparison (a handful of reads), excluding the ones that still fail. A task whose prerequisites now hold becomes a candidate again. Outside the loop nothing is remembered. Under D9 the same file also remembers a task whose prerequisites could not be read.

### D7. Stuck notices: machine scope, once per task and reason, five per iteration

`notices.ts` reads the select data and records every stuck task whose `task key + exclusion + detail` is not in `loop.stuck`, of any scope, then emits `stuck <source>:<id>: <detail>` only for those of the machine scope. `startFiles` resets `loop.stuck` with the other loop files, so a new loop tells everything again.

Two limits come from the measurement in Context; the person confirmed both on 2026-11-28:

- **Machine scope only.** On a personal machine 929 `work` tasks have no repository here and never will. Naming them would bury the 56 that are the person's to fix. They stay in the report and the log as stuck.
- **Five per iteration, plus a count line** (`stuck +51 more: see loop.log`), like the `triage-me` notice. The first iteration of a loop would otherwise write 56 lines.

Alternative rejected: one notice per reason with a count. It hides which tasks, which is the thing the person needs.

**Which five.** Found in review: the five were the first in the order of the excluded list, where tasks with no repository come first and the tasks that failed their prerequisites last. With 57 `personal` tasks without a repository, a task the person could release in a minute was never named, and because it was recorded it was not named later either. The notices are now ordered before the cut: a retained attempt, failed prerequisites and unreadable prerequisites (D9) first, then repository prerequisites, then no repository. The order inside each group stays the order of the excluded list. `loop.stuck` records every task whatever the order. The person decided this on 2026-11-28.

### D8. A prerequisite that cannot be read is not a failed one

Found in verification: the stages reported a read error (the plugin registry, `openspec --version`, the task's context, the pull request or git lookups) as an ordinary failed prerequisite, so a problem of the whole machine marked every chosen task stuck, told a notice for each and spent up to 4 comparisons per iteration. A failed `StagePrerequisites` gains an optional `unreadable: true`, set by the checks whose read failed; a check that read and found something missing (a skill not installed, a workflow absent, no pull request, no OpenSpec root) stays a plain failure. `launch` ignores the flag and waits with the reason, as before. `select` makes the step `not-evaluable` with the reason, for the chosen task and for a task remembered under D6, and excludes nothing for it. The person decided this on 2026-11-28, over narrowing the spec to a check that throws. D9 limits it to the first time in a loop.

### D9. A task whose prerequisites cannot be read again is set aside

Found in review: some of the reads D8 marks unreadable belong to one task, not to the machine: the task's context, the pull request lookup of its branch, the git reads of its change. When one of them fails every time for one task, the comparison chooses that task on every iteration and the step is `not-evaluable` every time, so the loop launches nothing: the stall this change exists to remove, at one comparison per iteration.

D8 stays for the first time. When `select` is `not-evaluable` because a task's prerequisites cannot be read, its data names that task (`unreadable`), and the loop records it in `loop.stuck` as a memory entry (exclusion `unreadable-once`), with no notice. In a later iteration of the same loop, `select` checks that task's prerequisites before the comparison, as for D6:

- they hold: the task is a candidate;
- they fail: it is excluded as prerequisites;
- they cannot be read again: it is excluded as **unreadable prerequisites**, a new exclusion that makes the task stuck, with the read error as its reason. The selection goes on with the other candidates.

A task excluded this way is checked again in every iteration, so it comes back by itself when the read works. The same rule applies to a chosen task that is remembered. Outside the loop nothing is remembered and D8 applies unchanged.

The person asked for "a read that failed in consecutive iterations". The memory is not cleared when a read works in between, because `loop.stuck` is append-only: a task whose read failed once, then worked, then fails again is set aside at that second failure, without a `not-evaluable` iteration first. In the case that matters, a read that fails every time, the two are the same.

Alternatives rejected: treating the per-task reads as failed prerequisites again brings back D8's problem whenever `gh` or the tracker is down. Telling per-task reads from machine-wide ones by their reason text is fragile: a network failure names the task in the text too.

The cost: while a machine-wide read fails, each iteration sets one more task aside and tells it once, with one comparison per iteration, where D8 alone would report `not-evaluable` every time. A cap bounds it: a run excludes at most 3 tasks as unreadable prerequisites, and the next one makes the step `not-evaluable`, as under D8. So an outage costs three notices and then reads as an outage, and the tasks come back by themselves when the read works again. The price is that four tasks whose own reads fail at the same time hold the loop again until a person fixes one. The person chose 3 on 2026-11-28, over no cap and over a cap of 1.

## Risks / Trade-offs

- [A repository-level check that is wrong excludes every task of a repository] → the reason names the repository and what it lacks, and the tasks are listed as stuck in every report.
- [Selection now reads the state directory and the workspace root, so it can fail where it could not before] → both fail closed with the read error, as every other read of the step.
- [Up to 4 comparisons in one run lengthen an iteration] → bounded by the count and by the existing per-call limit; D6 keeps it to the first iteration that meets a failing task.
- [The machine-scope limit hides a `work` task selected as an exception that is stuck] → it is still excluded and listed in the report; only the notice is skipped.
- [`loop.stuck` grows] → it is bounded by the number of stuck tasks and reset on every loop start.
- [A machine-wide read failure sets aside one task per iteration under D9] → at most 3 at once; each is told once with the cause, is checked again every iteration and returns when the read works.
- [The order of D7 hides a task with no repository behind five others] → the count line says how many are not named and the log lists them all.

## Migration Plan

No migration: no configuration, no tracker label, no state format change for attempts. `loop.stuck` is created on the next loop start. Rollback is reverting the change; a leftover `loop.stuck` is ignored.

## Open Questions

None.
