## Why

The user's swing-trading bookkeeping runs as two Claude Cowork tasks, always back to back: one reconciles the mirrors against IBKR, the other cleans the Simply Wall St watchlist. Over 23 runs each, they failed in the same ways:

- Claude read IBKR from screenshots, sometimes incompletely.
- It reused stale data despite the user's rule "nunca mires los datos de antes".
- Scraping noise reached the report.
- A planned removal came from memory instead of the live watchlist.
- A fuzzy search added the wrong listing.
- A keeper was removed to sniff an API.

Every decision in those tasks is deterministic: recomputing the 23 watchlist runs reproduces Claude's targets exactly. Official read paths now exist for the two inputs that were pasted or photographed: IBKR's MCP server for positions and orders, and `gws` for the tracking sheet. The procedure can therefore move into a plugin in which code makes every decision and the LLM only drives the browser and calls MCP tools.

## What Changes

- Add a new plugin, `stonks`, with the full scaffold:
    - `plugin.json`, `package.json` (`@daily-agentic-task-force/plugin-stonks`, private) and `CHANGELOG.md`;
    - `README.md` and `config.example.json`;
    - a marketplace entry and a release-please package, both at `0.0.0`, so the first `feat(stonks)` commit releases `0.1.0`.
- Add one command, `/stonks:sync`. Only the user can invoke it (`disable-model-invocation: true`). It runs two phases:
    - **Phase 1 (sources): report only.** It reads every input live (IBKR, the tracking sheet, the SWS portfolio and the Cartera Viva) and reports Discrepancies, warnings and the top-priority Unprotected position alert. It never writes to any of them.
    - **Gate.** When a finding affects the watchlist's composition, the command pauses exactly once after phase 1. The pause shows the whole report, every finding and not only the ones that tripped the gate, so the user can fix everything in one go. On "sigue" it re-reads the tracking sheet live, recomputes, prints what remains and continues to phase 2 without pausing again.
    - **Phase 2 (watchlist).** It makes the private SWS watchlist equal the Watchlist candidate set, without asking, under guardrails: read the real list first, remove before adding, add only an exact `EXCHANGE:TICKER`, verify every change, and never remove a keeper.
    - `--only sources` runs phase 1 alone; `--only watchlist` runs phase 2 alone.
- Add a bun/TypeScript engine that does everything deterministic:
    - strict configuration loading;
    - input schemas and normalisation;
    - tracking-sheet parsing, where an unknown Estado or a row without a ticker stops the run;
    - every check, the gate decision, the watchlist plan and its verification;
    - the report data and its markdown rendering.

  It is tested with Vitest on fictional fixtures. It has no runtime dependencies.
- Add a capture mechanism so that the LLM never transcribes data. A plugin `PostToolUse` hook writes the raw IBKR MCP responses and browser collector outputs into a local run directory, and the engine validates them there. The only exception is the IBKR screenshot fallback. When the MCP fails or needs login, the command first offers re-authentication through `/mcp`; only if that fails or is declined does Claude transcribe a table from screenshots, and the engine uses it only after the user confirms the engine's own rendering of it.
- Pre-approve only what the command needs. Its frontmatter `allowed-tools` lists exactly `mcp__ibkr__get_account_positions`, `mcp__ibkr__get_orders` and `Bash(bun:*)` for the engine. No global allow rule is added anywhere, and the dotfiles side only denies `mcp__ibkr__get_order_instructions`.
- Warn about unknown IBKR tools. The engine holds the set of known `ibkr` tools, and each run reports a WARNING, never blocking, if the session exposes any other `mcp__ibkr__*` tool, so that a new order-capable tool is noticed.
- Add a Claude Code **mod pane** that renders the report:
    - alerts first;
    - a collapsible section per mirror;
    - tickers linked to their SWS pages;
    - Movimientos and repeat counters;
    - an in-run checklist.

  The pane keeps the previous-run snapshot in the mod's own store, for deltas only. A markdown summary is always printed as well. The first implementation task is a spike; if the pane cannot open from `/stonks:sync` and render in the user's tmux terminal, v1 ships markdown-only.
