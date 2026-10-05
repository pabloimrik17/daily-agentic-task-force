## Context

See proposal.md for motivation. The decisions in this document were settled with the user. Where the decision record left a detail open, this document chooses it and says so. These constraints shape the approach:

- **Plugins install without dependencies.** Claude Code copies the plugin directory, and no install step runs on the consumer machine. The engine runs from source with `bun` and Node built-ins only, as `autonomous` does.
- **Claude Code on this machine is 2.1.289.** Mods (function hooks: panes, stores, `tool.call` and `command.run` hooks) are on by default from 2.1.287. Their API is early access and "may change between releases without notice".
- **The user works in tmux.** Claude Code therefore runs on the main screen, not the fullscreen layout: panes sit above the prompt, and the terminal reports no mouse clicks.
- **Plugin hooks already run in this environment.** Other plugins' `SessionStart` hooks fire, and the built-in `/diff` mod has a store under `~/.claude/plugins/store/`.
- **IBKR's official MCP server** (`https://api.ibkr.com/v1/api/mcp-public`) exposes `get_account_positions` and `get_account_orders`. It has no order-submitting tool. Its order-related tools create, read and delete order *instructions* that need manual approval (`create_order_instruction`, `get_order_instructions`, `delete_order_instruction`); the dotfiles deny the first and the last. It also exposes alert, watchlist and customer-feedback mutations, which the command never uses. OAuth 2.1 runs through IBKR's own login. The first connect recorded most of what was unknown; only the refresh-token lifetime is still unmeasured (task 3.2 step 7). What is known:
    - the hook payload: a plugin `PostToolUse` command hook fires for the two IBKR reads in a `--plugin-dir` headless run. Its stdin JSON has the keys `cwd`, `duration_ms`, `hook_event_name`, `mcp_server` (`{ name: "ibkr", source: "user" }`), `permission_mode`, `prompt_id`, `session_id`, `tool_input` (`{}`), `tool_name`, `tool_response`, `tool_use_id` and `transcript_path`. `tool_response` is a **string** holding the server's JSON text, which arrived whole (about 4.8 kB for 21 positions, 3.7 kB for 13 orders);
    - positions: `{ "positions": [ { contract_id: number, contract_description: string (the ticker symbol), position: number (fractional values occur), market_price, market_value, average_price, unrealized_pnl: number, currency: string, asset_class?: string ("STK"; absent on some rows) } ] }`;
    - orders: `{ "orders": [ { order_id: number, order_status: "NEW" | "REPLACED" | …, order_type: "LIMIT" | "TRAILING_STOP" | …, side: "BUY" | "SELL", total_shares_qty, cum_shares_qty, remaining_shares_qty: numeric strings, primary_description: string of the form "<SIDE> <qty> <TICKER>", secondary_description: string, order_time: ISO string, limit_price?: number (limit orders only) } ] }`. `secondary_description` reads "<Type> <price>, <tif>" for a limit and "Trailing <amount> Stop <price>, <tif>" or similar for a trailing stop, with no percent sign and no unit;
    - trailing stops: `order_type` is `TRAILING_STOP`. The trail appears only as an unlabelled amount in `secondary_description`, so the trail percentage is unknown unless the text carries a `%` (none did);
    - pagination: none observed. Both responses returned every row, with no page or cursor field.
- **`gws` 0.22.5** (`googleworkspace-cli`, Homebrew) reads Sheets values as JSON, keeps credentials in the macOS Keychain and accepts an exact `spreadsheets.readonly` scope. It is pre-1.0, has been idle since 2026-03, and Google has announced an official CLI "coming soon".
- **Simply Wall St** has no retail API, CLI or MCP server. Reading and changing the portfolio and the watchlist means driving the web UI with the Claude in Chrome tools. The Cowork history recorded which browser recipes worked and which failed: scrolling blacks the watchlist page, fuzzy search picks wrong listings, and synthetic `input` events do not reach the React search box.
- **Repository rules**:
    - `tsconfig.json` includes `**/*.ts` and ESLint is type-aware over all of it;
    - knip and fallow check every plugin workspace;
    - Vitest runs `plugins/*` as projects;
    - CI pins `@anthropic-ai/claude-code@2.1.278` for `plugin validate` and `@fission-ai/openspec@1.11.0` for change validation;
    - the five agent-scaffolding ignore lists must stay identical.
- **Cross-repo contract**:
    - dotfiles `add-stonks-tooling` registers the server at user scope as `ibkr`, installs `gws` and denies `mcp__ibkr__create_order_instruction` and `mcp__ibkr__delete_order_instruction`;
    - dotfiles `add-plugin-configs` installs the encrypted `~/.config/stonks/config.json`.

## Goals / Non-Goals

**Goals:**

- Every decision of both Cowork tasks in tested code, fed only by data read live in the same run.
- No path by which the LLM's retelling of a value can reach a check, except the screenshot fallback the user confirms.
- A run that stays usable if the mod API breaks: markdown is always printed, and input capture does not depend on mods.
- No personal value in either public repository.

**Non-Goals:**

