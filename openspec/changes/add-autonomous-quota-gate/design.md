> **Provisional.** This is the first iteration of the autonomous loop (DOT-82). The step contract, the run report and the runner shape below are a starting point, expected to change substantially as later steps are added. Prefer changing them over working around them.

## Context

See proposal.md for motivation. Constraints that shape the approach:

- **Plugins install without dependencies.** Claude Code copies the plugin directory; no `bun install` runs on the consumer machine. Anything imported at runtime must ship in the plugin.
- **OpenUsage 0.7.12** (`openusage [provider] [--force]`) prints `openusage.limits.v1` JSON: `providers` keyed by `claude` / `claude@<id>`, each with `displayName`, `plan`, `fetchedAt`, `expiresAt`, `stale` and `resources` (`session`, `weekly`, sometimes `fable`), each resource holding `used`, `limit`, `resetsAt`, `windowSeconds`, `unit`; plus a top-level `errors` array. The machine used for refinement has two Claude accounts (personal and work).
- **Projection reference**: `Pace.evaluate` in OpenUsage, identical in v0.7.11 and v0.7.12 (<https://github.com/robinebers/openusage/blob/v0.7.12/Sources/OpenUsage/Support/Pace.swift>). Only `projectedUsage` and its nil conditions are reproduced; the ahead/on-track/behind colouring is UI-only.
- Repository rules: new plugin code is `.ts`; Vitest discovers each `plugins/*` workspace; knip already declares `plugins/*` entries.

## Goals / Non-Goals

**Goals:**

- A runner whose shape can take more steps without rewriting the entry point.
- Every part of the quota gate in deterministic, tested code.
- Output that a person can verify by hand and a script or `/loop` can branch on.

**Non-Goals:**

- A generic plugin/adapter framework for steps or quota providers.
- Defining `handoff`, persistent run state, or concurrency between runs.

## Decisions

### D1 — Tier every part of every step: code → Jev → LLM

Each part of a step is placed in the earliest tier that can do it reliably:

1. **Code**: anything fully deterministic.
2. **Jev** (TypeSafe AI, `@typesafe-ai/sdk`): narrow, typed judgements that are hard to code but fit a schema-constrained answer (a choice, a classification, an evaluation). Control flow stays in code.
3. **LLM**: open-ended reasoning or text.

This buys determinism, reliability and lower token cost. For this iteration everything is tier 1:

| Step         | Part                                    | Tier |
| ------------ | --------------------------------------- | ---- |
| `quota-gate` | read and validate OpenUsage output      | code |
| `quota-gate` | account selection                       | code |
| `quota-gate` | projection                              | code |
| `quota-gate` | decision                                | code |
| run          | report rendering (JSON and text)        | code |
| command      | relay output; act on `handoff` (future) | LLM  |

Likely first Jev candidates, in later iterations: work/personal classification when labels are missing or conflicting, and task readiness. The Jev SDK is not added until a step uses it.

### D2 — Step contract (provisional)

A step is a function from a shared context (parsed arguments, `now`, injected I/O) to a `StepResult`:

```ts
type StepOutcome = "advance" | "wait" | "not-evaluable";
interface StepResult<D> {
    step: string;
    tier: "code" | "jev" | "llm";
    outcome: StepOutcome;
    reasons: string[];
    data: D;
}
```

The runner holds an ordered array of steps and stops at the first non-`advance`. I/O (running `openusage`, the clock) is injected so every step is testable with synthetic input. **Alternative rejected**: a registry or plugin mechanism for steps — speculative with one step.

### D3 — Run report and exit codes

`RunReport { schema: "autonomous.run.v1"; startedAt; steps; outcome; handoff? }`. The quota JSON is the `data` of the `quota-gate` step, not a separate schema. Each step exposes a text renderer, and the text report concatenates them. Exit codes: 0 advance, 2 wait, 3 not-evaluable, 1 usage or runner failure — so a shell or `/loop` can branch without parsing. `handoff` is typed as `unknown` and never emitted.

### D4 — Zero runtime dependencies; hand-written validation

The command runs `bun "${CLAUDE_PLUGIN_ROOT}/src/run.ts" $ARGUMENTS`. Validation of the OpenUsage JSON is a small parser returning a discriminated result: a missing or mistyped field is an error with a path, never a default. **Alternatives rejected**: Zod or Valibot, which would need either a committed bundle or a dependency install on the consumer machine that plugins do not get; relying on Bun auto-install, which is implicit and network-dependent. Revisit with a bundling step once the plugin genuinely needs a library (for example the Jev SDK).

### D5 — Account selection and freshness

A Claude account is any provider key equal to `claude` or starting with `claude@`. `--account` picks one by key; with none, a single account is used and several are `not-evaluable` with the candidates listed. Freshness comes from OpenUsage itself: `stale: true` or an entry in `errors` that names the provider → not evaluable. The gate does not apply its own age threshold, because OpenUsage already owns the cache policy. Using `claude-swap status` or the machine role from dotfiles to choose a default is deferred until explicit keys become a burden.

### D6 — Decision order

The precedence is: exhausted → `wait`; then missing, stale or error → `not-evaluable`; then `advance`. Exhaustion needs valid, fresh data for that window. Projection is informational in this iteration. Tightening the gate on projection later is a local change to the decision function.

### D7 — Plugin layout

```text
plugins/autonomous/
  .claude-plugin/plugin.json
  package.json            # @daily-agentic-task-force/plugin-autonomous, private, 0.0.0
  README.md               # purpose, requirements, tiering principle
  CHANGELOG.md            # owned by release-please
  commands/run.md         # thin: run script, relay output
  src/run.ts              # entry: args, runner, render, exit code
  src/runner.ts           # step contract and runner
  src/quota-gate/…        # openusage read, parse, select, project, decide, render
  src/**/*.test.ts
```

## Risks / Trade-offs

- [OpenUsage changes its JSON] → strict parsing turns this into an explicit `not-evaluable`, never a silent pass; the schema id is checked.
- [`bun` or `openusage` missing on a machine] → reported as `not-evaluable` or a clear runner error; both are documented as requirements in the README.
- [Two accounts make `--account` mandatory in practice] → accepted for this iteration; `claude-swap` is the planned relief.
- [Provisional contracts churn] → accepted deliberately; the JSON is versioned so consumers can detect a change.

## Migration Plan

Additive. A new plugin plus marketplace and release-please entries at `0.0.0`; release-please publishes `0.1.0` from the first `feat(autonomous)` commit. Rollback is removing the plugin and its entries.
