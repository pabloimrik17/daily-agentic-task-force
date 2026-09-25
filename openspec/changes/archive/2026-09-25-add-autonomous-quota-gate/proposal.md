## Why

The long-term goal (Linear DOT-82) is an orchestrator that discovers previously defined work and delegates it to other agents. Before it may start anything, it must know whether the Claude account has quota to spend. That is the first small, independently verifiable step (Linear DOT-91), and it is also the right moment to give the loop a home of its own instead of growing it inside the `datf-lab` staging plugin.

This is the first iteration of a process expected to change a lot. The shapes introduced here — the step contract and the run report — are deliberately provisional.

## What Changes

- Add a new plugin, `autonomous`, with the full scaffold: `plugin.json`, `package.json`, README, CHANGELOG, a marketplace entry and a release-please package, starting at `0.0.0` so the first `feat(autonomous)` releases `0.1.0`.
- Add a single entry command, `/autonomous:run`. It executes an ordered list of steps and stops at the first step that does not advance. Today the list holds one step: `quota-gate`.
- Add the `quota-gate` step, implemented entirely in code:
  - reads `openusage claude` (shared cache by default, optional `--force`) and validates the `openusage.limits.v1` JSON before using any value;
  - selects one Claude account unambiguously (`--account <provider-key>`; required when more than one Claude account is present);
  - reports the `session` and `weekly` windows: current usage, reset time and projected usage, reproducing OpenUsage's `Pace.evaluate` including its unavailable-result conditions; lists other resources (for example `fable`) as not evaluated;
  - decides, in order: **wait** when either window is exhausted according to complete, valid, fresh data and its reset is still ahead; **not evaluable** when the account is stale or errored, a window is missing, incomplete or invalid, or an exhausted window's reset time has already passed; **advance** otherwise. Projection is reported but does not block.
- Output a run report as versioned JSON (`--json`) or pre-rendered text (default), with an exit code per outcome. The command markdown only runs the script and relays its output.
- Document the per-step tiering principle — **code → Jev → LLM** — in the design and the plugin README.

**Out of scope for this iteration**: work/personal classification and policy, the observation that work and personal use separate accounts, account selection via `claude-swap` or machine role, task lookup or discovery, agent launch, persistent state, scheduling, the Jev SDK, and any definition of the reserved `handoff` field.

## Capabilities

### New Capabilities

- `autonomous-run`: the `/autonomous:run` entry point — ordered step execution, stop-on-first-non-advance, the run report (JSON and text) and its exit codes. Provisional.
- `quota-gate`: reading Claude quota from OpenUsage, account selection, projection, and the advance/wait/not-evaluable decision.

### Modified Capabilities

None. Adding a plugin follows the existing marketplace contract without changing it.

## Impact

- **New**: `plugins/autonomous/` (manifest, package, command, TypeScript sources and Vitest tests).
- **Modified**: `.claude-plugin/marketplace.json`, `release-please-config.json`, `.release-please-manifest.json`, `bun.lock`, `knip.config.ts` (ignores the `openusage` binary, which the plugin invokes at runtime but is not a package dependency).
- **No new runtime dependencies**: plugins are installed without a dependency install step, so the script must run from source with nothing but `bun`. The `openusage` JSON is validated by a small hand-written parser (see design.md).
- **Runtime requirements on the consumer machine**: `bun` and the `openusage` CLI (verified against 0.7.12).
- **Tracking**: Linear DOT-91 (child of DOT-82).