- A generic browser-automation or scraping framework.
- Run history beyond the one previous snapshot.
- Writing to any source, or making the watchlist public.
- Multiple IBKR accounts, or several runs at once.

## Decisions

### D1: Tier every part: code, then typed judgement, then LLM

This is the repository's tiering principle, as in `autonomous`. No part of this change needs a typed judgement, so no Jev step exists.

| Part                                                            | Tier                                                      |
| --------------------------------------------------------------- | --------------------------------------------------------- |
| Configuration loading and validation                            | code                                                      |
| Calling the two IBKR reads; driving the browser                 | LLM (tool calls only; it never handles the returned data) |
| Capturing raw tool results                                      | code (plugin hook, D5)                                    |
| Reading the tracking sheet                                      | code (`gws` adapter, D7)                                  |
| Validating and normalising every input                          | code                                                      |
| Offering `/mcp` re-authentication when IBKR fails               | LLM relays the engine's directive; the user acts          |
| Transcribing IBKR screenshots (fallback only)                   | LLM, gated by the user's confirmation of the engine's rendering |
| Comparing available `mcp__ibkr__*` tool names with the known set | code (the LLM only passes the names)                      |
| Checks, gate, watchlist plan, listing choice, verification      | code                                                      |
| Search term for a ticker whose company name the engine lacks    | LLM (a hint only; D11 selects by exact match)             |
| Report data, markdown, Movimientos, counters                    | code                                                      |
| Pane                                                            | code (mod)                                                |
| Relaying output; asking the user (gate, login, screenshots)     | LLM                                                       |

### D2: One command, two phases, phase 1 report-only

The two Cowork tasks always ran back to back, so they become one command. `--only` covers the two partial needs: sources alone, and resuming a watchlist that failed midway.

Phase 1 never writes, because the user fixes the sources by hand ("voy arreglando yo la que me proporciones"). IBKR is the truth and cannot be written by the available tools anyway.

**Rejected alternatives:**

- **Two commands.** The user would have to chain them, and the gate between them would be lost.
- **Auto-fixing the sheet.** The user did not ask for it, and it would need a write scope.

### D3: The gate pauses once, and shows everything

The engine marks each finding with `affectsWatchlist`. The marked set is fixed in the `stonks-reconciliation` spec:

- **C1, C2, C3, C7 and C8**, as recorded. C8 fires only when IBKR no longer holds the ticker, so a Vender entry still held with its sell order never trips the gate.
- **The B findings that imply a different Estado**:
    - B1, entry without position;
    - B2, position without entry;
    - B4, Comprar without order;
    - B5, buy order without entry;
    - B7, sell orders beyond Vender entries.
- **Never marked**: B3 (quantity), B6 (order price or quantity), B8 (the alert, whose fix is an IBKR order rather than an Estado), A, and every warning, informational and not-evaluable finding. Of the B findings, therefore, B1, B2, B4, B5 and B7 trip the gate, and B3, B6 and B8 do not.

**One pause, the whole report.** When the gate trips, the pause shows the complete phase-1 report: every finding of every check, with the watchlist-affecting ones marked. The user fixes everything in one go, not only what tripped the gate. After "sigue" the engine re-reads the sheet, recomputes, prints what remains and proceeds to phase 2 without pausing again.

The record leaves one point open: what "sigue" does when watchlist-affecting findings remain. This design makes the gate a **pause, not a lock**.

A re-stopping gate would deadlock on findings the user keeps on purpose, and their only escape would be `--only watchlist`. Two examples:

- C7 on a ticker the user keeps after the Trader exits;
- B2 on a position the user deliberately leaves out of the sheet.

There is no separate command to resume after the gate: the reply continues the run, and `--only watchlist` resumes a run that ended.

**Rejected alternatives:**

- **Always continue.** The watchlist would follow a sheet known to be behind, for example a C2 ticker not yet marked Roger.
- **Always ask before phase 2.** In 22 Cowork runs the user never wanted a confirmation for the watchlist.
- **Gate on every Discrepancy.** A and quantity findings do not change the watchlist, and the run would stop almost every time.
- **Re-stop until clean.** It deadlocks, as above.

### D4: IBKR through its official MCP server, with Claude Code as client

The command's `allowed-tools` pre-approves only `mcp__ibkr__get_account_positions` and `mcp__ibkr__get_account_orders` among the IBKR tools (D12 lists the rest). The dotfiles managed settings deny `mcp__ibkr__create_order_instruction` and `mcp__ibkr__delete_order_instruction`, and IBKR's consent can be revoked from Client Portal. No global allow rule exists anywhere: the approval lives in the command's frontmatter and applies only while the command runs.

**Unknown IBKR tools (D4a).** The deny is exact: it names two tools. IBKR's OAuth already advertises an `mcp.orders.submit` scope that no public tool uses yet, so a new order-capable tool could appear on the server and be callable with the user's normal prompts. Two measures cover it:

- The first-connect verification (task 3.2) records the `ibkr` server's tool list.
- Each run, the engine reports a WARNING, never blocking, for any `mcp__ibkr__*` tool outside the known set.

