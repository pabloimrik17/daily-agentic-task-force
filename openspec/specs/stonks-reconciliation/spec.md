# stonks-reconciliation Specification

## Purpose

The deterministic checks of phase 1. They compare each mirror with IBKR, and the tracking sheet with the Trader's Cartera Viva. They also classify every finding, which decides what is shown as an alert and what makes the gate stop before the watchlist is touched.

## Requirements

### Requirement: Terms used by the checks

The checks SHALL use these definitions:

- A ticker is **held** when IBKR reports a Position in it with a quantity above zero.
- The tracking sheet's **position** in a ticker is the sum of Cantidad over its entries in Invertido and Vender.
- A **live buy order** and a **live sell order** are Active orders in IBKR with that side.
- A ticker is **in the Cartera Viva** when the Cartera Viva read lists it.

Tickers SHALL be compared by symbol, after the normalisation described in the design. Exchange prefixes are ignored. Quantities SHALL be compared numerically, so fractional shares compare correctly.

#### Scenario: Several entries make one position

- **WHEN** ticker `INIT` has an Invertido entry of 2 shares and a Vender entry of 1 share
- **THEN** the tracking sheet's position in `INIT` is 3

### Requirement: Findings and their classification

Every check result SHALL be a finding. A finding carries:

- its check identifier;
- its ticker;
- what each side says;
- a severity;
- whether it affects the watchlist.

The severities are:

- **alert**: the Unprotected position only;
- **Discrepancy**;
- **warning**;
- **informational**;
- **not evaluable**.

The findings that affect the watchlist SHALL be exactly B1, B2, B4, B5, B7, C1, C2, C3, C7 and C8. No other finding SHALL trip the gate. In particular B3, B6, B8, every A finding, and every warning, informational and not-evaluable finding never trip it.

#### Scenario: Informational finding

- **WHEN** C4 fires for a ticker
- **THEN** the finding is informational and does not affect the watchlist

#### Scenario: Unprotected position

- **WHEN** B8 fires for a ticker
- **THEN** the finding is an alert and does not affect the watchlist

#### Scenario: Quantity or price mismatch

- **WHEN** B3 or B6 fires for a ticker
- **THEN** the finding is a Discrepancy and does not affect the watchlist

### Requirement: Excluded tickers

A ticker listed in the configuration's Excluded tickers SHALL be ignored by every tracking-sheet check, B and C. It SHALL still be part of check A, because the SWS portfolio mirrors IBKR fully.

#### Scenario: Excluded ticker held

- **WHEN** IBKR holds Excluded ticker `ETFX` and the tracking sheet has no entry for it
- **THEN** no B or C finding is produced for `ETFX`

#### Scenario: Excluded ticker missing from the SWS portfolio

- **WHEN** IBKR holds Excluded ticker `ETFX` and the SWS portfolio does not list it
- **THEN** an A1 finding is produced for `ETFX`

### Requirement: Check A, SWS portfolio against IBKR

The SWS portfolio's tickers SHALL be compared with the held tickers in both directions. Quantities SHALL NOT be compared.

- **A1, missing in SWS**: a held ticker that the SWS portfolio does not list. Discrepancy.
- **A2, extra in SWS**: an SWS portfolio ticker that is not held. Discrepancy.

#### Scenario: Sold but still in the SWS portfolio

- **WHEN** the SWS portfolio lists `TYRL` and IBKR does not hold it
- **THEN** an A2 Discrepancy is produced for `TYRL`

#### Scenario: Different quantities

- **WHEN** both hold `ACME`, in different quantities
- **THEN** no A finding is produced for `ACME`

### Requirement: Check B, positions

The tracking sheet's positions SHALL be compared with IBKR's:

- **B1, entry without position**: a ticker with entries in Invertido or Vender that is not held. Discrepancy, affects the watchlist. This includes a Vender entry with neither a Position nor a live sell order, which means the trailing stop triggered and the shares were sold. That case is an ordinary Discrepancy, not an alert.
- **B2, position without entry**: a held ticker with no entry in Invertido or Vender. Discrepancy, affects the watchlist.
- **B3, quantity mismatch**: a held ticker whose tracking-sheet position differs from IBKR's quantity. Discrepancy.

#### Scenario: Trailing triggered

