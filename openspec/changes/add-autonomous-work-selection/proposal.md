## Why

`/autonomous:run` checks quota and labels the user's tasks, but nothing yet answers the loop's next question: of all that labelled work, which task should an agent advance next, and to which stage? Linear DOT-108, a sub-issue of DOT-82 that blocks DOT-111, asks for that selection. Its first useful increment runs selection by hand and shows the explanation, so the user can judge it before the periodic runner (DOT-111) or session management (DOT-109) depend on it.

The decisions were settled with the user in a grill on 2026-10-06 and are recorded in DOT-108.

## What Changes

- **New `select` step**, third in `/autonomous:run`, after `quota-gate` and `label-triage`. Like every step, it runs only when the earlier steps advanced. A source that cannot be read therefore stops the run in triage, as it does today. The step writes nothing and contributes no questions.
- **Code decides what is permitted.** It reads the open tasks of every enabled source and excludes, with a visible reason per task:
    - an incomplete or conflicting classification;
    - a task carrying `taken`;
    - a task with an open blocker (Beads and Linear);
    - a parent with open children (Beads and Linear);
    - a next stage that is not supported yet;
    - a task that `label-triage` wrote labels to in this run, which enters on the next run.
- **The next stage** is `grill-me` for a task carrying `grill-me`, and `proposal` otherwise. Only `grill-me` is supported, so every `AFK` or `HITL` task is reported as waiting for an unsupported stage until DOT-110 lands.
- **An LLM compares the candidates by value** when there are two or more:
    - It runs as `claude -p` with a JSON schema and no tools.
    - It sees each candidate's title, description, labels, status, tracker priority, and the tasks it blocks and is blocked by.
    - It may weigh urgency, impact, effort and unblocking, without a fixed formula.
    - Code accepts its answer only if the chosen task is one of the candidates, and only if a choice from outside the machine scope carries an exception reason.
    - With a single candidate, no LLM is called.
- **Machine scope** comes from `machineType` in `chezmoi data`, either `personal` or `work`. When it is missing or invalid, the step is `not-evaluable`.
- **Outcome of the step:**
    - a selected work unit → `advance` (exit 0);
    - no candidate → `wait` (exit 2), with the exclusion counts;
    - an LLM failure or a rejected answer → `not-evaluable` (exit 3).

    The report shows the task, source, next stage, autonomy, scope, whether it is a machine-scope exception, the explanation, the candidates compared and the exclusions grouped by reason.

- **Label contract:**
    - Add `taken`. It is grey, belongs to no group, has no aliases, and `--bootstrap-labels` creates it. It is the only evidence that a task is taken; tracker statuses do not count.
    - The meaning of `work` drops "has priority over personal work". Preferring a scope is now the job of selection, by machine. Triage keeps asking `work` questions first, as its own question order.
- **BREAKING — configuration:** a new required block, `selection: { model, effort }`, in `autonomous.config.v1`. A configuration file without it is rejected, so the user's dotfiles config must be updated together with the release.
- **Documentation:**
    - The README documents the step, the `taken` rule ("add `taken` to a task you work on by hand") and the new config block.
    - The `run` command description covers the `select` step.
    - `CONTEXT.md` gains the selection terms already agreed in the grill.

**Out of scope:**

- Launching sessions, adding or removing `taken`, and the ADR for removing it. These belong to DOT-109.
- Runner slots and the human slot. These belong to DOT-111.
- Stage labels and the proposal stage. These belong to DOT-110.
- A candidate cap; letting the LLM read the repository or linked documents; dependencies on GitHub; persisted rankings.

## Capabilities

### New Capabilities

- `work-selection`: the `select` step. It covers the candidates and their exclusions, the next stage, the machine scope, the LLM comparison and its validation, the outcomes and the report.

### Modified Capabilities

- `label-contract`:
    - the `taken` label, outside the two groups;
    - its spelling and colour;
    - the meaning of `work`;
    - the `selection` block in the user configuration file.

## Impact

- **Code** (`plugins/autonomous/src/`):
    - `label-contract/contract.ts`: `taken`, its colour and meaning, and the new `work` meaning.
    - `config.ts`: the `selection` block.
    - The tracker readers: blockers, children and priority on `TrackerTask`.
    - A new `select/` module: candidates, next stage, machine scope, comparison and render.
    - `run.ts`: the step list and the chezmoi exec.
    - `label-triage/criteria.md`: the meaning of `work`.
    - Tests for each.
- **Docs**: `plugins/autonomous/README.md`, `commands/run.md`, `CONTEXT.md`, `config.example.json`.
- **Report contract**: `autonomous.run.v1` gains one more step result. No schema change.
- **Behaviour for consumers:**
    - A run that used to advance after triage can now `wait`, exit 2, when nothing is selectable.
    - The run now needs `chezmoi` on the `PATH`.
- **Dependencies**: no new packages. It runs `chezmoi` and `claude` through the existing exec.
- **Release**: a `feat(autonomous)!:` commit, because the configuration change breaks existing config files. The dotfiles PR adding `selection` is merged right after the release.
- **Tracking**: Linear DOT-108, sub-issue of DOT-82; it blocks DOT-111. DOT-109 now owns setting and removing `taken`, and DOT-111 owns the slot example that moved out of DOT-108.