*Where the known set lives.* It is a constant in the engine, `src/inputs/ibkr-tools.ts`, holding the full catalog of 34 tool names recorded at first connect. The alternatives were the user configuration, which is strict-schema, encrypted and unreachable for a public repository to evolve, and a state file, which the next `begin` would erase or which a user could edit away. A constant is reviewed, versioned, covered by a Vitest test and public, because tool names are not personal data. The cost is a plugin release when IBKR adds a legitimate read tool, which is the intended friction.

*How the engine learns the names.* The engine cannot list MCP tools itself. `begin` directs the command to pass the names of the `mcp__ibkr__*` tools it has in this session to `ibkr-tools <name>…`. That is the LLM reporting tool names, not retelling data: no check, gate or plan uses them, and a wrong list at worst misses or invents a warning. The warning is printed at once, repeated in the report, and the run continues. The unknown tool is never called.

**Rejected alternatives:**

- **A bun script as its own MCP client** (`@modelcontextprotocol/sdk` over Streamable HTTP, `mcp.read` scope). It is fully deterministic. But the plugin would have to own:
    - a dynamic-client-registration plus PKCE loopback flow;
    - refresh-token storage in the Keychain;
    - an unchecked terms question, since IBKR describes the service as for "AI applications".

  Claude Code already stores the OAuth tokens. D5 gives the property that motivated this option, that no LLM retells the data, without that code.
- **Flex Web Service plus screenshots.** Flex has no open-orders section, and its positions are end-of-day. Orders would still come from screenshots on every run, which is the error class this change removes.
- **Client Portal Gateway or TWS API.** They need a daily 2FA browser login, or a GUI app kept running. TWS has no official TypeScript client.
- **Screenshots only (Cowork).** Vision transcription went wrong whenever screenshots were incomplete.

**Re-authentication first.** When a read fails or the server needs login, the command first offers re-authentication through `/mcp` and repeats the reads once the user has done it. Re-authentication costs the user a click, and it keeps IBKR on the exact path that never transcribes. Only if it fails or the user declines does the fallback apply. The engine remembers that the offer was made with a marker in the run directory, `ibkr-reauth-offered.json`: the first `phase1` whose IBKR read fails prints `ibkr-reauth`, and any later one in the same run prints `ibkr-fallback`. A declined offer is the command running `phase1` again at once.

**Fallback.** When re-authentication has failed or been declined, or the response does not validate, Claude transcribes the user's screenshots into JSON. It sends that JSON to `ibkr-screenshots stage` on stdin. The engine validates the table and prints its own rendering, and the user confirms that rendering before `ibkr-screenshots confirm`.

Confirming the engine's rendering, rather than Claude's message, means the user checks exactly what the checks will use. The command asks for both positions and orders and checks that the positions are contiguous, which catches a missing page, the failure seen in Cowork. The report marks IBKR's provenance.

*Transcription format.* The JSON sent to `ibkr-screenshots-stage` is `stonks.ibkr-screenshots.v1`: `positions` as one array of `{ ticker, quantity }` per screenshot, top to bottom, overlapping rows included; `orders` as one array of `{ ticker, side, quantity, orderType, limitPrice, trailPercent }` per screenshot, or `null` with `noActiveOrders: true` when the user states that no order is active. Contiguity is checked on the positions: each screenshot after the first must share a position with the one before it, which is what proves that no page was skipped, and the overlap is removed when the pages are merged. A missing field is never filled in.

### D5: Capture through a plugin `PostToolUse` hook

`hooks/hooks.json` declares a `PostToolUse` command hook:

- **Matcher**: `mcp__ibkr__get_account_positions`, `mcp__ibkr__get_account_orders`, and Claude in Chrome's `javascript_tool` under both namespace spellings seen historically, `mcp__claude-in-chrome__` and `mcp__Claude_in_Chrome__`.
- **Command**: `bun "${CLAUDE_PLUGIN_ROOT}/src/capture.ts"`, which reads the hook's JSON on stdin.
- **No active run** (D6): it exits 0 at once.
- **IBKR tool**: it writes the `tool_response` verbatim to `<run>/raw/<seq>-<tool>.json`. The `tool_response` is the server's JSON as a string, written as it is.
- **`javascript_tool`**: it keeps a result only if it parses as a collector envelope, `{"stonks": "<collector>.v1", "run": "<runId>", …}`, for the active run. The user's unrelated JavaScript is never stored.
- **Behaviour**: synchronous, with a short timeout. It always exits 0, so it never blocks the tool and never writes to the conversation.

The engine uses the last valid capture of each kind in the run. The command runs collectors with `javascript_tool` on its own, never inside `browser_batch`, so that each result arrives as one hook event.

*File names.* `<seq>` is the epoch milliseconds zero-padded to 15 digits, so the names sort by time and the last capture of a kind is the greatest name ending in `-<kind>.json`. `<kind>` is the IBKR tool name, or the envelope's `stonks` name without its version suffix; action envelopes (`click-row`, `remove-from-menu`…) are captured the same way, which is how the verification reads the confirmation toast.

**Rejected alternatives:**

