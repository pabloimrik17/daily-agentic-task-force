# autonomous

Entry point of the autonomous loop: an orchestrator that will discover
previously defined work and delegate it to other agents. Before it may start
anything it runs a fixed list of gate steps. Today that list holds one step,
`quota-gate`, which decides whether the Claude account has quota to spend.

**The contracts are provisional.** The step contract, the run report and the
runner shape are a first iteration and are expected to change as further steps
are added. The JSON report is versioned (`autonomous.run.v1`) so consumers can
detect a change.

## Install

```bash
/plugin marketplace add pabloimrik17/daily-agentic-task-force
/plugin install autonomous@daily-agentic-task-force
```

## Requirements

- [`bun`](https://bun.sh) on `PATH`. The step runner is TypeScript executed
  from source; plugins install without dependencies, so it uses nothing but
  `bun` and Node built-ins.
- The [`openusage`](https://github.com/robinebers/openusage) CLI on `PATH`,
  verified against 0.7.12. Its `openusage.limits.v1` output is validated
  strictly; a change in that contract makes the gate `not-evaluable`, never a
  silent pass.

## Usage

```text
/autonomous:run [--account <provider-key>] [--force] [--json]
```

| Flag                       | Effect                                                                        |
| -------------------------- | ----------------------------------------------------------------------------- |
| `--account <provider-key>` | Claude account to evaluate (`claude` or `claude@<id>`). Required with several |
| `--force`                  | Ask OpenUsage to bypass its shared cache                                      |
| `--json`                   | Print one `autonomous.run.v1` JSON document instead of the text report        |

The script can also be run directly, which is what a shell or `/loop` should
branch on:

```bash
bun plugins/autonomous/src/run.ts --account claude --json
```

### Exit codes

| Code | Outcome                                                        |
| ---- | -------------------------------------------------------------- |
| 0    | `advance` — every step advanced                                |
| 2    | `wait` — a step says to wait (for example, a window exhausted) |
| 3    | `not-evaluable` — required data is missing, stale or failed    |
| 1    | Invalid arguments or a failure of the runner itself            |

## The quota gate

For the selected account the gate reads OpenUsage and evaluates the `session`
and `weekly` windows: used amount, limit, window length, reset time, and the
usage projected to the end of the window as OpenUsage's `Pace.evaluate`
computes it. Other resources, such as `fable`, are listed but not evaluated.

The decision, in order of precedence:

1. **wait** when either window, with fresh, complete and valid data, has
   `used ≥ limit`;
2. **not-evaluable** when the account is stale, OpenUsage reports an error for
   it, or a window is missing, incomplete or invalid;
3. **advance** otherwise.

Projection is reported but never blocks. Missing or stale data is never read as
available capacity.

## Tiering: code → Jev → LLM

Every part of every step is placed in the earliest tier that can do it
reliably:

1. **Code** — anything fully deterministic.
2. **Jev** (TypeSafe AI) — narrow, typed judgements that fit a
   schema-constrained answer: a choice, a classification, an evaluation.
   Control flow stays in code.
3. **LLM** — open-ended reasoning or text.

This buys determinism, reliability and a lower token cost. In this iteration
every part of the quota gate, and the report rendering, is code; the command's
only LLM work is relaying the output.

## Versioning

Versions are driven by release-please from conventional commits scoped to this
plugin (`feat(autonomous): …`). A release bumps the version in
`.claude-plugin/plugin.json`, `package.json`, and this plugin's entry in the
root `.claude-plugin/marketplace.json`. Tags read `autonomous--v0.1.0`.
