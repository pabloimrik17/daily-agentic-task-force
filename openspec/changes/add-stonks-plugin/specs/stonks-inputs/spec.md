# Spec Delta

## Purpose

Reading each input of a sync live, getting it to the engine verbatim without the LLM transcribing it, and validating it before any check uses it. The inputs are IBKR, the tracking sheet, the SWS portfolio, the Watchlist and the Cartera Viva.

## ADDED Requirements

### Requirement: Every input is read live

Every input a run uses SHALL be read during that run.

- Data from a previous run SHALL NOT be used as input to any check, the gate or the watchlist plan, and SHALL NOT replace an input that could not be read.
- The previous run's snapshot SHALL be used only for Movimientos and repeat counters (see `stonks-report`).
- Within one run, data read earlier in the same run MAY be reused. This happens after "sigue", which re-reads only the tracking sheet.

#### Scenario: Previous run's data present

- **WHEN** a run starts and data captured by the previous run is still on disk
- **THEN** that data is removed before any input is read and is never offered to a check

#### Scenario: Source cannot be read

- **WHEN** the Cartera Viva cannot be read in the current run
- **THEN** the run does not fall back to the Cartera Viva of an earlier run

### Requirement: Inputs reach the engine without transcription

The raw result of each IBKR read and of each browser collector SHALL reach the engine verbatim. It is captured from the tool's own result as the tool returns it, and Claude does not retype it.

Claude SHALL NOT write input data into a file, a command argument or the engine's standard input. The only exceptions are the confirmed IBKR screenshot fallback and the names of the available IBKR tools, which are not input data.

A captured browser result SHALL identify the collector that produced it and the run it belongs to. A result from another run SHALL be ignored.

#### Scenario: IBKR read through the MCP server

- **WHEN** Claude calls the IBKR position read
- **THEN** the engine receives the tool's response exactly as the tool returned it, without Claude restating any value

#### Scenario: Result from another run

- **WHEN** a captured collector result carries the identifier of a run other than the current one
- **THEN** the engine ignores it

### Requirement: Inputs are validated before use

Each input SHALL be validated against its expected shape before any check uses it. A missing field, a mistyped field or an unexpected shape SHALL make that input unreadable, naming the input and the field. It SHALL never be defaulted.

#### Scenario: IBKR order without a quantity

- **WHEN** an order in the IBKR order response has no quantity
- **THEN** the IBKR read is treated as failed, naming the field, and the screenshot fallback is offered

#### Scenario: Non-numeric quantity in the tracking sheet

- **WHEN** a tracking-sheet row has the text `dos` in Cantidad
- **THEN** the run stops naming the row and the value

### Requirement: IBKR read through its MCP server

IBKR positions and active orders SHALL be read through the IBKR MCP server registered as `ibkr`, with Claude Code as the MCP client. Only its position read and its order read SHALL be used.

From the order read, the engine SHALL derive, per active order:

- the ticker;
- the side;
- the quantity;
- the order type;
- the limit price, for a limit order;
- the trail percentage, for a trailing stop.

When the response does not expose a trailing stop's trail percentage, the percentage SHALL be recorded as unknown rather than guessed.

#### Scenario: Trailing stop with its percentage

- **WHEN** the order read returns a sell trailing stop on `WNYE` for 3 shares with a trail of 15%
- **THEN** the engine records a sell order on `WNYE`, quantity 3, type trailing stop, trail 15%

#### Scenario: Trail percentage not exposed

- **WHEN** the order read identifies a trailing stop but exposes no trail percentage
- **THEN** the order is recorded with an unknown trail percentage

### Requirement: IBKR re-authentication before the screenshot fallback

When an IBKR read fails or the MCP server asks for login, the command SHALL first say that IBKR could not be read and why, and offer to re-authenticate the `ibkr` server through `/mcp`. It SHALL pass the session's `mcp__ibkr__*` tool names to the engine again and repeat the reads once the user says they have re-authenticated. The screenshot fallback SHALL be used only if re-authentication fails or the user declines it.

#### Scenario: Login expired, user re-authenticates

- **WHEN** the IBKR position read fails because the server requires authentication, and the user re-authenticates through `/mcp`
- **THEN** the command repeats the reads, and the run continues with IBKR read through the MCP server and without screenshots

#### Scenario: Re-authentication fails

- **WHEN** the user's attempt to re-authenticate through `/mcp` does not restore the reads
- **THEN** the command falls back to the screenshots

#### Scenario: User declines re-authentication

- **WHEN** the user declines to re-authenticate
- **THEN** the command falls back to the screenshots

