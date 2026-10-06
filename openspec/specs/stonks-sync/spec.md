# stonks-sync Specification

## Purpose

The `/stonks:sync` command. It is one user-invoked run that reports how the user's mirrors disagree with IBKR and then brings the Simply Wall St watchlist in step with the tracking sheet, with code making every decision and the LLM only driving the browser and calling MCP tools.

## Requirements

### Requirement: User-only command

The `stonks` plugin SHALL expose `/stonks:sync`. Only the user SHALL be able to start it; Claude SHALL NOT invoke it on its own initiative, whatever the conversation is about.

#### Scenario: User starts a sync

- **WHEN** the user types `/stonks:sync`
- **THEN** the sync runs

#### Scenario: Conversation about the portfolio

- **WHEN** the user asks Claude a question about their positions without typing the command
- **THEN** Claude does not start the sync

### Requirement: Phases and modes

A run SHALL consist of phase 1 (sources), then the gate, then phase 2 (watchlist). The command SHALL accept one optional argument, `--only` followed by `sources` or `watchlist`:

- `--only sources` runs phase 1 alone and ends after its report.
- `--only watchlist` runs phase 2 alone, without phase 1 and without the gate.

Any other argument SHALL be a usage error. On a usage error, nothing is read and nothing is written.

#### Scenario: Default run

- **WHEN** the user runs `/stonks:sync` with no argument
- **THEN** phase 1 runs, the gate is evaluated, and phase 2 runs unless the gate stops the run

#### Scenario: Sources only

- **WHEN** the user runs `/stonks:sync --only sources`
- **THEN** phase 1 runs and the run ends after the report, without touching the watchlist

#### Scenario: Watchlist only

- **WHEN** the user runs `/stonks:sync --only watchlist`
- **THEN** phase 1 does not run, the gate is not evaluated, and phase 2 runs

#### Scenario: Unknown mode

- **WHEN** the user runs `/stonks:sync --only portfolio`
- **THEN** the command prints the usage, reads no input and changes nothing

### Requirement: Phase 1 never writes

The command SHALL NOT write to IBKR, the tracking sheet, the SWS portfolio or the Cartera Viva, in any phase. The user fixes those sources by hand from the report. From IBKR, the command SHALL use only the reading of positions and the reading of orders, and SHALL NOT call any other IBKR tool, including the one that drafts order instructions.

#### Scenario: Discrepancy found

- **WHEN** phase 1 finds an entry in Invertido for a ticker that IBKR does not hold
- **THEN** the finding is reported and the tracking sheet is left unchanged

#### Scenario: Order drafting tool

- **WHEN** any run executes, whatever its findings
- **THEN** no IBKR tool other than the position and order reads is called

### Requirement: Gate between phases

After phase 1, the command SHALL evaluate the gate.

- **Gate trips.** If any finding affects the watchlist, as `stonks-reconciliation` defines, the command SHALL stop. The pause SHALL show the whole phase-1 report: every finding of every check, severity and ticker, not only the findings that tripped the gate. The affected tickers are listed and marked within it. The user can therefore fix everything in one go.
- **User replies "sigue".** The command SHALL re-read the tracking sheet live and recompute every check and the gate, using the IBKR, SWS portfolio and Cartera Viva data already read in the same run. It then prints what remains, in full, and continues to phase 2. The gate pauses a run exactly once; it never stops it again after "sigue", whatever remains.
- **User asks to stop.** The run ends without phase 2.
- **Gate does not trip.** If no finding affects the watchlist, the command SHALL continue to phase 2 without asking.

Warnings and informational findings SHALL never trip the gate. There is no separate command to resume after the gate: the user's reply continues the same run, and a run that ended before phase 2 is resumed with `/stonks:sync --only watchlist`.

#### Scenario: A finding affects the watchlist

- **WHEN** phase 1 reports a Roger entry for ticker `ACME` while `ACME` is not in the Cartera Viva
- **THEN** the command stops after the report, lists `ACME` as affected, and does not start phase 2

#### Scenario: All findings in one pause

- **WHEN** phase 1 finds a watchlist-affecting finding on `ACME`, a quantity mismatch on `GLBX`, a trailing mismatch warning on `INIT` and a missing-in-SWS Discrepancy on `HOOL`
- **THEN** the command pauses once and shows all four findings, and the user can fix every one of them before replying

#### Scenario: User fixes the sheet and continues

- **WHEN** the gate has stopped the run and the user, having edited the tracking sheet, says "sigue"
- **THEN** the tracking sheet is read again, the checks and the gate are recomputed with the new sheet, the recomputed findings are printed, and phase 2 starts from the new sheet

#### Scenario: User continues without fixing everything

