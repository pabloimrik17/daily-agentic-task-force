# Tasks

Cross-repo dependency: groups 3 and 12 need the dotfiles changes `add-stonks-tooling` and `add-plugin-configs` applied on this machine. Applying them from their branches is enough to work. This PR merges only after both dotfiles PRs have merged (13.1).

Personal data rule for every task: real identifiers, URLs, tickers, quantities and prices never enter this repository. Fixtures and examples are fictional. Real captures stay in the local state directory.

First-connect handoff from dotfiles: read [first-connect-observations.md](first-connect-observations.md) before groups 3 and 5. It records verified tool identifiers, the instruction-write guards and a fictional missing-unit trailing fragment. Full captures, pagination and the reauthentication interval remain pending in this plugin change.

## 1. Spike: mod pane, feed, persistence and capture (first)

- [x] 1.1 Create a minimal loadable skeleton:
    - `plugins/stonks/.claude-plugin/plugin.json` (`name: "stonks"`, version `0.0.0`);
    - `commands/sync.md` as a stub with `disable-model-invocation: true`;
    - `hooks/hooks.json` with `modules: ["./mod/register.ts"]`;
    - the `claude-code.d.ts` of the running Claude Code version, vendored under `mod/types/`.

  Verify that `claude plugin validate --strict plugins/stonks` passes, and that in `claude --plugin-dir plugins/stonks` the user can run `/stonks:sync` while the model-invocable listing does not offer it.
- [x] 1.2 Probe the pane opening on `command.run`. A `command.run` hook for `stonks:sync` opens a pane showing a fictional report:
    - an alerts box;
    - three mirror sections that `Button` hotkeys collapse;
    - a `Markdown` table;
    - ticker links;
    - a checklist.

  Verify, inside tmux on the main screen at the user's usual width, that:
    - the pane opens without the 144-column rule for unasked panes;
    - the sections collapse and expand from the keyboard;
    - the links can be followed with Tab and Enter;
    - Esc returns focus to the prompt.

  Done 2026-10-05 on the first real run rather than a fictional report: the user's checks passed, with the pane docked beside the transcript in the fullscreen layout. The run also showed a `Markdown` table breaking in the docked pane; the findings are now a grid sized to the pane's body (design D13).
- [x] 1.3 Probe the feed. A stub engine step writes a fictional `report.json` into a temporary state directory and prints markdown. The mod's `tool.call` hook on Bash recognises the step and redraws, once from `$.fs.read` and once from the tool's stdout. Verify which feed works, and record it in design D13.
- [x] 1.4 Probe persistence and the D14 handoff. Verify that:
    - a `$.store` value survives `/clear` and a new session;
    - `command.run` writes `<state>/previous.json` with `$.fs.write`, and the file appears on disk.

  Record any limit hit in design D14.

  Status: `$.store` across processes and the `previous.json` handoff are verified headlessly (design D14). Done 2026-10-05 in the user's session: the snapshot reached the next run after a new session and after `/clear`.
- [x] 1.5 Probe capture (D5). Add a `PostToolUse` command hook matched to Claude in Chrome's `javascript_tool` that copies its stdin to a file in a temporary directory. If dotfiles `add-stonks-tooling` is already applied, match the two IBKR reads as well; otherwise 3.2 covers them. Verify that the hook fires under the user's login, and record:
    - the exact payload (`tool_name`, `tool_response`);
    - whether a large result arrives untruncated;
    - that a `browser_batch` does not produce a per-step `javascript_tool` event.

  The headless probe recorded the IBKR payload (design Context). The `javascript_tool` probe needs an interactive session, because headless runs cannot obtain Claude in Chrome permission.

  If the hook does not fire, stop here and escalate to the user (design D13).

  Done 2026-10-05 in the user's session (`--plugin-dir plugins/stonks`, extension connected, a probe hook in a session settings file). The hook fires; the payload, the truncation limits and the single `browser_batch` event are recorded in design D5. The probe found that `tool_response` is an array of text blocks, which the capture hook did not read; it now does, and the plugin's own hook then captured a collector envelope from a real page end to end. The engine also rejects an envelope that `javascript_tool` truncated.
