# stonks-watchlist Specification

## Purpose

Phase 2 of a sync. It makes the user's private Simply Wall St watchlist hold exactly the Watchlist candidates of the tracking sheet, applying the changes without asking, under guardrails that never remove a keeper and never add the wrong listing.

## Requirements

### Requirement: Watchlist candidates

A ticker SHALL be a Watchlist candidate when it has at least one entry in the tracking sheet and every one of its entries is in Comprar, Roger or Operativa. A single entry in any other Estado SHALL disqualify the ticker. A ticker absent from the tracking sheet SHALL NOT be a candidate. The desired watchlist SHALL be exactly the candidate set, computed from a tracking sheet read live when phase 2 plans.

#### Scenario: All entries qualify

- **WHEN** `HOOL` has one entry in Roger and one in Operativa
- **THEN** `HOOL` is a Watchlist candidate

#### Scenario: One entry disqualifies

- **WHEN** `ACME` has entries in Roger, Comprar and Invertido
- **THEN** `ACME` is not a Watchlist candidate

#### Scenario: Ticker not in the sheet

- **WHEN** the watchlist holds `OSCP` and the tracking sheet has no entry for `OSCP`
- **THEN** `OSCP` is not desired and is planned for removal

### Requirement: Plan from the real watchlist

Phase 2 SHALL start by reading the real watchlist and SHALL plan from that read, never from a list remembered from an earlier run. Tickers SHALL be compared by symbol:

- the removals are the watchlist tickers that are not desired;
- the additions are the desired tickers that the watchlist lacks.

The command SHALL announce the plan and apply it in the same run without asking for confirmation: invoking the command is the user's authorisation.

#### Scenario: Watchlist changed since the last run

- **WHEN** the previous run ended with `GLBX` on the watchlist and the user has since removed it by hand, while `GLBX` is still desired
- **THEN** the plan adds `GLBX`

#### Scenario: Nothing to change

- **WHEN** the real watchlist already equals the desired set
- **THEN** no change is made and the report says the watchlist is in step

### Requirement: Remove first, then add, within capacity

Every planned removal SHALL be applied before any addition. The capacity SHALL be the one the watchlist page shows. If the desired set is larger than the capacity, phase 2 SHALL make no change at all and SHALL report both numbers.

#### Scenario: Full watchlist

- **WHEN** the watchlist is at 50 of 50 and the plan removes 2 tickers and adds 2
- **THEN** both removals are applied before the first addition

#### Scenario: Desired set exceeds capacity

- **WHEN** 52 tickers are desired and the capacity is 50
- **THEN** no ticker is removed or added, and the report states 52 and 50

### Requirement: Additions use the exact listing

Each addition SHALL be resolved to one exact `EXCHANGE:TICKER` listing, preferring the US primary listing (NYSE or a Nasdaq tier). The command SHALL search Simply Wall St by company name and SHALL select only the search result whose exchange-qualified symbol equals the resolved listing.

- The command SHALL NOT take the first result, a result whose ticker merely starts with or resembles the wanted one, or a result chosen by screen position alone.
- When no result matches exactly, or only a non-US listing exists, the ticker SHALL NOT be added. It SHALL be reported as unresolved, and the command SHALL ask the user for the exact listing.

#### Scenario: Similar tickers in the results

- **WHEN** adding `HOOL`, and the search shows `NYSE:HOO`, `LSE:HOOLA` and `NasdaqGS:HOOL`
- **THEN** `NasdaqGS:HOOL` is selected and the other results are not

#### Scenario: Several listings of one company

- **WHEN** adding `ACME`, and the search shows `TSX:ACME` first and `NYSE:ACME` among its other listings
- **THEN** `NYSE:ACME` is selected

#### Scenario: No exact match

- **WHEN** adding `CRUX`, and no search result is exactly `CRUX` on a US exchange
- **THEN** `CRUX` is not added, it is reported as unresolved, and the user is asked for its exact listing

### Requirement: Every change is verified

After each removal and each addition, the command SHALL check that a fresh read of the watchlist differs from the previous read by exactly that change. Simply Wall St's confirmations name no ticker, so they SHALL NOT be taken as proof of a change.

Any other outcome SHALL stop phase 2 at once and report the difference. Other outcomes include a different ticker added, an extra ticker removed, or a ticker missing that should stay. The command SHALL NOT try to repair the difference by experimenting on the watchlist.

#### Scenario: Wrong ticker added

- **WHEN** after selecting `NasdaqGS:HOOL` the fresh read shows `HOO` added and `HOOL` absent
- **THEN** phase 2 stops and the report states that `HOO` was added instead of `HOOL`

#### Scenario: Keeper disappeared

- **WHEN** the fresh read after removing `OSCP` shows that `GLBX`, a desired ticker, is also gone
- **THEN** phase 2 stops and the report names `GLBX` as missing

### Requirement: Never remove a keeper

The command SHALL remove only tickers in the plan's removals. It SHALL NOT remove a desired ticker for any purpose, not even temporarily to diagnose the page, discover how it works or test a recipe.

#### Scenario: Diagnosing a failing removal

- **WHEN** removing `OSCP` fails and the command investigates the page
- **THEN** no desired ticker is removed during the investigation

### Requirement: Final verification and resumption

At the end of phase 2 the command SHALL read the watchlist again and compare its ticker set with the desired set exactly. The report SHALL list:

- the tickers removed;
- the tickers added;
- any ticker left unresolved;
- the final list;
- the count against the capacity.

A difference SHALL be reported as an incomplete watchlist, naming the tickers. Because phase 2 always plans from the live tracking sheet and the live watchlist, running `/stonks:sync --only watchlist` again SHALL resume an interrupted phase 2 without repeating the changes already made.

#### Scenario: Watchlist matches

- **WHEN** the final read equals the desired set
- **THEN** the report shows the removals, the additions and the final list with its count and capacity

#### Scenario: Interrupted run resumed

- **WHEN** a previous phase 2 stopped after the removals and one of three additions, and the user runs `/stonks:sync --only watchlist`
- **THEN** the plan holds only the two missing additions