- **Claude pipes the tool result into the engine** (heredoc or stdin). That is retelling, which risks transcription errors and costs tokens.
- **A mod `tool.call` hook.** It works the same way, but it rests on the early-access API and would tie input capture to the pane spike. When the mod broke, the sync would break with it, while the markdown fallback exists precisely so that it does not.
- **The engine fetches everything itself.** That was rejected for IBKR in D4, and it is impossible for authenticated browser pages.

### D6: State directory and run directory

All local state lives under `${XDG_STATE_HOME:-$HOME/.local/state}/stonks`, overridable with `STONKS_STATE_DIR` for tests. The directories are `0700` and the files `0600`.

```text
stonks/
  active.json            # { runId, startedAt, mode } while a run is open; captures expire after 6 h
  runs/<runId>/          # one run only; `begin` deletes runs/* first
    raw/                 # hook captures, verbatim
    ibkr-confirmed.json  # fallback table, after confirmation
    report.json          # stonks.report.v1, read by the pane
    plan.json            # watchlist plan
    previous.json        # snapshot handed over by the mod (D14), consumed once
  listings.json          # learnt TICKER → { symbol, name, url } (D11)
  snapshot.json          # markdown-only variant only (D14)
```

The run id is the UTC start time plus a random suffix. A second `begin` replaces the active run, so only one sync at a time is supported.

**Rejected alternatives:**

- **`${CLAUDE_PLUGIN_DATA}`.** It is exported to hook processes, but it is not verified to reach the commands the model runs through Bash. The hook and the engine must resolve the same path from both contexts.
- **`/tmp`.** It is shared and cleaned unpredictably.

Deleting the previous run directory at `begin` enforces the rule "nunca mires los datos de antes" mechanically, rather than by instruction.

### D7: Tracking sheet through `gws` behind a one-file adapter

The adapter, `src/inputs/sheet-gws.ts`, is the only file that knows `gws`. It runs:

```text
gws sheets spreadsheets values get --params '{"spreadsheetId": …, "range": "'<tab>'!A:E", "valueRenderOption": "UNFORMATTED_VALUE"}'
```

It returns rows or a typed error, and its process runner is injectable for tests. Ranges address the tab by name, not by gid, because `gws` requires the name.

**Rejected alternatives:**

- **Sheets API v4 from TypeScript.** It is the fully supported route, but the plugin would own about 60 lines of loopback OAuth and Keychain code.
- **The gviz CSV export fetched in the browser (Cowork).** It is an undocumented endpoint, it needs a logged-in tab, and its result passes through a model tool call.
- **Google's Sheets MCP server.** It is a developer preview with broad scopes, and every read goes through the model.
- **claude.ai connectors.** Only the model can call them, and they return formatted strings only.

Swapping `gws` for Google's announced official CLI or for the Sheets API changes this one file.

### D8: SWS portfolio kept manual and read in the browser

The user keeps the SWS portfolio by hand: a Broker Sync portfolio lacks data the user relies on to see real value and evolution.

The collector returns:

- the holding rows' stock links (`href` and text);
- the page's own holdings counter;
- the page path, for login detection.

The engine derives each ticker from the link's `/stocks/<country>/<industry>/<exchange>-<ticker>/<slug>` path and requires the count to equal the counter.

**Rejected alternatives:**

- **Simply Wall St Broker Sync** (via SnapTrade). It loses that data, linked portfolios cannot be edited, and auto-import mis-matches listings.
- **A public shared portfolio page.** It is unverified, and it would publish the holdings.
- **The Cowork regex over `innerText` with a growing noise list.** It leaked footer and company-name fragments into reports as holdings.

### D9: Private watchlist read in the browser

The collector returns:

- the watchlist's title;
- the counter `N/M`;
- per row, the stock link and any embedded `uniqueSymbol`.

The engine prefers `uniqueSymbol`, for example `NasdaqGS:HOOL`. Otherwise it derives the listing from the link slug. A Nasdaq slug carries no tier, so it matches any Nasdaq tier. The title must equal the configured watchlist name.

**Rejected alternative: making the watchlist public** and reading the server-rendered page with a plain `fetch`. That would be deterministic and need no browser. But a public watchlist enters Simply Wall St's public Watchlist Directory, and this one would republish the Trader's paid signals: the Roger tickers.

### D10: Thin collectors, parsing in the engine

Collectors and browser actions are JavaScript source strings in `src/browser/*.ts`. They are printed by `bun src/cli.ts collector <name>` or `action <name> <args>`, with the run id and any arguments embedded. Claude passes them to `javascript_tool` unchanged.

They only gather page facts: links, texts, counters, path and login-form presence. They never decide; every parse and decision lives in the engine and is tested with Vitest on fixture envelopes. A Vitest test compiles every string with `new Function` to catch syntax errors.

**Rejected alternatives:**

- **Claude writes the JavaScript each run.** The scripts drift; the Cowork noise list grew run after run.
- **Parsing inside the browser.** That logic would sit outside the test suite.
- **TypeScript functions serialised with `toString()`.** They need the DOM library, and a triple-slash reference would add it to the whole repository's type-check.

The Cowork recipes become rules in `commands/sync.md`:

- start with `tabs_context_mcp {createIfEmpty: true}` and a fresh `navigate`, since a tab left from the previous run fails;
- poll for readiness instead of waiting a fixed time;
- never scroll the watchlist page, which renders black;
- open a row's menu with pointer events dispatched on the row's last button;
- reposition the "Add stock" panel into view with CSS;
- type the search term with real keystrokes (`computer` `type`), because synthetic `input` events do not reach the React search box;
- click by DOM element as the engine identifies it, never by screen coordinates.

### D11: Resolving an addition to an exact listing

1. **Target.** If `listings.json` knows a US-primary listing for the ticker, that listing is the target. Otherwise the target is the ticker on any US primary exchange: NYSE, NasdaqGS, NasdaqGM or NasdaqCM.

   `listings.json` is learnt from every Simply Wall St stock link the engine reads (watchlist, SWS portfolio, search results) and from each verified addition. It is reference data about public listings, never input to a check.
2. **Search term.** The engine supplies the learnt company name, or the name on the Cartera Viva card when the card carries one. Otherwise Claude chooses the term. The term is only a hint.
3. **Search.** Claude opens the repositioned "Add stock" panel, focuses the search box through `find`, and types the term. An action expands "+ N listings" where shown.
4. **Read the results.** The dropdown collector returns every row with its index, label and exchange-qualified symbol.
5. **Select.** The engine selects the row whose symbol equals the target, and only that row. Zero matching rows, or more than one, makes the ticker unresolved: it is not added, and the user is asked for the listing.
6. **Click and verify.** An action clicks the selected row by index. The toast and a fresh read verify the change, and the engine then learns the listing. The toast is read by the action right after the click; if the real page renders it later (task 3.4), the action polls for it briefly. A toast that names no ticker fails the verification, as the spec requires.

**Rejected alternatives:**

- **Type the ticker and take the first result.** In Cowork this added two wrong companies before the right one, and returned a non-US listing first for a dual-listed company.
- **The "Watch" toggle on a stock page.** It behaved inconsistently with named watchlists.
- **The site's internal GraphQL mutations.** They are undocumented and disallowed by `robots.txt`, and discovering them once cost two keepers being removed and re-added.

### D12: The engine is a step machine; the command follows directives

`commands/sync.md` declares:

- `disable-model-invocation: true`;
- `argument-hint: "[--only sources|watchlist]"`;
- `allowed-tools`: exactly `mcp__ibkr__get_account_positions`, `mcp__ibkr__get_account_orders` and `Bash(bun:*)`.

`Bash(bun:*)` is what the command needs to run its engine, since every step is `bun "${CLAUDE_PLUGIN_ROOT}/src/cli.ts" <step>`. A narrower pattern holding the plugin root path would depend on how that variable expands in permission matching, which is unverified; task 9.1 tightens it if the apply phase can show that it matches. Nothing else is pre-approved, so the Claude in Chrome tools follow the user's own permission settings. This is listed as an open point for the orchestrator.

The command calls `bun "${CLAUDE_PLUGIN_ROOT}/src/cli.ts" <step>`. Each step prints markdown for the user, followed by a directive the command follows. These are the step names as implemented; every step but `begin` and `end` needs the open run and a valid configuration, and prints `stop` otherwise.

| Step                                                                                                      | What it does                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `begin [--only …]`                                                                                        | Validates the arguments and configuration, opens the run, and lists the reads to perform: in `full` and `sources` the two IBKR reads, the tracking sheet and the SWS portfolio and Cartera Viva collectors; in `watchlist` the tracking sheet and the watchlist collector. The watchlist is read in phase 2, just before `watchlist-plan` |
| `ibkr-tools <name>…`                                                                                      | Compares the session's `mcp__ibkr__*` tool names with the known set, keeps the warnings in the run for the report and prints them (D4a)                                                                                                                                                   |
| `collector <name>`, `action <name> <args…>`                                                               | Print browser JavaScript (D10)                                                                                                                                                                                                                                                            |
| `ibkr-screenshots-stage`, `ibkr-screenshots-confirm`                                                      | The D4 fallback: `stage` reads the transcription on stdin, validates it and renders it; `confirm` accepts the staged table                                                                                                                                                                |
| `phase1`                                                                                                  | Reads the sheet, validates the captures, runs the checks and the gate, writes `report.json`, prints the whole report and the `stonks-report-path:` line                                                                                                                                   |
| `sigue`                                                                                                   | Re-reads the sheet, recomputes with the same run's captures, prints what remains and directs to phase 2, never to `gate-wait` again                                                                                                                                                       |
| `watchlist-plan`, `watchlist-search <T>`, `watchlist-resolve <T>`, `watchlist-verify`, `watchlist-final` | Phase 2: the plan from the live sheet and the live watchlist, the search term and target listing for an addition, the exact dropdown row to click, the verification after each change, the final comparison                                                                              |
| `end`                                                                                                     | Closes the active run                                                                                                                                                                                                                                                                     |

The directives are `ask-login <source>`, `ibkr-reauth`, `ibkr-fallback`, `gate-wait`, `remove <T>`, `add <T>`, `stop` and `done`. The exit code is 0 when a directive was printed and 1 on a usage or runner error. A step's markdown names the step the command runs next for each directive, so the command never infers the sequence.