- **WHEN** ticker `WNYE` has a Vender entry of 3 shares, IBKR holds no `WNYE` and no live order on it
- **THEN** a B1 Discrepancy is produced for `WNYE`, and no alert

#### Scenario: Position missing from the sheet

- **WHEN** IBKR holds 2 `HOOL` and every `HOOL` entry is in Comprar
- **THEN** a B2 Discrepancy is produced for `HOOL`

#### Scenario: Quantities differ

- **WHEN** IBKR holds 2 `GLBX` and the tracking sheet's position in `GLBX` is 1
- **THEN** a B3 Discrepancy is produced for `GLBX`, stating both quantities

### Requirement: Check B, buy orders

Per ticker, the Comprar entries SHALL be matched one-to-one with the live buy orders. A pair matches when the quantity is equal and the order's limit price equals the entry's `$/u`. After the exact matches are removed, what remains on each side is reported:

- **B6, buy order mismatch**: a remaining entry paired with a remaining order on the same ticker, as many pairs as both sides allow. Discrepancy, stating both quantities and both prices.
- **B4, Comprar without order**: each remaining entry left unpaired. Discrepancy, affects the watchlist. Its order was filled or cancelled.
- **B5, buy order without entry**: each remaining order left unpaired. Discrepancy, affects the watchlist.

#### Scenario: Order matches

- **WHEN** `CYBD` has a Comprar entry of 1 at 42.00 and a live buy order of 1 limited at 42.00
- **THEN** no B4, B5 or B6 finding is produced for `CYBD`

#### Scenario: Order gone

- **WHEN** `CYBD` has a Comprar entry of 1 at 42.00 and no live buy order
- **THEN** a B4 Discrepancy is produced for `CYBD`

#### Scenario: Different limit price

- **WHEN** `CYBD` has a Comprar entry of 1 at 42.00 and a live buy order of 1 limited at 41.50
- **THEN** a B6 Discrepancy is produced for `CYBD`, stating 42.00 and 41.50

#### Scenario: Order without entry

- **WHEN** IBKR has a live buy order on `VNDL` and the tracking sheet has no Comprar entry for `VNDL`
- **THEN** a B5 Discrepancy is produced for `VNDL`

### Requirement: Check B, sell orders and the Unprotected position

Per ticker, the total quantity of the live sell orders SHALL be compared with the total Cantidad of the Vender entries. Prices SHALL NOT be compared, because `$/u` on a Vender entry is the entry price, not the stop.

- **B8, Unprotected position**: a held ticker whose live sell orders cover fewer shares than its Vender entries, including the case of no sell order at all. Alert. It is shown before every other finding.
- **B7, sell orders beyond Vender entries**: a ticker whose live sell orders cover more shares than its Vender entries, including a sell order on a ticker with no Vender entry. Discrepancy, affects the watchlist.

#### Scenario: No stop behind a Vender entry

- **WHEN** IBKR holds 3 `STRK`, the tracking sheet has a Vender entry of 3 `STRK`, and there is no live sell order on `STRK`
- **THEN** a B8 alert is produced for `STRK`

#### Scenario: Partly sold Vender lot

- **WHEN** IBKR holds 2 `STRK`, the Vender entries total 3 because the sheet has not caught up with a partial sale, and the live sell orders total 2
- **THEN** a B8 alert is produced for `STRK`, next to its B3 Discrepancy, because the condition is read literally: held, and sell cover below the Vender total

#### Scenario: Stop covering fewer shares

- **WHEN** IBKR holds 3 `STRK`, the Vender entries total 3, and the live sell orders total 2
- **THEN** a B8 alert is produced for `STRK`, stating 3 and 2

#### Scenario: Stop without a Vender entry

- **WHEN** IBKR holds 2 `ACME`, has a live sell order of 2 on it, and `ACME`'s entries are all in Invertido
- **THEN** a B7 Discrepancy is produced for `ACME`

### Requirement: Check C, tracking sheet against the Cartera Viva

At ticker level, the tracking sheet and the IBKR holdings SHALL be compared with the Cartera Viva:

