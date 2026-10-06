# stonks-report Specification

## Purpose

What the user sees after a sync: alerts first, the findings for each mirror, movements since the previous run, persisting findings and a checklist for the fixes. The report is drawn in a local pane when possible and is always printed as markdown.

## Requirements

### Requirement: Report content and order

The phase-1 report SHALL present, in this order:

1. **Alerts**, with every Unprotected position before anything else.
2. **One section per mirror**: SWS portfolio, tracking sheet, Cartera Viva. Each lists its findings with their severity, or states that the mirror agrees.
3. **Movimientos** since the previous run.

It SHALL also state how IBKR was read (MCP server, or user-confirmed screenshots) and the counts read: IBKR positions, IBKR active orders, SWS portfolio tickers and Cartera Viva tickers. It SHALL carry any unknown-IBKR-tool WARNING of the run (`stonks-inputs`).

When phase 2 runs, the report SHALL add its result as `stonks-watchlist` defines it.

#### Scenario: Unprotected position present

- **WHEN** phase 1 finds an Unprotected position on `STRK` and Discrepancies on other tickers
- **THEN** the `STRK` alert is the first item of the report

#### Scenario: Mirror in agreement

- **WHEN** check A produces no finding
- **THEN** the SWS portfolio section states that it agrees with IBKR

### Requirement: Tickers link to Simply Wall St

Every ticker in the report SHALL link to its Simply Wall St page when that page's address is known from Simply Wall St links read in this run or learnt in an earlier one. Otherwise it SHALL link to a Simply Wall St search for the ticker.

#### Scenario: Known page

- **WHEN** the report mentions `ACME`, whose stock link was read from the SWS portfolio
- **THEN** `ACME` links to that page

#### Scenario: Unknown page

- **WHEN** the report mentions `CRUX` and no Simply Wall St link for it has ever been read
- **THEN** `CRUX` links to a Simply Wall St search for `CRUX`

### Requirement: Movimientos

The report SHALL list the movements between the previous run's IBKR positions and orders and the current ones, stating the date of the previous run:

- **Fill**: a Position that is new or has grown, together with the live buy order that disappeared.
- **Triggered trailing stop or sell**: a Position that shrank or closed while a live sell order on it disappeared.
- **New order**: an Active order not present before.
- **Cancelled order**: an Active order that disappeared without a matching change in the Position.

With no previous snapshot, the report SHALL say there is no previous run to compare with.

#### Scenario: Trailing stop triggered

- **WHEN** the previous run had 3 `WNYE` held with a live sell order of 3, and now IBKR holds no `WNYE` and has no order on it
- **THEN** Movimientos lists a triggered sell of 3 `WNYE`

#### Scenario: Buy filled

- **WHEN** the previous run had a live buy order of 1 `CYBD` and no `CYBD` held, and now IBKR holds 1 `CYBD` and the order is gone
- **THEN** Movimientos lists a fill of 1 `CYBD`

#### Scenario: Order cancelled

- **WHEN** a live buy order on `VNDL` present in the previous run is gone and the `VNDL` Position is unchanged
- **THEN** Movimientos lists the `VNDL` order as cancelled

#### Scenario: First run

- **WHEN** no previous snapshot exists
- **THEN** Movimientos states that there is no previous run to compare with

### Requirement: Repeat counters

Every finding SHALL carry the number of consecutive runs, the current one included, in which the same check has produced a finding for the same ticker. A run in which the finding is absent SHALL reset its count.

#### Scenario: Persisting trailing mismatch

- **WHEN** the C6 warning on `INIT` was produced in each of the two previous runs and is produced again
- **THEN** the finding shows 3 consecutive runs

#### Scenario: Finding resolved and back

- **WHEN** a finding was absent from the previous run and appears again
- **THEN** its count is 1

### Requirement: In-run checklist

When the gate stops the run, the report SHALL show every finding of phase 1, and SHALL include a checklist of the findings that affect the watchlist. The user can tick items while fixing the tracking sheet. Ticks SHALL NOT be stored beyond the run and SHALL NOT influence any result: after "sigue", every finding is recomputed from the re-read sheet.

#### Scenario: Items ticked, then "sigue"

- **WHEN** the user has ticked every checklist item and says "sigue" without having changed one of the entries
- **THEN** the recomputed report still shows the finding for that entry

#### Scenario: Next run

- **WHEN** a new run starts
- **THEN** no item of an earlier checklist is shown as ticked

### Requirement: Markdown report always printed

Every run SHALL print the report as markdown through the command, whether or not a pane is shown. The markdown SHALL carry every report element except the interactive behaviour: alerts, sections, links, Movimientos, counters, and the checklist as unticked items. A run SHALL therefore remain fully usable when the pane cannot be drawn, including when mods are disabled, the surface does not draw panes, or the pane fails.

#### Scenario: Pane unavailable

- **WHEN** the pane fails to open during a run
- **THEN** the markdown report is printed complete and the run proceeds normally

### Requirement: Report pane

When the user runs `/stonks:sync` in a terminal or in the Desktop app's Code tab, the plugin SHALL open a pane above the prompt, or beside it where the layout docks panes. The pane SHALL draw the same report as the markdown, with:

- one collapsible section per mirror;
- ticker links that can be followed from the keyboard;
- the in-run checklist, tickable.

Each run's report SHALL replace the previous one in the pane.

#### Scenario: Run in the terminal

- **WHEN** the user runs `/stonks:sync` in a terminal session inside tmux
- **THEN** a pane shows the report, and its sections can be collapsed and expanded from the keyboard

### Requirement: Report stays on the machine

The report and its data SHALL NOT be published to any hosted page or service, Artifacts included. They SHALL exist only in the session, the local pane and local storage.

#### Scenario: Report produced

- **WHEN** a run produces its report
- **THEN** no part of it is uploaded to a hosted page

### Requirement: Previous-run snapshot

After phase 1, the report component SHALL keep on the local machine a snapshot of the current run, replacing any earlier one. The snapshot holds:

- the date;
- IBKR Positions and Active orders;
- the identifier and repeat count of every finding.

When the pane ships, this snapshot SHALL live in the pane's own persistent store. In the markdown-only variant, the engine SHALL keep it in the plugin's local state directory. The snapshot SHALL be used only to compute Movimientos and repeat counters, never as input to a check, the gate or the watchlist plan. No earlier snapshot or browsable history SHALL be kept.

#### Scenario: Snapshot replaced

- **WHEN** a run completes phase 1
- **THEN** its snapshot replaces the previous one, and only the new one remains

#### Scenario: Snapshot never substitutes an input

- **WHEN** IBKR cannot be read and the user provides no confirmed screenshots
- **THEN** the run stops, and the snapshot's Positions are not used in place of IBKR