Every branch therefore lives in tested code, and the command's markdown is a loop over directives. Skipping a step would contradict a printed instruction rather than an inference.

### D13: Report in a mod pane, markdown always, spike first

`hooks/hooks.json` also holds `modules: ["./mod/register.ts"]`. Its hooks do the following:

- **`command.run`** for `stonks:sync` opens the pane in a "syncing" state. A pane opened because the user ran a command counts as asked for, so it places at any width.
- **`tool.call`** on Bash recognises the engine's `phase1`, `sigue` and `watchlist-final` steps and reads `report.json` from the run directory (`$.fs.read`) into `$.state`. The step names the file on a `stonks-report-path: <path>` line of its stdout.

  *Spike outcome (task 1.3).* Both feeds were tried in a headless `--plugin-dir` run: the path line followed by `$.fs.read`, and the whole report inlined in stdout between markers. Both delivered the report (the pane's store received the snapshot either way). The path feed is kept: the inline block would put the report into the transcript a second time, which the model then reads, for nothing the pane needs. The mod's inline-block branch was removed during apply (the repository's complexity gate asked for the hooks module to be split into small functions, and the dead branch went with it); the spike stub still prints the markers until task 10.1 deletes it.

The pane draws:

- bordered `Box` sections with `Markdown` tables;
- `Button`s with hotkeys that toggle each mirror's section;
- links reachable with Tab and Enter, since tmux reports no clicks;
- checklist ticks, kept in `$.state` only.

The engine always prints the markdown, and the command relays it.

**Rejected alternatives:**

- **Markdown only.** It is static, scrolls away, and has no collapse or checklist. It remains the always-printed output, and v1 if the spike fails.
- **A local HTML file opened with `open`.** It needs a generated file the user does not want, and it leaves Claude Code in the terminal.
- **An Artifact.** The user's Claude login is a company account. Artifacts are stored on Anthropic's servers and can be retrieved by organisation administrators (Compliance API), so personal finances must not go there.
- **`glow` in a side tmux pane, or a mod `CommandOutput` render.** Both offer less interaction, and the latter carries the same API risk.

**The spike is the first task group.** It must show all of the following:

1. `command.run` fires for a plugin markdown command.
2. The pane opens and draws in the user's tmux main screen at their usual width.
3. The feed delivers `report.json`.
4. `$.store` survives a new session, and the D14 handoff works.
5. Mod tests run under `claude plugin test`.
6. The types resolve under the repository's toolchain.

*Spike status (2026-10-05).* Point 1 holds: `command.run` fires for the plugin's markdown command in a headless run, the handoff file is written and the command still runs through `next(e)`. Point 3 holds (above). Point 6 holds (D17). Point 5 holds for `claude plugin validate` on both Claude Code versions, while `claude plugin test` itself is blocked on this machine by a stale cached rollout flag (D17). Points 2 and 4 (the pane drawn in the user's tmux at their width, and `$.store` across `/clear`) await the user's session, tasks 1.2, 1.4 and 1.7; `$.store` across processes is already shown (D14).

If any of points 1–4 fails, v1 ships markdown-only: the pane requirement is removed from the `stonks-report` delta and the snapshot moves to the engine (D14). If capture (D5) fails under the user's login, the work stops and is escalated, because no fallback exists that avoids transcription.

### D14: Snapshot home and handoff

The record places the previous-run snapshot in the mod's own store. The deltas are report data, so the engine computes them: Movimientos and counters are pure functions tested with Vitest.

The handoff works as follows:

1. On `command.run`, the mod writes its stored snapshot to `<state>/previous.json` with `$.fs.write`.
2. `begin` moves the file into the new run directory, where it is consumed once.
3. After phase 1, the mod replaces its store entry with the `snapshot` field of `report.json` (schema `stonks.snapshot.v1`). `sigue` and `watchlist-final` rewrite `report.json` and the mod stores the snapshot again, so the store follows the last report of the run: after "sigue" the next run's repeat counters compare against the findings of the re-read sheet, not the ones the user fixed.

*Verified headlessly (task 1.4).* A `$.store` value written by one headless run was read by a later one; `command.run` wrote `<state>/previous.json`; `begin` moved it into the run directory and the state root no longer held it, so the handoff is consumed once. Survival across `/clear` in an interactive session is the user's remaining check.

If the mod did not run, there is no `previous.json`. The report then says the previous run is unavailable, and Movimientos covers the gap from the last stored snapshot, whose date is printed.

**Markdown-only variant.** Without a pane there is no mod store, so, as the user accepted, the engine keeps the snapshot: it writes `snapshot.json` in the state directory itself, and `begin` reads it. Movimientos and counters therefore stay in the report.

**Rejected alternatives:**

- **The engine reads the mod's store file directly.** That couples it to an undocumented file format of an early-access API.
- **The mod computes the deltas.** That logic would sit outside Vitest.

### D15: Configuration

The configuration follows the `autonomous` pattern:

- a hand-written strict validator with the paths in its errors;
- an override through `STONKS_CONFIG`, for tests;
- an error for a missing file that points to `config.example.json`.

The plugins install independently, so the small validation helpers are copied from `autonomous`, not imported from it.

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

Every field is required. URLs must be `https`. Strings are non-empty. Tickers are upper-case and unique. The watchlist name lets the engine refuse a different watchlist (`stonks-inputs`).

Nothing else is configurable. The MCP server name `ibkr` is part of the dotfiles contract and is fixed in `allowed-tools`, the sheet columns are validated by header, the known set of IBKR tools is a constant in code (D4a), and the US exchange preference is fixed in code.

### D16: Check semantics details

- **Ticker normalisation.** Upper-case and trim. The class separators `.`, `/` and space become `.`. Exchange prefixes are removed for comparison.
- **Quantities** are equal when they differ by less than 1e-6.
- **Prices** are compared after rounding to four decimals.
- **Buy matching (B4–B6).** Exact `(quantity, price)` pairs are removed first. The leftovers are paired in ascending price order as B6, and whatever remains becomes B4 or B5.
- **Unprotected position (B8)** follows the record literally: sell cover is below the Vender total while the ticker is held. A partially sold Vender lot can therefore also raise the alert, next to its B3. A false alarm is preferred to a missed one.
- **C2** includes a ticker with no entry at all, as the user accepted. The record's "(entries in Operativa / En espera)" is the typical case, not a limit.
- **C8** fires only when IBKR no longer holds the ticker. While IBKR still holds it, the user's sell order is working, or B8 raises the alert if it is not.
- **Repeat counters** apply to every finding, keyed by check identifier and ticker, as the user accepted.
- **Desired list over capacity** makes no watchlist change at all (`stonks-watchlist`).
- **A failed post-change check** stops phase 2 and repairs nothing (`stonks-watchlist`).
- **Sheet parsing is strict**: an unknown Estado, a blank Estado on a ticker row, or a row without a ticker stops the run.

### D17: Repository cost of the mod

This cost is accepted by the record and planned in tasks group 10:

- **Types.** `claude-code.d.ts` is vendored, pinned to the tested Claude Code version (2.1.289), in `plugins/stonks/mod/types/`. It is an ambient module, but the spike found that its `global` block redeclares web globals (`URL`, `URLSearchParams`, `crypto`, the JSX factory `h`) which clash with Bun's types once the file sits in the root program: `plugins/autonomous` stopped type-checking. So the hooks module is type-checked as a program of its own, `plugins/stonks/mod/tsconfig.json` (ESNext lib, `types: []`, the environment the module runs in), which `bun run typecheck` runs through the plugin's `typecheck` workspace script after the root `tsc`. The root `tsconfig.json` excludes `plugins/*/mod` and `plugins/*/.claude-plugin/types`. `plugins/stonks/tsconfig.json` extends the root for the engine sources and is committed, because the engine writes one of its own (pointing at `.claude-plugin/types/`) whenever a plugin with a hooks module has none, and ESLint's project service would pick that one up.
- **Ignores.** The vendored file is excluded from oxfmt, ESLint, knip (a `project` negation) and fallow (`ignorePatterns`) as third-party code, each with its reason. `claude-code`, the engine's own module, is an ignored dependency for knip and fallow. None of it touches the agent-scaffolding lists, which stay identical.
- **Tests.** Mod tests run under `claude plugin test` (`mod/register.test.ts`, importing `claude-code/testing`). `plugins/stonks/vitest.config.ts` excludes `mod/**` so that Vitest does not run them. They run locally, like the `autonomous` eval suite, not in CI. *Spike finding:* on this machine `claude plugin test` refuses to run, saying hooks modules are turned off in its process: it reads the cached GrowthBook flag `tengu_plugin_hooks_modules`, which is `false` in `~/.claude.json`, while the engine does load the module from a `--plugin-dir` folder, as the headless spike runs showed. Starting `claude` once with network access refreshed the flag (it read `true` on 2026-10-05) and the runner works. A second finding: `claude plugin test` takes a plugin root and runs every `*.test.ts` beneath it, so pointed at `plugins/stonks` it also loads the Vitest suites, which cannot import `vitest` there and fail. The plugin's `bun run test:mod` (`scripts/mod-test.ts`) therefore builds a scratch plugin root holding the manifest and `mod/` alone and runs the tests in it.
- **Entries.** `mod/register.ts` is a knip entry (a `plugins/stonks` workspace block) and a fallow entry (`plugins/*/mod/register.ts`), so its exported `register` is not reported as unused. Done in the spike.
- **Git.** `.gitignore` gains `plugins/*/.claude-plugin/types/`, which the engine writes on every load (the engine also drops a `.gitignore` with `*` inside that folder).
- **CI pin.** The CI-pinned 2.1.278 accepts `modules` in `hooks.json` and `types` in `plugin.json`: both `plugin validate --strict plugins/stonks` and the CI command on `marketplace.json` pass, so the pin stays. One condition came out of the spike: the 2.1.278 validator does not know the `claude-code` state library (`atom`, `read`, `update`) and refuses `$` passed into an imported function, while 2.1.289 requires every `$.state` reference to be a string literal or a constant of the same file. The mod therefore calls `$.state.get` and `$.state.set` directly with file-level reference constants, which both versions accept.
- **Open point.** The cached flag above suggests that an *installed* plugin's hooks module may be gated remotely while `--plugin-dir` folders load. Task 12.1 confirms the pane with the copy installed from the marketplace; if it does not load there, the markdown report is the run's output and D13's fallback applies.

### D18: Plugin layout

```text
plugins/stonks/
  .claude-plugin/plugin.json
  package.json              # @daily-agentic-task-force/plugin-stonks, private, 0.0.0
  README.md                 # purpose, requirements, setup, usage, data handling
  CHANGELOG.md              # owned by release-please
  CONTEXT.md                # glossary (exists)
  config.example.json       # placeholders only
  commands/sync.md          # thin: directives loop, browser rules
  hooks/hooks.json          # PostToolUse capture hook + mod module
  src/cli.ts                # step machine entry
  src/args.ts  src/config.ts  src/validate.ts  src/state.ts
  src/capture.ts            # hook entry (D5)
  src/inputs/               # ibkr.ts, ibkr-tools.ts, ibkr-screenshots.ts, sheet-gws.ts, sheet.ts, sws-portfolio.ts, watchlist.ts, cartera-viva.ts
  src/browser/              # collector and action sources (D10)
  src/checks/               # a.ts, b.ts, c.ts, findings.ts, gate.ts
  src/watchlist/            # candidates.ts, plan.ts, resolve.ts, verify.ts, listings.ts
  src/report/               # model.ts, movements.ts, counters.ts, markdown.ts, links.ts, snapshot.ts
  src/**/*.test.ts          # Vitest, fictional fixtures under src/**/fixtures/
  mod/register.ts           # pane (if the spike succeeds)
  mod/*.test.ts             # claude plugin test
  mod/types/claude-code.d.ts
  vitest.config.ts          # excludes mod/**
```

## Risks / Trade-offs

- **[The IBKR MCP server is about four months old and its shapes may change.]** Strict validation turns a change into a failed read, which leads to the confirmed screenshot fallback, never to a silent pass. Fixtures come from the first real connect.
- **[The refresh-token lifetime is unknown, so frequent re-logins may be needed.]** The user measures it (task 3.2). Re-authenticating through `/mcp`, or failing that the confirmed screenshots, keeps a run going.
- **[`get_account_orders` may not expose the trail percentage.]** C6 then reports not evaluable, as recorded, rather than guessing.
- **[The hook payload for MCP or `javascript_tool` results may be truncated or shaped unexpectedly.]** The spike and the first connect record real payloads before the parsers are written.
- **[A managed `allowManagedHooksOnly` or mod restriction may apply to the company login.]** Plugin hooks and a built-in mod already run in this environment, and the spike re-checks with this plugin. Capture has no non-transcribing fallback, so a block stops the work for the user to decide.
- **[The mod API is early access and may break on update.]** The markdown is always printed, and capture does not use mods. The tested Claude Code version is recorded in the README.
- **[Simply Wall St or the Cartera Viva page changes its markup.]** Collector results fail validation (count cross-check, title check, envelope schema), and the run stops naming the source instead of reporting noise.
- **[IBKR adds an order-capable tool the exact deny does not name.]** The per-run WARNING (D4a) makes it visible, and the pre-approval covers only the two reads. It does not block the tool: the user decides, and a block would make every IBKR release a failed run.
- **[`gws` stalls or is superseded.]** The swap is one adapter file. The version is pinned in dotfiles.
- **[Personal data sits in plaintext on local disk.]** It lives in a `0700` directory and is deleted at the next `begin`. The snapshot and listings hold no credentials.
- **[A non-US-only or obscure ticker has no exact US match.]** It is reported as unresolved and the user is asked. It is never added fuzzily.
- **[C7 pauses every run while the user deliberately holds a ticker the Trader exited.]** The gate pauses once per run (D3), at the cost of one "sigue".

## Migration Plan

The change is additive: a new plugin, plus marketplace and release-please entries at `0.0.0`. Release-please publishes `0.1.0` from the first `feat(stonks)` commit, and no version is bumped by hand.

The PR merges only after dotfiles `add-plugin-configs` and `add-stonks-tooling` have merged, because the plugin's first run needs the `ibkr` server, `gws` and the configuration. Rollback is removing `plugins/stonks/` and its marketplace, release-please and README entries. The user's local state directory can then be deleted by hand.

## Open Questions

These are answered during implementation without changing the specs or the task breakdown:

- The hook payload shape for `javascript_tool` results, pending the interactive probe (task 1.5).
- The Simply Wall St search URL form used for unknown-ticker links (task 7.4). The engine uses `https://simplywall.st/search?q=<TICKER>`, one constant in `src/report/links.ts`. Every candidate form answers 200 to a plain fetch and the Chrome extension was not connected when the apply phase tried the rendered page, so the form is confirmed by the user on the first real run (12.1) and corrected there if needed.
- Whether Cartera Viva cards carry company names usable as search terms (task 3.4).
