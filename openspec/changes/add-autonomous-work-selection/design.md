## Context

See proposal.md for the motivation. The decisions were settled with the user in a grill on 2026-10-06 and recorded in Linear DOT-108. The glossary lives in `plugins/autonomous/CONTEXT.md`, which now defines _machine scope_, _taken task_, _taken label_ and _candidate_.

These facts shape the approach:

- **The runner** (`src/runner.ts`):
    - `runSteps` runs `STEPS = [quotaGateStep, labelTriageStep]` and stops at the first step that does not advance.
    - A step receives only `RunContext` (`args`, `now`, `config`, `io`), so it cannot see the results of earlier steps.
- **The tracker readers** (`src/label-triage/trackers/`):
    - They return `TrackerTask { source, id, title, description, labels, status, updatedAt }`.
    - The `Tracker` interface is shared by triage, the bootstrap and answer mode.
    - The Linear listing has no description; `issue view` has one.
- **What the CLIs provide** (verified on 2026-10-06):
    - `bd list --json`: `dependencies` (`blocks`, `parent-child`), `parent` and `priority`.
    - `bd blocked --json`: the blocked issues with `blocked_by`, by Beads' own rules.
    - `linear issue query --json`: `inverseRelations.nodes[]`, each with `type` and the related issue's `identifier` and `state.type`, plus `priority`.
    - `linear issue view --json`: `children` and `description`.
    - `gh issue list`: no dependencies, children or priority.
- **`machineType`**: `chezmoi data --format json` returns an object with `machineType` (`personal` on this machine).
- **The `claude -p` invocation** in `label-triage/judgement.ts` already solves running with no tools, the strict envelope and the schema output. The fallow duplicate gate rejects a copy of it.

## Goals / Non-Goals

**Goals:**

- Code decides everything that can be checked. The LLM only compares candidates code has already permitted, and code validates what it returns.
- The `Tracker` interface used by triage, the bootstrap and answer mode does not change, so this change cannot alter their behaviour.
- When DOT-110 lands, it replaces the derivation of the next stage in one place and leaves the rest alone.

**Non-Goals:**

- Writing to trackers, including `taken`.
- Slots, sessions or the launch of anything.
- Reading repositories or linked documents for the comparison.

## Decisions

### D1 — Steps see earlier results

`RunContext` gains `results: readonly StepResult[]`, the results of the steps that already ran, in order. `runSteps` passes a fresh copy to each step. `select` reads the `label-triage` result from it and takes the tasks whose records have status `applied` as _labelled this run_. Without `--apply`, there are none.

**Alternatives rejected:**

- Reusing the listing that triage read before writing. It couples `select` to triage's data, and that listing lacks blockers, children and priority.
- Module-level state shared between the steps. It is invisible in the contract and hard to test.

### D2 — Readers for selection beside the triage trackers

A `WorkReader` per source lives in `src/select/readers/`. It reuses the trackers' CLI helpers (`cli-json.ts`, label parsing, error mapping) but not the `Tracker` interface:

```ts
interface WorkTask extends TrackerTask {
    priority: string | null; // tracker's own label, null when it has none (GitHub)
    blocks: string[]; // ids this task blocks while open
    blockedBy: string[] | null; // open blockers; null: not evaluated (GitHub)
    children: string[] | null; // open children; null: not evaluated (GitHub) or not read yet (Linear)
}
interface WorkReader {
    source: Source;
    list(): Promise<TrackerResult<WorkTask[]>>; // open tasks, as triage defines them
    detail(task: WorkTask): Promise<TrackerResult<WorkTask>>; // description and children when the listing lacks them
}
```

How each source fills it in:

- **Beads**:
    - `list` runs `bd list --json --limit 0 --status open,in_progress,blocked,deferred` and `bd blocked --json`.
    - The tasks are the `open` and `in_progress` entries.
    - `children` are the non-closed entries whose `parent` is the task.
    - `blockedBy` is `blocked_by` from `bd blocked`, and `blocks` is its inverse.
    - `detail` returns the task unchanged.
- **Linear**:
    - `list` runs the same `issue query` as triage and adds `priority`.
    - `blockedBy` comes from the `blocks` inverse relations whose state type is neither `completed` nor `canceled`, and `blocks` is the inverse across the listing.
    - `children` stays `null` until `detail`, which runs `issue view` and fills the description and the non-closed children.
- **GitHub**:
    - `list` runs the same `gh issue list` as triage.
    - It sets `priority`, `blockedBy` and `children` to `null` and `blocks` to `[]`.

`io` gains a `work: (config) => WorkReader[]` factory, the same shape as `trackers`.

**Alternative rejected:** extending `Tracker` and `TrackerTask`. Every triage fake would change, and a failure of `bd blocked` would make triage not evaluable for data it never uses.

### D3 — Exclusions are an ordered list of checks, cheapest first

```ts
type Exclusion =
    "classification" | "taken" | "labelled-this-run" | "unsupported-stage" | "blocked" | "split";
```

`select/candidates.ts` applies the checks in the spec's order and records the first one that applies:

- **classification**: `detect()` reports both groups as `present`.
- **taken**: the task's labels include `taken`.
- **labelled this run**: from D1.
- **unsupported stage**: `nextStage()` (D4) is not in `SUPPORTED_STAGES`.
- **blocked**: `blockedBy` is non-empty.
- **split**: `detail()` runs only for the tasks that survive every check above, then the check reads `children`.

This order keeps Linear's `issue view` calls to the few `grill-me` tasks that are still candidates. Those tasks need `detail()` anyway, for the description the LLM reads.

### D4 — Next stage in one function

