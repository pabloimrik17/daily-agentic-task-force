---
description: Reconcile the mirrors against IBKR and bring the Simply Wall St watchlist in step with the tracking sheet
argument-hint: "[--only sources|watchlist]"
disable-model-invocation: true
allowed-tools: mcp__ibkr__get_account_positions, mcp__ibkr__get_account_orders, Bash(bun:*)
---

# stonks-sync

The engine decides everything. This command runs one engine step at a time,
relays what it prints, drives the browser and the two IBKR reads, and asks the
user the questions a directive requires. You never parse, compare, recompute
or judge a result.

## Running a step

Every step is:

```bash
bun "${CLAUDE_PLUGIN_ROOT}/src/cli.ts" <step> [args]
```

A step prints markdown, a blank line, then `directive: <JSON>`.

- Relay the markdown verbatim. Never summarise it, reorder it, or add or drop a finding.
- Read the last `directive:` line and follow it (see Directives).
- A step that exits 1 is a usage error. Show its stderr and stop.
- Add nothing of your own to the report beyond the questions the directives require.

Start with `begin $ARGUMENTS`. The engine reads the tracking sheet itself;
you do nothing for it.

## After `begin` (directive `done`)

`begin` lists the reads of this run. Do them in this order.

1. Tool check. Run `ibkr-tools <name>…` with the name of every `mcp__ibkr__*` tool available in this session. Relay any WARNING. Never call a tool the engine does not know.
2. Call `mcp__ibkr__get_account_positions`, then `mcp__ibkr__get_account_orders`. Call no other tool of the `ibkr` server, ever. `create_order_instruction` and `delete_order_instruction` are denied; never attempt them.
3. For each collector `begin` lists (`sws-portfolio`, `cartera-viva`), follow the Browser rules, then run `collector <name>` and pass the exact source it prints to `javascript_tool`.
4. Run `phase1`.

With `--only watchlist`, `begin` lists the tracking sheet and the watchlist collector. Run `collector watchlist` through `javascript_tool`, then `watchlist-plan`.

A hook captures every IBKR read and every collector result. Never retype a result, and never pass one to the engine.

## Directives

- `done` after `phase1` or `sigue`: with `--only sources`, run `end` and finish. Otherwise run `collector watchlist`, then `watchlist-plan`.
- `ibkr-reauth`: the markdown says why IBKR could not be read. Explain it and offer to re-authenticate through `/mcp`. Wait. When the user says it is done, run `ibkr-tools` again with the name of every `mcp__ibkr__*` tool now in this session, call the two reads again and run `phase1` again. If the user declines, run `phase1` again at once.
- `ibkr-fallback`: ask for screenshots of the positions and of the active orders. Transcribe them into the JSON below and pipe it to the engine. Then relay the engine's rendering and ask the user to confirm it.
    - On explicit confirmation, run `ibkr-screenshots-confirm`, then `phase1`.
    - On rejection, ask for corrected screenshots and stage again.
    - Never continue without that confirmation.
- `gate-wait`: the whole report is already relayed. Tell the user to fix the tracking sheet and reply "sigue", or to stop. On "sigue", run `sigue`, relay what remains, and continue to phase 2 without pausing again. On a stop, run `end`.
- `ask-login <source>`: ask the user to log in to that site. Wait for their reply. Run that source's collector again, then run again the step that asked. Never type credentials, and never touch a login form.
- `remove <T>`: run the browser steps the markdown lists for T, in order: `action watchlist-row-menu <index> <path>`, `action remove-from-menu`, `collector watchlist`, then `watchlist-verify`.
- `add <T>` from `watchlist-plan`, `watchlist-verify` or an unresolved `watchlist-resolve`: run `watchlist-search T`, then the browser steps it lists, then `collector dropdown`, then `watchlist-resolve T`.
- `add <T>` from a selected `watchlist-resolve`: run `action click-row <index> <listing>` as told, then `collector watchlist`, then `watchlist-verify`.
- When `watchlist-row-menu`, `remove-from-menu` or `click-row` answers `done: false`, that is a stop: relay its reason, run `end`, and finish. Run none of the steps after it.
- `done` from `watchlist-plan`, `watchlist-verify` or `watchlist-resolve`: run `collector watchlist`, then `watchlist-final`.
- `done` from `watchlist-final`: run `end` and finish.
- `stop <reason>`: relay the reason, run `end`, and finish.
- `done` from any other step: continue with the step the markdown names.

## IBKR screenshots JSON

Write one object. Pipe it to the engine through a heredoc on stdin:

```bash
bun "${CLAUDE_PLUGIN_ROOT}/src/cli.ts" ibkr-screenshots-stage <<'JSON'
{
  "schema": "stonks.ibkr-screenshots.v1",
  "positions": [
    [{ "ticker": "HOOL", "quantity": 8 }, { "ticker": "ACME", "quantity": 2.5 }],
    [{ "ticker": "ACME", "quantity": 2.5 }, { "ticker": "STRK", "quantity": 3 }]
  ],
  "orders": [
    [{ "ticker": "HOOL", "side": "sell", "quantity": 8, "orderType": "trailing-stop", "limitPrice": null, "trailPercent": 12.5 }]
  ],
  "noActiveOrders": false
}
JSON
```

- `positions` holds one array per screenshot, top to bottom. Include the rows two screenshots share.
- `orders` holds one array per screenshot. Set `orders: null` and `noActiveOrders: true` only if the user states that no orders are active.
- `side` is `buy` or `sell`. `limitPrice` and `trailPercent` are a number or `null`.
- Copy what the screenshots show. Do not infer, complete or correct a value.

## Browser rules

- At the start of each site, call `tabs_context_mcp` with `{createIfEmpty: true}`, then `navigate` afresh to the URL `begin` lists for that site. Never reuse a tab left from an earlier run.
- Poll for readiness instead of waiting a fixed time. When a collector's result shows `"loading": true`, run that collector again.
- Never scroll the watchlist page. It renders black.
- Open a row's menu only through `action watchlist-row-menu <index> <path>`, exactly as the engine printed it. It refuses a row that no longer links to that path.
- Open and reposition the Add stock search box through `action reposition-add-panel`. When it answers that the box is not open yet, run it once more.
- Type the search term with real keystrokes (`computer` `type`) once `action reposition-add-panel` has answered `done`: it leaves the search box focused. Synthetic input events do not reach it. Run `collector dropdown` once the results show, not while they load.
- Click a search result only through the engine's `action click-row <index> <listing>`, exactly as printed. It refuses a row that no longer shows that listing. Never click by screen coordinates.
- Run each collector and action with `javascript_tool` alone, one call per source, with the exact source the engine printed. Never put one inside `browser_batch`, and never edit it.

## Phase 2

`collector watchlist`, then `watchlist-plan`, then the loop of `remove T` and `add T` directives until `done`: search, dropdown collector, resolve, click-row, `collector watchlist`, verify. On `done`, `watchlist-final`, then `end`.

- The engine removes first, then adds. Follow its order.
- Never remove a keeper, not even to diagnose the page.
- Never improvise after a failure: no repair, no retry of a different recipe. Relay the reason, run `end`, and finish.
- When the engine marks a ticker unresolved, relay the question for its exact listing. Do not pick a listing yourself.
- The search term is only a hint. The engine selects the listing.