- [x] 1.6 Probe the toolchain cost (D17):
    - a trivial mod test under `claude plugin test`;
    - Vitest skipping `mod/**`;
    - the vendored types resolving under `bun run typecheck` and `bun run lint:eslint`, as an ambient module or through `paths`;
    - knip and fallow not flagging `register`;
    - whether the CI-pinned `bunx @anthropic-ai/claude-code@2.1.278 plugin validate .claude-plugin/marketplace.json --strict` accepts `modules`. Run it with a temporary marketplace entry, removed afterwards.

  Verify by running each command. Record the results in design D17.

  Update 2026-10-05: the cached flag refreshed and `claude plugin test` runs; it takes the plugin root and loads every `*.test.ts` beneath it, Vitest suites included, so `bun run test:mod` runs it on a scratch root holding the mod alone (design D17).

  Later on 2026-10-05 the cached flag read `false` again after a fresh headless start and the runner refused again; the remote rollout decides it (design D17).
- [x] 1.7 (User) Run the spike pane in your own tmux terminal and judge whether the fictional report is legible and usable. Verify that the verdict is recorded in design D13.

  Done 2026-10-05 on real data: legible and usable once the findings became a grid (design D13).
- [x] 1.8 Record the spike outcome in design D13, D14 and D17.
    - **If 1.2–1.4 or 1.7 failed, v1 ships markdown-only.** Then:
        - remove the "Report pane" requirement from `specs/stonks-report/spec.md`;
        - reword the snapshot requirement so the engine keeps the snapshot;
        - mark group 10 as not applicable;
        - delete `modules`, `mod/` and the vendored types.
    - **If 1.5 failed, stop and escalate.**

  Verify that `openspec validate add-stonks-plugin --strict` passes after the edits.

## 2. Plugin scaffold

- [x] 2.1 Complete the plugin:
    - `package.json`: `@daily-agentic-task-force/plugin-stonks`, private, `type: module`, version `0.0.0`;
    - `plugin.json` metadata: author, license, repository, homepage, keywords, and the same description;
    - an empty `CHANGELOG.md`;
    - a `README.md` skeleton (purpose, install, usage).

  Verify that `bun install` adds the workspace to `bun.lock` and changes nothing else.
- [x] 2.2 Add the `stonks` entry, version `0.0.0` with the same description, to `.claude-plugin/marketplace.json`. Verify that `bun run lint:marketplace` passes.
- [x] 2.3 Add the `plugins/stonks` package to `release-please-config.json`, mirroring `autonomous`'s three `extra-files` with the `stonks` JSONPath, and add `"plugins/stonks": "0.0.0"` to `.release-please-manifest.json`. Verify that `bun run lint:marketplace` reports the three versions in agreement.
- [x] 2.4 Add `config.example.json` with placeholders only (design D15), add a `stonks` row to the root `README.md` plugin table, and add `gws` to knip's `ignoreBinaries` with its reason comment. Verify that `bun run lint:markdown`, `lint:oxfmt` and `lint:knip` pass.

## 3. Manual verification and fixtures (user; needs the dotfiles changes)

- [x] 3.1 (User) Set up `gws` once:
    1. Create your own GCP project and enable the Sheets API.
    2. Create a Desktop OAuth client and place it where `gws` expects it.
    3. Set the consent screen's publishing status to **In production**. Under "Testing", refresh tokens die after 7 days.
    4. Run `gws auth login --scopes https://www.googleapis.com/auth/spreadsheets.readonly`.

  Verify that a `gws sheets spreadsheets values get` of the configured tab returns the header row, and that the granted scope is only `spreadsheets.readonly`.

  Done: the header row is returned; the granted scopes are `spreadsheets.readonly` plus the OIDC identity scopes (`openid`, `email`, `profile`), which grant no Sheets access.
