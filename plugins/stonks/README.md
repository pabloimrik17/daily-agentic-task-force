# stonks

Swing-trading bookkeeping. The routine used to run as two Claude Cowork tasks,
always back to back: one reconciles the mirrors against IBKR, the other cleans
the Simply Wall St watchlist. Over 23 runs each they failed in the same ways:
IBKR read from screenshots, stale data reused, scraping noise in the report, a
removal taken from memory instead of the live watchlist, a fuzzy search adding
the wrong listing.

Every decision in those tasks is deterministic, and official read paths now
exist for the inputs that were pasted or photographed: IBKR's MCP server for
positions and orders, and `gws` for the tracking sheet. This plugin moves the
procedure into code: the engine makes every decision, and the LLM only drives
the browser and calls MCP tools. The domain terms (mirror, tracking sheet,
Estado, Watchlist candidate, keeper) are defined in [`CONTEXT.md`](CONTEXT.md).

## Install

```bash
/plugin marketplace add pabloimrik17/daily-agentic-task-force
/plugin install stonks@daily-agentic-task-force
```

## Usage

```text
/stonks:sync [--only sources|watchlist]
```

Only the user can invoke it. Phase 1 reads every input live, reports
discrepancies, warnings and the Unprotected position alert, and writes to none
of them. When a finding affects the watchlist's composition the command pauses
once, showing the whole report, and continues on "sigue". Phase 2 makes the
private Simply Wall St watchlist equal the candidate set under guardrails.
`--only sources` runs phase 1 alone; `--only watchlist` runs phase 2 alone.

## Requirements