- Add a strict user configuration at `~/.config/stonks/config.json` (`schema: "stonks.config.v1"`). It holds every personal value: the sheet, the URLs, the watchlist name and the Excluded tickers. No personal value appears in this repository.

**Out of scope**:

- Writing to IBKR, the tracking sheet, the SWS portfolio or the Cartera Viva.
- Simply Wall St Broker Sync, and a public watchlist.
- A bun script acting as its own IBKR MCP client, and Flex queries.
- An Artifact or a local HTML report.
- Browsable run history.
- Adjusting trailing stops.
- Scheduling.
- The dotfiles side: the encrypted configuration, installing `gws` and registering the `ibkr` MCP server, which are tracked as separate changes.

## Capabilities

### New Capabilities

- `stonks-sync`: the `/stonks:sync` command. It covers user-only invocation, the `--only` modes, phase order, the report-only guarantee of phase 1, the gate, its single full-report pause and the "sigue" re-read, the pre-approved tools, the stop conditions, the strict configuration file and the thin-command split between engine and LLM.
- `stonks-inputs`: reading each input live and capturing it without transcription. It covers the IBKR MCP, `/mcp` re-authentication, the confirmed screenshot fallback and the unknown-tool warning, the tracking sheet through the `gws` adapter and its parsing rules, the browser collectors and login walls, schema validation and the run directory.
- `stonks-reconciliation`: checks A (SWS portfolio ↔ IBKR), B (tracking sheet ↔ IBKR, including the Unprotected position alert) and C1–C9 (tracking sheet ↔ Cartera Viva). It also covers Excluded tickers, the severity of each finding and which findings affect the watchlist.
- `stonks-watchlist`: the Watchlist candidate rule, and the phase-2 plan, execution and verification. It covers exact-listing resolution and the guardrails.
- `stonks-report`: the report's content and order, the mod pane and its fallback, the always-printed markdown, Movimientos, repeat counters, the in-run checklist and the previous-run snapshot.

### Modified Capabilities

None. `plugin-marketplace` does not enumerate plugins; adding `stonks` follows its contract (manifest entry, three version anchors, release-please package) unchanged.

## Impact

- **New**:
    - `plugins/stonks/`: manifest, package, README, CHANGELOG, `config.example.json`, `commands/sync.md`, `hooks/hooks.json`, engine sources and Vitest tests, fictional fixtures, and the mod module with its tests. `plugins/stonks/CONTEXT.md` already exists.
- **Modified**:
    - `.claude-plugin/marketplace.json`, `release-please-config.json` and `.release-please-manifest.json`;
    - the root `README.md` plugin table;
    - `bun.lock` (new workspace);
    - `knip.config.ts` (`gws` in `ignoreBinaries`, plus the mod entry) and `.fallowrc.jsonc` (the mod entry);
    - `.oxfmtignore`, `eslint.config.ts` and `.gitignore` for the vendored mod types and the engine-written `.claude-plugin/types/`;
    - possibly the Claude Code version pinned in CI's schema validation (see design).
- **Consumer requirements**:
    - `bun`;
    - `gws` (`googleworkspace-cli`) on `PATH`, authorised with `spreadsheets.readonly`;
    - the IBKR MCP server registered at user scope as `ibkr`;
    - Claude in Chrome;
    - the configuration file;
    - Claude Code at or above the version the spike pins, which is at least 2.1.287 if the pane ships.
- **Cross-repo dependency**: the dotfiles changes `add-plugin-configs` (the encrypted `~/.config/stonks/config.json`) and `add-stonks-tooling` (`gws` in `BREW_PACKAGES`, `claude mcp add --scope user ibkr …`, and a deny on `mcp__ibkr__get_order_instructions`). The contract between them is the server name `ibkr`, the configuration path and schema id, and `gws` on `PATH`. **This PR merges after both.**
- **Data handling**: personal financial data lives only in the encrypted configuration, the local state directory and the user's own services. Fixtures and examples are fictional.