- [x] 3.2 (User) Connect the IBKR MCP server for the first time:
    1. In `/mcp`, log in on IBKR's screen, sign the AI agreements and choose the account.
    2. With the 1.5 capture probe active, call `get_account_positions` and `get_account_orders` once.
    3. Record the response shapes and pagination.
    4. Record whether orders expose the side, type, limit price, trailing type and trail percentage.
    5. Confirm that `get_order_instructions` is denied.
       Superseded: the dotfiles removed that deny, and the tool is read-only (first-connect-observations.md).
    6. List every tool the `ibkr` server exposes, and record the names for task 5.7's known set.
       The catalog is recorded in first-connect-observations.md; the count discrepancy is resolved: the server exposes 34 tools, and the handoff's 33 omitted `get_order_instructions`.

  Verify that the findings replace the unknowns in design Context and Open Questions, with no real value written down.

  Done: steps 1 to 6 at the first connect and the headless capture (design Context). A seventh step, measuring over several days how often IBKR forces a new login, was dropped on 2026-10-05 by the user's decision; an expired login is met by the `/mcp` re-authentication offer (design D4).
- [x] 3.3 Turn the real IBKR captures into fictional fixtures under `plugins/stonks/src/inputs/fixtures/`. Keep the structure and field names, and replace every ticker, quantity, price, account id and personal value. Cover:
    - a trailing stop with its percentage;
    - a trailing stop without it, if the real data allows;
    - a limit buy;
    - a partially covered Vender;
    - an empty order list.

  Verify by grepping the fixtures for each real identifier and ticker from the private capture: there must be no match. Then delete the private capture.
- [x] 3.4 Run draft collectors on the real pages and fictionalise their envelopes the same way:
    - the SWS portfolio;
    - the watchlist;
    - a search dropdown showing several listings of one company;
    - the Cartera Viva;
    - each site's logged-out page.

  Record whether Cartera Viva cards carry company names (design Open Questions). Verify with the same grep as 3.3.

  Done 2026-10-05. The SWS portfolio, the watchlist, a search dropdown with one company's 12 extra listings, the Cartera Viva, and both sites' logged-out pages (read in a separate, logged-out browser) are recorded in design D10 and fictionalised under `src/inputs/fixtures/browser/` and the step fixtures. Cartera Viva cards do carry company names (design Open Questions). The grep found no real value, and the private captures are deleted.
- [x] 3.5 (User) Confirm that dotfiles `add-plugin-configs` installed `~/.config/stonks/config.json`. Verify that the file exists and decrypts. Its validation is checked in 4.1.

  Verified 2026-10-05: the file exists at that path, mode `0600`, as plaintext JSON that the engine loads (4.1).

## 4. Engine foundation

- [x] 4.1 Implement `src/validate.ts` (helpers copied from `autonomous`) and `src/config.ts`:
    - `stonks.config.v1`, overridable by `STONKS_CONFIG`;
    - strict errors with paths;
    - the example path in the missing-file error.

  Verify with tests for a missing file, a missing field, a mistyped field, an unknown field, a non-`https` URL, a duplicate Excluded ticker and the example's shape. Verify also that the real configuration from 3.5 loads.

  Done 2026-10-05: implemented and tested, and the real configuration now loads. An earlier revision of the dotfiles value carried a trailing space in `$.trackingSheet.tab`, which the validator rejects by design; the corrected value loads cleanly.
- [x] 4.2 Implement `src/state.ts`:
    - the state directory, from `STONKS_STATE_DIR` or the XDG default;
    - `begin`, which deletes `runs/*`, creates the run directory with `0700`, writes `active.json` and moves `previous.json` in;
    - `end`;
    - the 6-hour expiry of the active run.

  Verify with temporary-directory tests: the previous run is removed, permissions are correct, an expired run captures nothing, and the handoff is consumed once.
- [x] 4.3 Implement `src/args.ts` and the `src/cli.ts` step-machine skeleton: `--only sources|watchlist`, directive printing, and exit 0 or 1. Verify with tests that `--only portfolio` prints the usage, exits 1, and reads no input.
- [x] 4.4 Document in the plugin README:
    - the requirements: `bun`, `gws`, the `ibkr` MCP server, Claude in Chrome, and the Claude Code version from the spike;
    - the configuration: fields, path, `STONKS_CONFIG` and the example;
    - the state directory and data handling;
    - the tiering table.

  Verify that `bun run lint:markdown` passes.

## 5. Inputs and capture

- [x] 5.1 Implement `src/capture.ts` and add its `PostToolUse` entry to `hooks/hooks.json`, matching both Claude in Chrome namespace spellings. Verify with tests over the 1.5 and 3.2 payloads:
    - with no active run, nothing is written;
    - an IBKR result is written verbatim;
    - an envelope of the active run is kept;
    - an envelope from another run, and unrelated JavaScript, are ignored;
    - malformed stdin still exits 0.