```ts
const SUPPORTED_STAGES = ["grill-me"] as const;
function nextStage(labels: readonly string[]): "grill-me" | "proposal" {
    return labels.includes("grill-me") ? "grill-me" : "proposal";
}
```

When DOT-110 adds stage labels, it replaces this function's body with a read of the stage label and extends `SUPPORTED_STAGES` when the proposal stage runs. Nothing else depends on how the stage is derived.

### D5 — Machine scope from chezmoi

`run.ts` builds a `chezmoi` exec with the CLI timeout of 120 s and puts it in `io`. `select/machine-scope.ts` runs `data --format json` and parses the output strictly: a root object with a string `machineType` equal to `personal` or `work`. Every failure becomes `not-evaluable`, with a reason that starts `chezmoi data:`. The scope is read before the trackers, so a misconfigured machine fails fast and calls no tracker.

### D6 — The comparison reuses the print-mode invocation

The `claude -p` call is extracted from `label-triage/judgement.ts` into `src/claude-print.ts`. It keeps the same flags (safe mode, no tools, strict MCP, no session persistence), the envelope check and `structured_output`. Two callers use it: `claudeJudgement`, whose behaviour does not change, and `claudeSelection`.

Selection schema:

```json
{
    "source": "beads|github|linear",
    "id": "string",
    "explanation": "string",
    "exception": "string|null"
}
```

The prompt carries:

- the criteria: urgency, impact, effort, unblocking, a strong preference for the machine scope with justified exceptions, and no fixed formula;
- the statement that the task fields are untrusted data;
- the machine scope;
- the candidates as JSON, each with source, id, title, description, labels, status, priority, scope, autonomy, next stage, `blocks` and `blockedBy`.

`select/validate.ts` then checks the answer:

1. The pair `(source, id)` must be one of the candidates.
2. The explanation must be non-empty after trimming.
3. A candidate whose scope differs from the machine scope needs a non-empty `exception`.
4. An `exception` on a candidate within the machine scope is dropped.

A single candidate skips the call (tier `code`). The timeout is 300 s, `JUDGEMENT_TIMEOUT_MS`, moved into `claude-print.ts` as `PRINT_TIMEOUT_MS`.

**Alternative rejected:** Jev. The comparison weighs open-ended context, not a classification into fixed labels (grill Q2).

### D7 — Configuration

- `AutonomousConfig` gains a required `selection: { model: string; effort: string }`, parsed with `rejectUnknownKeys` like `judgement`.
- `config.example.json` gains `"selection": { "model": "sonnet", "effort": "high" }`.
- The schema id stays `autonomous.config.v1`, because there is one user and one coordinated migration (see Migration Plan).

### D8 — `taken` in the contract

- `ContractLabel` gains `taken`, and `LABELS`, `COLOURS` (`#95a2b3`) and `MEANINGS` gain it too. So the bootstrap creates it, and `isContractLabel` accepts it.
- `GROUPS` is unchanged, so `detect`, triage, its questions and the label-at-creation helper never treat it as missing.
- The alias parser in `config.ts` rejects the key `taken` with its path.
- `MEANINGS.work` and `label-triage/criteria.md` become "Nazaries work." The triage question order (`work` first) stays as it is.

### D9 — Step data and rendering

```ts
interface SelectData {
    machineScope: Scope | null;
    selected: {
        source;
        id;
        title;
        stage;
        autonomy;
        scope;
        explanation;
        exception: string | null;
    } | null;
    candidates: { source; id; title; scope; stage }[];
    excluded: { source; id; title; reason: Exclusion }[];
    notEvaluated: string[]; // e.g. "github: dependencies and children"
    comparison: { model; effort } | null;
}
```

`render` prints sections in the spec's order, with the exclusions grouped by reason and a count per group. When the outcome is `wait`, the reasons are those counts.

### D10 — Tiering

| Part                                                             | Tier |
| ---------------------------------------------------------------- | ---- |
| machine scope, reading, exclusions, next stage, single candidate | code |
| comparing two or more candidates                                 | llm  |
| validating the choice, exception rule, outcome, rendering        | code |

## Risks / Trade-offs

- **[A forgotten `taken` blocks a task forever.]** → The report lists every task excluded as taken. The README says to remove the label by hand. DOT-109 owns adding and removing it.
- **[Work done by hand without `taken` can be selected again.]** → This trade-off was accepted in the grill, because statuses change without the loop. The README states the rule.
- **[Breaking configuration.]** → A config without `selection` is rejected and names the path. The migration order is below. Until the user updates, only manual runs are affected.
- **[LLM cost on every run with two or more candidates.]** → There are few candidates while only `grill-me` is supported. The model and effort can be changed in the config without a release. The cap is revisited when the proposal stage is supported.
- **[Linear `issue view` per surviving task.]** → D3's order limits these calls to candidates that are still `grill-me`.
- **[`bd blocked` may report blockers differently from the dependency list.]** → Beads' own rule is accepted as the source of truth, and a test pins the parsing to recorded `bd` output.
- **[`chezmoi` missing on the `PATH` where `/autonomous:run` is started.]** → The run is not evaluable, with a reason that names `chezmoi data`.

## Migration Plan

1. Merge this change. Release-please opens a major release of `autonomous` (`feat(autonomous)!:`).
2. Prepare the dotfiles PR that adds `"selection": { "model": "sonnet", "effort": "high" }` to the encrypted config. Keep it unmerged.
3. Merge the release PR, then the dotfiles PR.
4. On each machine, run `chezmoi apply` and update the plugin, then do one manual `/autonomous:run` to check the report.

Rollback: reinstall the previous plugin version and revert the dotfiles PR. A config with `selection` is rejected by the old plugin, so both must be rolled back together.
