## Why

When `label-triage` cannot decide a label group, the only way the question reaches the human is the report's "for the human" section. It repeats every run until someone labels the task by hand in its tracker. A read-only count on 2026-09-30 found 555 open tasks without an entry label and without evidence, plus 70 Beads tasks without scope. Each run judges at most 25 of them, and the first `--apply` wrote only 1 judged label. So a hand run typically leaves about 20 groups for the human, each one something the user could answer in seconds but has to act on in the tracker.

Linear DOT-104, a sub-issue of DOT-82 and unblocked since DOT-102 shipped, asks the command to ask those questions on the spot and apply the answers. It is also the first real use of the run report's reserved `handoff` field, so it fixes that field's shape for every later user. DOT-110, the grill-me stage, will reuse the same protocol for its transition.

## What Changes

- **Emit `handoff`.** The run report's `handoff` becomes what the run asks the agent that ran the command to do next. Its first and only kind is a list of questions for the human:
    - Each question carries an opaque id, the step that asked it, a short header, the question text, and two to four options. Each option has a display label, a value and a description; an option whose value is null means "no answer" and is never passed back.
    - Code composes every part; the command never writes a question.
    - A run emits a handoff only when it was invoked with `--apply` and without `--no-handoff`, and at least one question exists.
    - At most 4 questions go into one handoff, one AskUserQuestion round, plus a count of those left out.
    - In text mode the handoff is the report's last line, as one line of JSON, so the command reads the same document in both modes.
- **Add `--no-handoff`.** It suppresses the handoff. A `/loop` passes it, because no human is present, and its questions stay in the report as today.
- **Add answer mode.** `--apply --answer <id>=<value>[,<value>]…` runs no step, needs no quota and no judgement. It routes each answer to the step named in its id, which validates and applies it:
    - Each answer is reported as `applied`, `skipped`, `rejected` or `failed`.
    - The report is `autonomous.answers.v1` with `--json` and never carries a handoff.
    - It exits 0 when every answer is applied or skipped, 3 when any is rejected or failed, and 1 on a usage error.
    - `--answer` without `--apply` is a usage error.
- **`label-triage` asks and applies.** The groups it leaves for the human (`asked`) become questions:
    - A group is `asked` when it is below the threshold, when the judgement is invalid, or when the evidence conflicts. Conflicts between labels already on a task, tasks not judged, tasks beyond the cap, and every task of a source whose writes stopped in this run are not asked.
    - They are ordered with `work` first, then by most recent update. A task's scope question comes before its entry question.
    - The question text names the source, task id and title, and shows what the run saw: labels, tier, confidence and reason. It adds the start of the description when the run read it.
    - The options are the group's contract labels in contract order, with their meanings. The judged option's description is prefixed with its confidence and reason, without moving it. Every question also has a "Later" option. Both scope and entry questions take one choice.
    - An answer is applied only when its label belongs to the group and the task still lacks that group, through the step's additive write with read-back. Answers are not stored.
- **The command relays one round.** `commands/run.md` stops "taking no further action" when the report carries a handoff and AskUserQuestion is available:
    1. It asks the questions in one call.
    2. It turns each answer that is an offered, non-null option value into an `--answer`.
    3. It reruns the script once in answer mode and relays that report.
    4. It ends. It never asks twice and never passes free text typed through "Other".
- **Glossary and ADR.** Add `plugins/autonomous/CONTEXT.md`, the domain glossary agreed while refining this change. Add `plugins/autonomous/docs/adr/0001-properties-persist-stages-replace.md`, which records the label model agreed at the same time; DOT-110 implements that model.
- **Documentation.** The plugin README documents the handoff, `--no-handoff`, answer mode and its exit codes, and the `/loop` invocation.

**Out of scope**:

- The label model recorded in the ADR: separate autonomy and stage groups, the `proposal` label, `autonomous.run.v2`, recolouring in bootstrap, and `--transition` out of `grill-me`. All of it belongs to DOT-110.
- Correcting or removing labels already on a task: the label contract's never-remove rule is unchanged.
- More than one round of questions per run, a configurable question limit, and persisting answers between runs.
- The Jev replacement of the judgement (DOT-105).
- Selection, sessions and scheduling (DOT-108, DOT-109, DOT-111).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `autonomous-run`: covers four things.
    - The run report emits `handoff` (its shape, when a run emits it, the 4-question limit and the text-mode line).
    - The command runs one round of questions instead of ending.
    - `--no-handoff` is added.
    - `--answer` is added as answer mode, with its own report and exit codes.
- `label-triage`: the step contributes questions for the groups it leaves for the human, and validates and applies answers to them through its additive write path with read-back.

## Impact

- **Code** (`plugins/autonomous/src/`):
    - `args.ts`: `--no-handoff`, `--answer` and their combinations.
    - `runner.ts`: optional question and answer hooks on `Step`.
    - `report.ts`: building, capping and rendering the handoff.
    - `run.ts`: answer mode, dispatched like `--bootstrap-labels`.
    - `label-triage/`: building questions, validating and applying answers, reusing `detect`, `isValidGroup` and `applyDerivations`.
    - Tests for each.
- **Command**: `plugins/autonomous/commands/run.md` (the handoff round and `argument-hint`).
- **Docs**: `plugins/autonomous/README.md`, `plugins/autonomous/CONTEXT.md` (new), `plugins/autonomous/docs/adr/0001-properties-persist-stages-replace.md` (new).
- **Report contract**: `autonomous.run.v1` stays; `handoff` was reserved, so emitting it is additive. The answer report adds the new `autonomous.answers.v1` schema.
- **Behaviour change for consumers**: a hand `--apply` run through `/autonomous:run` may now end with up to 4 questions. A `/loop` that runs with `--apply` must add `--no-handoff`, or it stops at the first question until someone answers.
- **Dependencies**: none new. The plugin still installs without dependencies and runs on `bun`.
- **Release**: a `feat(autonomous): …` commit, a minor release through release-please. No breaking change and no manual version bump. The branch is one commit behind `main` (release 1.1.0) and is rebased before implementation.
- **Tracking**: Linear DOT-104, sub-issue of DOT-82. DOT-110 depends on this change's handoff and answer mode.