- [x] 5.2 Implement `src/inputs/ibkr.ts`, which validates and normalises positions and orders. Verify with tests on the 3.3 fixtures:
    - a trailing stop with and without its percentage;
    - an order without a quantity, which fails naming the field;
    - an unknown shape, which fails.
- [x] 5.3 Implement the `ibkr-reauth` directive: when a read fails or needs login, `phase1` prints the `/mcp` re-authentication offer first and the `ibkr-fallback` directive only after the user reports that re-authentication failed or declines it. Verify with tests that the fallback is never printed before the offer was answered.

  Then implement `src/inputs/ibkr-screenshots.ts`:
    - `stage` reads JSON on stdin, validates it and renders the table;
    - `confirm` accepts it;
    - the positions are checked for contiguity, and a missing orders section is asked for;
    - the provenance is recorded.

  Verify with tests for the confirmed, rejected and missing-orders scenarios.
- [x] 5.4 Implement the `src/inputs/sheet-gws.ts` adapter, with an injectable runner and typed errors for a missing, unauthorised or failing `gws`. Implement the `src/inputs/sheet.ts` parser for:
    - the header;
    - blank rows;
    - the six Estados, after trimming;
    - an unknown Estado, reported with its row and value;
    - a row without a ticker;
    - a non-numeric Cantidad or `$/u`;
    - a blank Cantidad, read as zero.

  Verify with one test per `stonks-inputs` parsing scenario.
- [x] 5.5 Implement the collector and action sources in `src/browser/` and the parsers:
    - `sws-portfolio.ts`: holding links and the count cross-check;
    - `watchlist.ts`: the title check, `uniqueSymbol` or the slug, and `N/M`;
    - `cartera-viva.ts`: the Cartera Viva section only, with activated or not-activated trailing;
    - login-wall detection;
    - the dropdown rows.

  Verify with tests on the 3.4 fixtures, plus a `new Function` syntax test for every source.

  Done 2026-10-05: every source and parser is confirmed on the real pages, and the tests run on the 3.4 fixtures, D11 selection included. Three draft actions that would have misfired, and the draft Cartera Viva collector and parser, were rewritten (design D10). The addition and removal clicks and their toasts are first observed in task 12.2.
- [x] 5.6 Verify the live-read guarantee with an engine test: given a stale run directory and captures carrying another run id, `phase1` uses neither and reports the missing input instead.
- [x] 5.7 Implement `src/inputs/ibkr-tools.ts` and the `ibkr-tools <name>…` step (design D4a):
    - the known set as a constant, filled from the 34-tool catalog recorded in first-connect-observations.md plus `get_order_instructions`;
    - a WARNING for every `mcp__ibkr__*` name outside it, which never changes the exit code, the gate or any check;
    - the warning carried into the report.

  Verify with tests for the known set alone, an unknown tool, an empty list and a non-IBKR name, which is ignored.

## 6. Reconciliation

- [x] 6.1 Implement the findings model: check id, ticker, sides, severity and `affectsWatchlist`. Implement the D16 normalisation and comparisons. Verify with tests for the ticker separators, fractional quantities and price rounding.
- [x] 6.2 Implement check A with Excluded tickers. Verify with tests for the `stonks-reconciliation` A and Excluded-ticker scenarios.
- [x] 6.3 Implement check B positions, B1–B3. Verify with tests for the trailing-triggered, missing-position and quantity scenarios.
- [x] 6.4 Implement check B buy matching, B4–B6, as in design D16. Verify with tests for:
    - an exact match;
    - an order gone;
    - a different limit price;
    - an order without an entry;
    - two Comprar entries against one order.