- **C1, stale Roger**: a ticker with an entry in Roger that is not in the Cartera Viva; the Trader exited. Discrepancy, affects the watchlist.
- **C2, should be Roger**: a ticker in the Cartera Viva that is not held and has no entry in Roger, Comprar, Invertido or Vender. This includes a ticker with no entry at all. The Trader entered and the user did not. Discrepancy, affects the watchlist.
- **C3, sold while the Trader is still in**: a ticker in the Cartera Viva that is not held but still has entries in Invertido or Vender. Those entries should become Roger. Discrepancy, affects the watchlist.
- **C4, pending buy with the Trader in**: a ticker in the Cartera Viva with a Comprar entry and a live buy order. Informational.
- **C5, missing own trailing**: a held ticker in the Cartera Viva whose Trader's trailing is activated, that has entries in Invertido, no entry in Vender and no live sell order. The user should place their own trailing stop and move the entry to Vender. Warning. It SHALL fire only when the Trader's trailing is activated.
- **C6, trailing mismatch**: a held ticker in the Cartera Viva whose Trader's trailing is activated, where the user's live trailing sell order has a different trail percentage. Warning. The engine SHALL NOT adjust anything. If the user's trail percentage is unknown, or the user's sell order is not a trailing stop, C6 SHALL be reported as not evaluable for that ticker, with the reason.
- **C7, the Trader exited, the user is still in**: a held ticker with an entry in Invertido that is not in the Cartera Viva. It should be in Vender. Discrepancy, affects the watchlist.
- **C8, Vender with the Trader out**: a ticker with an entry in Vender that is not in the Cartera Viva and that IBKR no longer holds. It has been sold and the sheet is behind. Discrepancy, affects the watchlist. C8 SHALL NOT fire while IBKR still holds the ticker, whether or not a sell order is live: a ticker still held with its sell order is the user's trailing stop doing its work, and one held without enough cover is B8's alert.
- **C9, live buy on a ticker the Trader is not in**: a ticker not in the Cartera Viva that has a Comprar entry or a live buy order. Informational.

#### Scenario: Trader exited a Roger

- **WHEN** `UMBR` has an entry in Roger and is not in the Cartera Viva
- **THEN** a C1 Discrepancy is produced for `UMBR`

#### Scenario: Trader entered a ticker under watch

- **WHEN** `HOOL` is in the Cartera Viva, is not held, and all its entries are in Operativa
- **THEN** a C2 Discrepancy is produced for `HOOL`

#### Scenario: Trailing triggered while the Trader stays

- **WHEN** `WNYE` is in the Cartera Viva, is not held, and has a Vender entry
- **THEN** a C3 Discrepancy is produced for `WNYE`, along with the B1 Discrepancy

#### Scenario: Trader's trailing not activated

- **WHEN** `GLBX` is in the Cartera Viva without an activated trailing, and the user holds it in Invertido with no sell order
- **THEN** no C5 finding is produced for `GLBX`

#### Scenario: Trail percentages differ

- **WHEN** the Trader's trailing on `INIT` is activated at 10% and the user's live trailing sell order on `INIT` trails at 15%
- **THEN** a C6 warning is produced for `INIT`, stating 10% and 15%, and no order is changed

#### Scenario: Trail percentage unknown

- **WHEN** the Trader's trailing on `INIT` is activated and the user's trailing sell order on `INIT` has an unknown trail percentage
- **THEN** C6 is reported as not evaluable for `INIT`

#### Scenario: Vender sold, Trader out

- **WHEN** `WNYE` has a Vender entry, is not in the Cartera Viva, and IBKR holds no `WNYE`
- **THEN** a C8 Discrepancy is produced for `WNYE`, along with the B1 Discrepancy

#### Scenario: Vender still held with its stop

- **WHEN** `STRK` has a Vender entry of 3, is not in the Cartera Viva, IBKR holds 3 `STRK` and has a live sell order of 3 on it
- **THEN** no C8 finding is produced for `STRK`, and the gate is not tripped by it

#### Scenario: No sheet entry still counts for C2

- **WHEN** `CRUX` is in the Cartera Viva, is not held, and has no entry in the tracking sheet at all
- **THEN** a C2 Discrepancy is produced for `CRUX`

#### Scenario: Trader exited a held ticker

- **WHEN** IBKR holds `TYRL`, `TYRL` has an Invertido entry, and it is not in the Cartera Viva
- **THEN** a C7 Discrepancy is produced for `TYRL`

#### Scenario: Pending buy on a ticker the Trader is not in

- **WHEN** `VNDL` is not in the Cartera Viva and has a live buy order
- **THEN** a C9 informational finding is produced for `VNDL`