- **WHEN** the gate has stopped the run and the user says "sigue" while a watchlist-affecting finding remains in the re-read sheet
- **THEN** the remaining finding is printed and phase 2 starts, without a second pause

#### Scenario: Only warnings

- **WHEN** phase 1 reports only a trailing mismatch warning and an informational pending buy
- **THEN** the command continues to phase 2 without asking

### Requirement: Stop conditions

The run SHALL stop, naming the cause, without producing a report from partial inputs and without starting phase 2, when any of the following happens:

- the configuration is invalid;
- the tracking sheet contains an unknown Estado or a row without a ticker;
- an input cannot be read or does not validate after its recovery path has been exhausted.

The recovery paths are logging in again after a login wall, and, for IBKR, re-authentication through `/mcp` followed by the confirmed screenshot fallback (see `stonks-inputs`).

#### Scenario: Unknown Estado

- **WHEN** row 17 of the tracking sheet has Estado `Vendido`
- **THEN** the run stops naming row 17 and the value `Vendido`; no report is produced and the watchlist is not touched

#### Scenario: Tracking sheet unreadable

- **WHEN** reading the tracking sheet fails because `gws` is not authorised
- **THEN** the run stops naming the tracking sheet and the cause; no report is produced and the watchlist is not touched

### Requirement: Pre-approved tools

The command SHALL pre-approve, for the duration of its own run, exactly these tools, and no others:

- the IBKR position read, `mcp__ibkr__get_account_positions`;
- the IBKR order read, `mcp__ibkr__get_account_orders`;
- the `bun` rule, `Bash(bun:*)`, which the engine needs because every step runs as `bun "${CLAUDE_PLUGIN_ROOT}/src/cli.ts" <step>`. It pre-approves any `bun` command for the duration of the run.

The plugin and the user's managed settings SHALL NOT add a global allow rule for any IBKR tool. The only IBKR rules in the managed settings SHALL be the existing denies of `mcp__ibkr__create_order_instruction` and `mcp__ibkr__delete_order_instruction`. Any other tool the run needs asks for permission as usual.

#### Scenario: IBKR reads without prompts

- **WHEN** the command calls the IBKR position read and the IBKR order read
- **THEN** neither call asks the user for permission

#### Scenario: Order instruction tools

- **WHEN** anything in a run tries to call `mcp__ibkr__create_order_instruction` or `mcp__ibkr__delete_order_instruction`
- **THEN** it is denied by the managed settings, and the command pre-approves neither
- **AND** `mcp__ibkr__get_order_instructions` is not pre-approved either, and the command never calls it

#### Scenario: Outside the command

- **WHEN** the user, in an ordinary conversation, makes Claude call an IBKR read
- **THEN** the permission rules of the user's settings apply, because the plugin adds no global allow

### Requirement: User configuration file

The personal values the command needs SHALL live in one JSON file outside the plugin, at `~/.config/stonks/config.json`, unless the environment variable `STONKS_CONFIG` names another path.

The file SHALL be identified by `schema: "stonks.config.v1"` and SHALL hold:

- the tracking sheet's spreadsheet id and tab name;
- the SWS portfolio URL;
- the watchlist's name and URL;
- the Cartera Viva URL;
- the list of Excluded tickers.

It SHALL carry no credentials.

The file SHALL be validated strictly before any input is read. A missing file, a missing field, a mistyped field or an unknown field SHALL be an error naming the path, never a default. The error for a missing file SHALL point to the example the plugin ships. That example SHALL hold placeholders only.

#### Scenario: Missing file

- **WHEN** no file exists at the resolved path
- **THEN** the run stops before reading any input, naming the path and the example

#### Scenario: Unknown field

- **WHEN** the file contains a field the schema does not define
- **THEN** the run stops naming that field's path

#### Scenario: Mistyped field

- **WHEN** `excludedTickers` is a string instead of a list
- **THEN** the run stops naming `$.excludedTickers`

### Requirement: Engine decides, command relays

Every deterministic part of a run SHALL be performed by the plugin's engine:

- parsing and validating inputs;
- every check;
- the gate;
- the watchlist plan and its verification;
- the report data and its markdown.

Claude's part SHALL be limited to calling the two IBKR read tools, driving the browser, transcribing IBKR screenshots in the fallback, and relaying the engine's output. Claude SHALL NOT recompute, reinterpret or summarise a result in place of the engine's output.

#### Scenario: Report relayed

- **WHEN** the engine prints the phase-1 report
- **THEN** the command shows it as printed, without adding or dropping findings

#### Scenario: Gate decided by the engine

- **WHEN** the engine reports that the gate does not trip
- **THEN** the command starts phase 2 without making its own assessment of the findings