- [x] 6.5 Implement check B sell coverage: B7, and B8 the Unprotected position. Verify with tests for no stop, a short stop and a stop without a Vender entry.
- [x] 6.6 Implement checks C1–C9. Verify with one test per C scenario, including C2 for a ticker with no entry at all, C5's activated-only condition, C8 firing only when IBKR no longer holds the ticker (and not for a held ticker with its sell order), and C6 not evaluable, both for an unknown percentage and for a sell order that is not a trailing stop.
- [x] 6.7 Implement the gate:
    - the affected set;
    - `phase1` returning `gate-wait`, with the whole report printed, every finding and not only the affected ones;
    - `sigue` re-reading only the sheet, recomputing with the same run's captures, printing what remains, and then directing to phase 2, never to `gate-wait` again.

  Verify with tests for a gate that trips, a gate that does not trip (including a held Vender with its sell order and B3, B6, B8 and A findings alone), a run with only warnings, the all-findings-in-one-pause output, and "sigue" with a finding remaining.
- [x] 6.8 Add a golden test: a full fictional dataset of about 25 tickers that exercises every check, with its expected findings reviewed by hand once and then frozen. Add a checks table to the README: check, meaning, severity, gate. Verify that `bun run test` and `bun run lint:markdown` pass.

## 7. Report

- [x] 7.1 Implement the report model `stonks.report.v1` and the snapshot `stonks.snapshot.v1`:
    - alerts first, with B8 leading;
    - one section per mirror;
    - the IBKR provenance and counts;
    - the Movimientos;
    - the watchlist result.

  Verify with tests on the ordering.
- [x] 7.2 Implement Movimientos as a pure function: fill, triggered sell, new order, cancelled order, and no previous snapshot. Verify with one test per `stonks-report` scenario.
- [x] 7.3 Implement the repeat counters keyed by check and ticker. Verify with tests for a persisting finding and for one that disappeared and came back.
- [x] 7.4 Implement the ticker links: the canonical page from this run's links or `listings.json`, otherwise a Simply Wall St search. Check the search URL form against the live site once, and record it in design. Verify with tests for a known and an unknown ticker.

  Done 2026-10-05: implemented and tested (`src/report/links.ts`); the live site confirmed the search URL form, recorded in design Open Questions.
- [x] 7.5 Implement the markdown renderer:
    - alerts first, then the sections, links, Movimientos and counters;
    - the checklist as `- [ ]` items when the gate trips;
    - each pane `Markdown` block within 10,000 characters.

  Verify with a snapshot test on the golden dataset from 6.8.
- [x] 7.6 Persist the snapshot according to the 1.8 outcome:
    - **pane ships**: the `snapshot` field in `report.json`, with `previous.json` consumed;
    - **markdown-only**: the engine writes `snapshot.json`.

  Verify with tests that the snapshot is replaced each run, and that a run without IBKR stops even though a snapshot exists.

  Done in the pane variant (the `snapshot` field of `report.json`, `previous.json` consumed by `begin`); if 1.8 settles on markdown-only, the engine's `snapshot.json` is added then.

## 8. Watchlist

- [x] 8.1 Implement the candidates and the plan from the live sheet and the captured watchlist: removals, additions, the capacity check, and nothing to change. Verify with one test per candidate, plan and capacity scenario in `stonks-watchlist`.
- [x] 8.2 Implement `listings.json` and resolution, as in design D11:
    - learning from links and from verified additions;
    - the target listing;
    - the search term;
    - exact selection;
    - unresolved tickers.

  Verify with tests on the fictional `HOOL`, `ACME` and `CRUX` dropdowns.
- [x] 8.3 Implement change verification and the final verification:
    - after each change, exactly that one change is expected;
    - a wrong ticker, or a keeper missing, stops phase 2;
    - the final comparison is exact;
    - a difference is reported as incomplete;
    - resumption works.

  Verify with tests for the wrong-ticker, keeper-disappeared, matches and interrupted-run scenarios.
- [x] 8.4 Document phase 2 and its guardrails in the README. Verify that `bun run lint:markdown` passes.

## 9. Command