### Requirement: IBKR screenshot fallback requires confirmation

The fallback applies only after the re-authentication offer has failed or been declined, when an IBKR read fails, the MCP server asks for login, or the response does not validate. In that case the command SHALL:

1. Ask the user for screenshots of their positions and of their active orders.
2. Have Claude transcribe one table of positions and orders from the screenshots.
3. Pass the table to the engine, which validates it and renders it back.
4. Show the engine's rendering to the user.

The run SHALL continue only after the user explicitly confirms that rendering. A table the user rejects SHALL NOT be used. The user may then supply more or corrected screenshots.

The report SHALL state that IBKR came from user-confirmed screenshots.

#### Scenario: MCP server needs login

- **WHEN** the IBKR position read fails because the server requires authentication
- **THEN** the command explains the failure and offers re-authentication through `/mcp` first; it asks for screenshots only if that fails or is declined

#### Scenario: Table confirmed

- **WHEN** the user confirms the engine's rendering of the transcribed table
- **THEN** phase 1 continues with that table as IBKR, and the report marks IBKR as read from confirmed screenshots

#### Scenario: Table rejected

- **WHEN** the user says the rendered table is wrong
- **THEN** no check runs on it, and the command asks for corrected or additional screenshots

#### Scenario: Orders screenshot missing

- **WHEN** the screenshots show positions but no orders, and the user has not stated that no orders are active
- **THEN** the command asks for the orders screenshot before rendering the table

### Requirement: Unknown IBKR tools are reported

The engine SHALL hold the set of IBKR MCP tools known to exist: the catalog the `ibkr` server exposed at first connect, 34 tools, among them the two reads, the three order-instruction tools and the alert, watchlist and feedback mutations. At the start of every run, the command SHALL pass the names of the `mcp__ibkr__*` tools available in the session to the engine. If any is outside the known set, the engine SHALL print a WARNING naming it, and the report SHALL carry it. The warning SHALL NOT stop the run, trip the gate or change any check. The tool is never called.

`mcp__ibkr__authenticate` and `mcp__ibkr__complete_authentication` are Claude Code's own tools for a server that awaits login, not IBKR's, and SHALL NOT be reported. When they are the only `mcp__ibkr__*` names, the server's catalog is not visible yet: the engine SHALL say so, and after a re-authentication the command SHALL pass the names again, so that the check covers the catalog.

The check exists because the managed settings deny exactly two IBKR tools by name, while IBKR's authorisation already advertises an order-submission scope that no public tool uses yet. A new order-capable tool would otherwise go unnoticed.

#### Scenario: Known tools only

- **WHEN** the session exposes only tools of the recorded catalog
- **THEN** no warning is printed

#### Scenario: New tool appears

- **WHEN** the session exposes `mcp__ibkr__submit_order`, which the engine does not know
- **THEN** the run prints a WARNING naming `mcp__ibkr__submit_order`, the report carries it, the run continues, and the tool is not called

#### Scenario: Server awaiting login

- **WHEN** the session exposes only `mcp__ibkr__authenticate` and `mcp__ibkr__complete_authentication`, and the user then re-authenticates through `/mcp`
- **THEN** no WARNING is printed for those two names, the engine says the catalog is not visible yet, and the command passes the tool names again before repeating the reads

#### Scenario: Names are not input data

- **WHEN** the command passes the tool names to the engine
- **THEN** no check, gate or plan depends on them

### Requirement: Tracking sheet read through gws

The tracking sheet SHALL be read with the `gws` CLI under read-only access to spreadsheets. The read is addressed by the spreadsheet id and the tab name from the configuration, and returns unformatted values.

The CLI being missing, unauthorised or failing SHALL make the tracking sheet unreadable, naming the cause.

#### Scenario: gws missing

- **WHEN** `gws` is not on `PATH`
- **THEN** the run stops naming `gws` as missing

#### Scenario: Quantities as numbers

- **WHEN** the tab is read
- **THEN** Cantidad and `$/u` arrive as numbers, not as formatted currency strings

### Requirement: Tracking sheet parsing

The header of the tracking sheet SHALL be exactly `Ticker`, `Sector`, `Estado`, `Cantidad`, `$/u`, in that order. A different header SHALL stop the run, naming the expected and the found columns. Each further row is one Entry:

- **Sector** is ignored.
- **Rows** that are blank in every column are skipped.
- **Estado**, after trimming surrounding whitespace, SHALL be exactly one of `Invertido`, `Comprar`, `Vender`, `Operativa`, `En espera` or `Roger`. Any other value, including a blank Estado on a row that has a ticker, SHALL stop the run naming the row number and the value.
- **Ticker**: a non-blank row without a ticker SHALL stop the run, naming the row number.
- **Cantidad**: a blank value means zero shares.