- [`bun`](https://bun.sh) on `PATH`, at the version in the repository's `.bun-version`.
- `gws` (`googleworkspace-cli`) on `PATH`, tested with 0.22.5. It reads the tracking sheet and must be authorised with exactly the `https://www.googleapis.com/auth/spreadsheets.readonly` scope. Setup: your own GCP project, a Desktop OAuth client, the consent screen in production, then `gws auth login --scopes https://www.googleapis.com/auth/spreadsheets.readonly`.
- The IBKR MCP server registered at user scope as `ibkr` and connected through `/mcp`. The command pre-approves only `mcp__ibkr__get_account_positions` and `mcp__ibkr__get_account_orders`. Every other IBKR tool asks for permission as usual.
- Claude in Chrome, for the browser collectors.
- Claude Code 2.1.289 or later. That is the version the plugin was developed and tested against; the report pane uses the early-access mod API.
- The [configuration file](#configuration).

The plugin installs nothing. The per-user configuration and the tooling install (`gws`, the `ibkr` server registration) are managed outside this repository, in the user's dotfiles.

## Configuration

The personal values live in one JSON file outside the plugin, validated before any input is read.

- Path: `~/.config/stonks/config.json`.
- Override: `STONKS_CONFIG` holds the path of another file.
- Schema id: `stonks.config.v1`.

[`config.example.json`](config.example.json) ships with the plugin:

```json
{
    "schema": "stonks.config.v1",
    "trackingSheet": { "spreadsheetId": "<SPREADSHEET_ID>", "tab": "<TAB_NAME>" },
    "swsPortfolio": { "url": "https://simplywall.st/portfolio/<PORTFOLIO_ID>" },
    "watchlist": { "name": "<WATCHLIST_NAME>", "url": "https://simplywall.st/watchlist" },
    "carteraViva": { "url": "https://<CARTERA_VIVA_PAGE>" },
    "excludedTickers": ["<TICKER>"]
}
```

| Field                         | Meaning                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| `schema`                      | Always `stonks.config.v1`.                                                                 |
| `trackingSheet.spreadsheetId` | The Google spreadsheet `gws` reads.                                                        |
| `trackingSheet.tab`           | The tab of that spreadsheet, addressed by name.                                            |
| `swsPortfolio.url`            | The Simply Wall St portfolio page.                                                         |
| `watchlist.name`              | The name of the watchlist phase 2 manages. The engine refuses a watchlist of another name. |
| `watchlist.url`               | The Simply Wall St watchlist page.                                                         |
| `carteraViva.url`             | The Cartera Viva page.                                                                     |
| `excludedTickers`             | Tickers kept out of the watchlist's candidate set.                                         |

The validation is strict:

- Every field is required.
- Unknown fields are rejected.
- URLs must start with `https://`.
- Strings are non-empty and have no leading or trailing whitespace.
- `excludedTickers` entries follow the same whitespace rule, are upper-case and are unique.

Nothing else is configurable. There is no default for any field.

An invalid file is an error that names the file and the path of the offending field, for example `$.watchlist.url must be an https URL`, prefixed with the file path and the schema id. A missing file is an error that names the expected path and points to the shipped example.

## Data handling

Personal financial data lives only in the configuration file, the local state directory and your own services. The repository holds fictional fixtures and examples only.

The state directory is, in order of precedence:

1. `STONKS_STATE_DIR`;
2. `$XDG_STATE_HOME/stonks`;
3. `~/.local/state/stonks`.

```text
stonks/
  active.json            # { runId, startedAt, mode } while a run is open
  runs/<runId>/          # one run only
    raw/                 # hook captures, verbatim
    ibkr-confirmed.json  # fallback table, after confirmation
    report.json          # stonks.report.v1, read by the pane
    plan.json            # watchlist plan
    previous.json        # snapshot of the previous run, consumed once
  listings.json          # learnt TICKER -> { symbol, name, url }
  snapshot.json          # markdown-only variant only
```

- Directories are created with mode `0700` and files with `0600`, whatever the umask.
- `begin` deletes everything under `runs/` before any input is read. Data from a previous run is gone by construction, not by instruction.
- An active run expires 6 hours after it started. Past that, its captures are ignored.
- A second `begin` replaces the active run. One sync at a time is supported.
- Two things are kept between runs: the previous-run snapshot and the learnt listings. Neither is ever used as input.
- Raw IBKR responses and browser collector results are captured by a plugin `PostToolUse` hook, verbatim. The model never retypes them.
- Nothing captured during a run is published to a hosted service. There are no Artifacts.

## What decides what

Every part is tiered: code first, the LLM last. No part needs a typed judgement, so no Jev step exists.

| Part                                                             | Tier                                                            |
| ---------------------------------------------------------------- | --------------------------------------------------------------- |
| Configuration loading and validation                             | code                                                            |
| Calling the two IBKR reads; driving the browser                  | LLM (tool calls only; it never handles the returned data)       |
| Capturing raw tool results                                       | code (plugin hook)                                              |
| Reading the tracking sheet                                       | code (`gws` adapter)                                            |
| Validating and normalising every input                           | code                                                            |
| Offering `/mcp` re-authentication when IBKR fails                | LLM relays the engine's directive; the user acts                |
| Transcribing IBKR screenshots (fallback only)                    | LLM, gated by the user's confirmation of the engine's rendering |
| Comparing available `mcp__ibkr__*` tool names with the known set | code (the LLM only passes the names)                            |
| Checks, gate, watchlist plan, listing choice, verification       | code                                                            |
| Search term for a ticker whose company name the engine lacks     | LLM (a hint only; the listing is selected by exact match)       |
| Report data, markdown, Movimientos, counters                     | code                                                            |
| Pane                                                             | code (mod)                                                      |
| Relaying output; asking the user (gate, login, screenshots)      | LLM                                                             |

## Checks

Phase 1 compares each mirror with IBKR and the tracking sheet with the
Cartera Viva. Every result is a finding with a severity; the findings marked
"yes" under Gate affect the watchlist's composition and pause the run once
after the report (see the glossary in `CONTEXT.md` for the terms).

| Check | Meaning                                                                                                                                                                                    | Severity                | Gate |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- | ---- |
| A1    | Missing in SWS: a held ticker the SWS portfolio does not list                                                                                                                              | Discrepancy             | no   |
| A2    | Extra in SWS: an SWS portfolio ticker that is not held                                                                                                                                     | Discrepancy             | no   |
| B1    | Entry without position: Invertido or Vender entries on a ticker IBKR does not hold                                                                                                         | Discrepancy             | yes  |
| B2    | Position without entry: a held ticker with no Invertido or Vender entry                                                                                                                    | Discrepancy             | yes  |
| B3    | Quantity mismatch: the sheet's position differs from IBKR's quantity                                                                                                                       | Discrepancy             | no   |
| B4    | Comprar without order: a Comprar entry with no live buy order left to match                                                                                                                | Discrepancy             | yes  |
| B5    | Buy order without entry: a live buy order with no Comprar entry left to match                                                                                                              | Discrepancy             | yes  |
| B6    | Buy order mismatch: a Comprar entry and a live buy order that differ in quantity or limit price                                                                                            | Discrepancy             | no   |
| B7    | Sell orders beyond Vender entries: live sell orders cover more shares than the Vender total                                                                                                | Discrepancy             | yes  |
| B8    | Unprotected position: a held ticker whose live sell orders cover fewer shares than its Vender total                                                                                        | Alert                   | no   |
| C1    | Stale Roger: a Roger entry on a ticker not in the Cartera Viva                                                                                                                             | Discrepancy             | yes  |
| C2    | Should be Roger: a Cartera Viva ticker not held, with no Roger, Comprar, Invertido or Vender entry                                                                                         | Discrepancy             | yes  |
| C3    | Sold while the Trader is still in: a Cartera Viva ticker not held that still has Invertido or Vender entries                                                                               | Discrepancy             | yes  |
| C4    | Pending buy with the Trader in: a Cartera Viva ticker with a Comprar entry and a live buy order                                                                                            | Informational           | no   |
| C5    | Missing own trailing: the Trader's trailing is activated, the user holds Invertido with no Vender and no sell order                                                                        | Warning                 | no   |
| C6    | Trailing mismatch: the user's trailing sell order trails a different percentage than the Trader's; not evaluable when the user's trail is unknown or the sell order is not a trailing stop | Warning / Not evaluable | no   |
| C7    | The Trader exited, the user is still in: a held ticker with an Invertido entry not in the Cartera Viva                                                                                     | Discrepancy             | yes  |
| C8    | Vender with the Trader out: a Vender entry on a ticker not in the Cartera Viva that IBKR no longer holds                                                                                   | Discrepancy             | yes  |
| C9    | Live buy on a ticker the Trader is not in: a Comprar entry or a live buy order on a ticker not in the Cartera Viva                                                                         | Informational           | no   |

## Phase 2

Phase 2 makes the private Simply Wall St watchlist equal the candidate set. A ticker is a candidate when every one of its entries in the tracking sheet is in Comprar, Roger or Operativa. One entry in any other Estado disqualifies it.

- **Plan.** The engine reads the tracking sheet and the watchlist live, and plans from those two reads, never from a list remembered from an earlier run. The removals are the watchlist tickers that are not candidates. The additions are the candidates the watchlist lacks. The plan is applied in the same run without asking: invoking the command is the authorisation.
- **Order and capacity.** Every removal is applied before any addition. The capacity is the one the watchlist page shows. If the candidate set is larger, nothing is changed and the report states both numbers.
- **Exact listing.** Each addition is resolved to one `EXCHANGE:TICKER` listing, preferring the US primary one (NYSE, NasdaqGS, NasdaqGM or NasdaqCM). The engine supplies the search term when it knows the company name; otherwise the term is a hint chosen by the LLM. Only the search result whose symbol equals the listing is clicked. The first result, a similar ticker or a position on screen never decides.
- **Per-change verification.** After each removal and each addition the engine checks that the confirmation names the expected ticker and that a fresh watchlist read differs from the previous one by exactly that change.
- **Final comparison.** The watchlist is read once more and compared with the candidate set exactly. The report lists the tickers removed, the tickers added, any left unresolved, the final list, and the count against the capacity.
- **Resumption.** An interrupted phase 2 is resumed with `/stonks:sync --only watchlist`. It plans again from the live sheet and the live watchlist, so changes already made are not repeated.

Guardrails:

- A keeper, a candidate already on the watchlist, is never removed, not even to diagnose the page.
- Any outcome other than the expected change stops phase 2 and reports the difference. The command does not try to repair it by experimenting on the watchlist.
- When no search result matches the listing exactly, or only a non-US listing exists, the ticker is not added. It is reported as unresolved and the command asks you for its exact listing.

## Report pane

Written in task 10.3.