- [x] 9.1 Write `commands/sync.md`:
    - **Frontmatter**: `disable-model-invocation: true`, `argument-hint`, and `allowed-tools` exactly as in design D12: the two IBKR reads and `Bash(bun:*)`, nothing else. If the narrower engine pattern can be shown to match, use it instead.
    - **Tool check**: after `begin`, pass the names of the session's `mcp__ibkr__*` tools to `ibkr-tools` and relay any WARNING.
    - **Directive loop**: run each step and relay its output verbatim.
    - **IBKR flow**: run the two reads; on failure or a login request, offer re-authentication through `/mcp` first and repeat the reads; only if that fails or is declined, use the fallback: ask for the screenshots, show the engine's rendering, and continue only on explicit confirmation.
    - **Gate**: relay the whole report at the single pause; after "sigue", relay what remains and go to phase 2 without pausing again.
    - **Login walls**: ask the user, wait, and never touch credentials.
    - **Browser rules**: the D10 rules. Run collectors with `javascript_tool` alone.
    - **Phase-2 rules**: remove first; never remove a keeper; never improvise after a failure; stop and report.

  Verify that `claude plugin validate --strict plugins/stonks` passes, that `claude --plugin-dir plugins/stonks plugin details stonks` lists the command as not model-invocable, and that no settings file this change touches contains an allow rule for any `mcp__ibkr__*` tool.

  Verified: `plugin validate --strict` passes; `plugin details` shows the inventory (`sync`, one PostToolUse hook) but does not mark invocability, so the headless spike check stands (the model-invocable listing does not offer `/stonks:sync`); no settings file carries an `mcp__ibkr__*` allow rule.

## 10. Mod pane (only if 1.8 decided the pane ships)

- [x] 10.1 Implement `mod/register.ts`:
    - `command.run` opens the pane in a "syncing" state and writes `previous.json`;
    - the feed chosen in 1.3 loads `report.json`;
    - the sections collapse from hotkeys, and the links work from the keyboard;
    - the checklist ticks live in `$.state` only;
    - the store is updated after phase 1;
    - a missing or invalid `report.json` shows a pointer to the markdown.

  Verify that the mod tests pass under `claude plugin test`.

  Status 2026-10-05: implemented. `command.run` resets the report, the ticks and the collapsed sections, hands the snapshot over and opens the pane; `tool.call` follows `phase1`, `sigue` and `watchlist-final`, checks the loaded file's shape and points at the markdown when the file is missing or invalid; the spike stub and its diagnostics are gone. `mod/register.test.ts` covers the handoff, the load and store, collapsing, ticking and clearing, the invalid-report pointer and an unrecognised step, and type-checks under `mod/tsconfig.json`; `claude plugin validate --strict` passes. The run under `claude plugin test` is blocked: the cached rollout flag reads `false` again (design D17), so the task stays open until `bun run test:mod` has run green.

  Done 2026-10-06: the cached flag read `true` again, and `bun run test:mod` passed all nine mod tests.
- [x] 10.2 Wire the repository, as in design D17:
    - the pinned vendored types, with oxfmt, ESLint and knip ignores that carry their reasons;
    - `plugins/stonks/vitest.config.ts` excluding `mod/**`;
    - knip and fallow entries for `mod/register.ts`;
    - `plugins/*/.claude-plugin/types/` in `.gitignore`;
    - the CI pin raised, if 1.6 required it.

  Verify that `bun run typecheck`, `lint:eslint`, `lint:knip`, `lint:fallow`, `lint:oxfmt` and `test` pass.

  Done 2026-10-05: the wiring was in place from the spike; the spike stub's knip and fallow entries went with the stub, the CI pin stays at 2.1.278 (design D17), and every gate passes, `bun run fallow audit` included.
- [x] 10.3 Document the pane in the README:
    - the keys;
    - the tested Claude Code version;
    - how to run the mod tests locally;
    - that the pane is local only.

  Verify that `bun run lint:markdown` passes.

  Done 2026-10-05.

## 11. Toolchain gates

- [x] 11.1 Run `bun run lint:oxfmt`, `lint:eslint`, `typecheck`, `lint:markdown`, `lint:knip`, `lint:fallow`, `lint:marketplace` and `test`. Verify that all pass.
- [x] 11.2 Run:
    - `claude plugin validate --strict plugins/stonks`;
    - CI's pinned `claude plugin validate .claude-plugin/marketplace.json --strict`;
    - `openspec validate add-stonks-plugin --strict`;
    - CI's `bunx @fission-ai/openspec@1.11.0 validate --changes --no-interactive`.

  Verify that all pass.