#### Scenario: Unknown Estado

- **WHEN** row 9 holds ticker `GLBX` with Estado `Invertida`
- **THEN** the run stops naming row 9 and `Invertida`, with no report and no watchlist change

#### Scenario: Row without a ticker

- **WHEN** row 12 has Estado `Comprar` and no ticker
- **THEN** the run stops naming row 12

#### Scenario: Several entries for one ticker

- **WHEN** ticker `INIT` has one row in Invertido for 2 shares and one in Comprar for 1 share
- **THEN** both are kept as separate entries of `INIT`

#### Scenario: Moved columns

- **WHEN** the header reads `Ticker`, `Estado`, `Sector`, `Cantidad`, `$/u`
- **THEN** the run stops, naming the expected and the found header

### Requirement: SWS portfolio read

The SWS portfolio SHALL be read in the user's browser, from the URL in the configuration. Its tickers SHALL be derived only from the portfolio's holding entries, not from other text on the page. The number of tickers derived SHALL equal the holdings count the page itself shows; a difference SHALL make the SWS portfolio unreadable.

#### Scenario: Ticker mentioned outside the holdings

- **WHEN** the page footer mentions a ticker that is not a holding
- **THEN** that ticker is not part of the SWS portfolio

#### Scenario: Count disagrees

- **WHEN** the page shows 21 holdings and 20 tickers are derived
- **THEN** the SWS portfolio is reported as unreadable, naming both counts

### Requirement: Watchlist read

The Watchlist SHALL be read in the user's browser, from the URL in the configuration, which identifies the user's private watchlist; it SHALL NOT be made public to be read. The watchlist the page shows SHALL carry the name in the configuration. Otherwise the read SHALL be unreadable, so that no other watchlist is ever planned against. For every item, the read SHALL yield the exact `EXCHANGE:TICKER` listing, taken from the item's stock link or the page's embedded data. The read SHALL also yield the watchlist's current count and capacity as the page shows them.

#### Scenario: Another watchlist is open

- **WHEN** the page shows a watchlist whose name differs from the configured one
- **THEN** the watchlist read is unreadable, naming both names, and no change is planned

#### Scenario: Exchange-qualified items

- **WHEN** the watchlist holds Acme on NYSE
- **THEN** the read yields `NYSE:ACME` for that item

#### Scenario: Capacity

- **WHEN** the page shows the watchlist at 23 of 50
- **THEN** the read yields count 23 and capacity 50

### Requirement: Cartera Viva read

The Cartera Viva SHALL be read in the user's browser, from the URL in the configuration, and only from its Cartera Viva section. Other sections, such as recently closed positions, SHALL be ignored. Per ticker the read SHALL yield:

- the ticker;
- the Trader's average price;
- the Trader's trailing percentage when the trailing is activated, or that it is not activated.

#### Scenario: Trailing not activated

- **WHEN** a Cartera Viva card for `STRK` shows no activated trailing
- **THEN** `STRK` is read as held by the Trader with no activated trailing

#### Scenario: Closed positions section

- **WHEN** the page lists `UMBR` only among recently closed positions
- **THEN** `UMBR` is not part of the Cartera Viva

### Requirement: Login walls

A browser read may find the user logged out of Simply Wall St or of the Cartera Viva's site. In that case the command SHALL stop and ask the user to log in, and SHALL repeat that read only after the user says they have logged in. Claude SHALL never type, fill or submit credentials.

#### Scenario: Cartera Viva logged out

- **WHEN** the Cartera Viva read lands on a login page
- **THEN** the command asks the user to log in and waits, without reading any older Cartera Viva data

#### Scenario: User logged in

- **WHEN** the user says they have logged in
- **THEN** the Cartera Viva is read again and the run continues

### Requirement: Run data stays local and short-lived

Everything a run captures or derives SHALL be stored only on the local machine, outside any repository, and readable only by the user. This includes raw responses, collector results, the confirmed screenshot table and engine outputs. Starting a run SHALL remove what the previous run stored this way. Two things are kept, and neither is ever used as input: the previous-run snapshot (`stonks-report`) and the learnt listings (`stonks-watchlist`). Nothing captured during a run SHALL be published to a hosted service.

#### Scenario: New run starts

- **WHEN** a run starts
- **THEN** the raw data of the previous run is deleted before the first input is read
