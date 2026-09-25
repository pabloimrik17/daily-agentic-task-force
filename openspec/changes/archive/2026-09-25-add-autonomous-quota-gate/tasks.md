## 1. Plugin scaffold

- [x] 1.1 Create `plugins/autonomous/` with `.claude-plugin/plugin.json` and `package.json` (`@daily-agentic-task-force/plugin-autonomous`, private, `type: module`, version `0.0.0`), `README.md` and an empty `CHANGELOG.md`; verify with `bun install` succeeding
- [x] 1.2 Add the `autonomous` entry (version `0.0.0`) to `.claude-plugin/marketplace.json`; verify `bun run lint:marketplace` passes
- [x] 1.3 Add the `plugins/autonomous` package to `release-please-config.json` (mirroring `datf-lab`'s extra-files with the `autonomous` jsonpath) and `.release-please-manifest.json` at `0.0.0`; verify the three versions agree via `bun run lint:marketplace`

## 2. Runner (provisional contract)

- [x] 2.1 Implement the step contract and runner (ordered steps, stop at first non-advance, run outcome) in `src/runner.ts`; verify with unit tests for the all-advance and stop-early cases
- [x] 2.2 Implement argument parsing (`--account <key>`, `--force`, `--json`, unknown flags → usage error); verify with unit tests
- [x] 2.3 Implement the run report (`autonomous.run.v1` JSON, text rendering from per-step renderers) and exit codes 0/2/3/1; verify with unit tests on a fake step

## 3. Quota gate

- [x] 3.1 Implement the OpenUsage reader (spawns `openusage claude [--force]`, injectable) and the hand-written `openusage.limits.v1` parser; verify with tests for valid output, CLI failure, invalid JSON, a wrong schema id and a missing field
- [x] 3.2 Implement account selection; verify with tests for single account, ambiguous (candidates listed), explicit key and unknown key
- [x] 3.3 Implement the projection per `Pace.evaluate`; verify with tests for 20%@2h/5h → 50%, 30%@3d/7d → 70%, no consumption, too early, expired window and a non-positive limit or window
- [x] 3.4 Implement the decision (exhausted → wait; stale, error or missing → not-evaluable; else advance) and list other resources as not evaluated; verify with tests for exhausted, at capacity, above-capacity projection → advance, stale, provider error, exhausted-beats-missing and extra `fable` resource
- [x] 3.5 Implement the quota-gate text renderer (windows, used/limit, projection or reason, reset, outcome, reasons); verify with a snapshot or string test

## 4. Command and docs

- [x] 4.1 Add `commands/run.md`: runs `bun "${CLAUDE_PLUGIN_ROOT}/src/run.ts" $ARGUMENTS`, relays output verbatim, and states that without a `handoff` the agent takes no further action
- [x] 4.2 Document in the plugin README the purpose, requirements (`bun`, `openusage`), usage and exit codes, the code → Jev → LLM tiering principle, and that contracts are provisional

## 5. Verification

- [x] 5.1 Run `bun run lint:oxfmt`, `lint:eslint`, `lint:markdown`, `lint:knip`, `lint:fallow`, `lint:marketplace`, `lint:types` and `bun run test`; all pass
- [x] 5.2 Run the entry script against the real `openusage` without `--account` (expect not-evaluable, both accounts listed, exit 3), then with each account key (expect a real outcome with both windows and projections), checking the numbers by hand
- [x] 5.3 Run `openspec validate add-autonomous-quota-gate --strict`; it passes