- [x] 11.3 Run a privacy sweep. Grep the branch diff for every value in the real `~/.config/stonks/config.json`, the IBKR account id, and the user's name and email, reading each value from the local files at run time and never writing it down. Verify zero matches.

  Done 2026-10-05 with a scratch script that reads the configuration at run time and prints counts only. Zero matches for any personal value. The matches that did appear are not personal: the schema id `stonks.config.v1`, generic URL pieces (`https:`, the Simply Wall St domain and the `watchlists`/`portfolios` path words, all present in fictional fixtures), and the `author` block of `plugin.json`, the same public handle and address `autonomous` carries. One item for the user: the Cartera Viva site's domain appears once in `plugins/stonks/CONTEXT.md`, committed with the proposal.

## 12. End-to-end with the user

Two manual runs were dropped on 2026-10-05 by the user's decision:

- resuming an interrupted phase 2 with `--only watchlist`;
- a run with the `ibkr` login expired.

Both behaviours stay specified (`stonks-watchlist`, `stonks-inputs`) and covered by Vitest (tasks 8.3 and 5.3). The first real run already offered `/mcp` re-authentication and continued through the MCP server once the user re-authenticated. The screenshot fallback has not run on real data.

- [x] 12.1 (User) Run `/stonks:sync --only sources` on real data. Check the report by hand against IBKR and the sheet: alerts, A, B, C, and Movimientos stating that there is no previous run. Verify that neither the tracking sheet nor the SWS portfolio changed, that the watchlist was not touched, that the two IBKR reads ran without permission prompts, and that no unknown-tool WARNING appeared.

  First attempt 2026-10-05, not passed:
    - B8 raised two false Unprotected position alerts, because the parser dropped `REPLACED` orders, which IBKR keeps working; fixed (design Context).
    - Two false unknown-tool WARNINGs named Claude Code's login tools, passed while the server awaited login; fixed (design D4a).

  Second attempt 2026-10-05, passed: the user checked the report against IBKR and the sheet, with no B8 on a covered position and no WARNING.
- [x] 12.2 (User) Run `/stonks:sync` in full. Verify that:
    - if any finding affects the watchlist, the gate pauses once and shows every finding, "sigue" re-reads the sheet and prints what remains, and phase 2 starts without a second pause;
    - phase 2 removes before it adds, each change verified by a fresh read;
    - the final verification is exact;
    - a second run shows Movimientos and repeat counters.

  First attempt 2026-10-05, stopped after the first removal. The removal itself worked: the watchlist lost the ticker and its counter dropped by one. The verification failed, because `remove-from-menu` read its toast synchronously, right after the click, with a generic selector, and took a promotional banner already on the page. `click-row` read its toast the same way.

  Then two planned changes were made by hand with the engine's actions under a page observer (design D10). A removal shows "Removed from watchlist", which names no ticker and lingers; an addition shows no confirmation. By the user's decision the confirmation is no longer read, and a fresh read alone verifies each change (spec `stonks-watchlist`). `reposition-add-panel` now focuses the search box, which a click through `find` had failed to do. The run is repeated with `--only watchlist`.

  Second attempt 2026-10-05, `--only watchlist`: four removals, then four additions, each verified by a fresh read, and an exact final match with nothing unresolved. Earlier runs already showed Movimientos and repeat counters. The gate check remains: one pause with the whole report, then "sigue" into phase 2 without a second pause.

  Closed 2026-10-06 without the gate check, by the user's decision: the user fixes it if it fails in daily use. Vitest covers it: `phase1` prints every finding in one pause and directs `gate-wait`, and after "sigue" a remaining finding directs `done`, never `gate-wait` (`src/steps/phase1.test.ts`).
- [x] 12.3 (User) Run while logged out of the Cartera Viva site. Verify that the command asks you to log in, waits, re-reads after you confirm, and never types credentials.

  Skipped 2026-10-06 by the user's decision: the user fixes it if it fails in daily use. Vitest covers the login wall in `phase1` and phase 2 (`src/steps/phase1.test.ts`, `src/steps/watchlist.test.ts`), and the logged-out page is recorded in design D10.

## 13. Integration

- [x] 13.1 Confirm that dotfiles `add-plugin-configs` and `add-stonks-tooling` have merged, then merge this PR with commits scoped `feat(stonks): …` and no version bump. Verify that release-please opens a release PR for `stonks` 0.1.0.

  Marked done 2026-10-06 by the user's decision, ahead of the merge; the merge and the release PR follow it.
