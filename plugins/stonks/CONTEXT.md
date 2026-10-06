# Stonks

The user's swing-trading bookkeeping: keeping every record of their portfolio
in agreement with their broker, and keeping their Simply Wall St watchlist in
step with what they track.

## Language

### Truth and mirrors

**IBKR**:
The user's Interactive Brokers account, the only source of truth for
positions and active orders.
_Avoid_: broker, cartera

**Position**:
A ticker the user holds shares of in IBKR.
_Avoid_: holding, inversión

**Active order**:
A live buy or sell order in IBKR, trailing stops included.
_Avoid_: orden pendiente

**Mirror**:
A record that replicates IBKR and must agree with it: the SWS portfolio and the
tracking sheet.
_Avoid_: source, fuente, excel

**SWS portfolio**:
The Simply Wall St portfolio the user maintains by hand to mirror their
positions, kept manual because it records data a broker sync does not.
_Avoid_: linked portfolio, synced portfolio

**Tracking sheet**:
The user's Google Sheet tab that lists one entry per row.
_Avoid_: spreadsheet, excel, la tabla

**Discrepancy**:
A ticker on which a mirror disagrees with IBKR, either missing from the mirror
or present in it without backing in IBKR.

**Unprotected position**:
A position whose Vender entries are not fully covered by IBKR sell orders: the
tracking sheet says a stop protects shares that no live order protects.
_Avoid_: orden sin respaldo, unbacked sell

**Excluded ticker**:
A position outside the swing strategy, such as a long-term ETF, that the
tracking sheet does not carry and its checks ignore.

### Entries and estados

**Trader**:
Roger, the swing trader whose trades the user follows.

**Cartera Viva**:
The trader's live portfolio as the trader publishes it on the trader's own
site, the only source of truth for what the trader holds and for the trader's
activated trailing stops.
_Avoid_: the site's name, cartera del trader

**Entry**:
One row of the tracking sheet: one lot of a ticker at one price level. A ticker
has several entries when it is bought in steps.
_Avoid_: línea, operación

**Estado**:
The status of one entry, one of the values below. Their Spanish spelling is
the data, not a translation.

**Invertido**:
The entry is bought; the user holds its shares.

**Comprar**:
A buy order is placed for the entry, at the entry's price.

**Vender**:
The user holds the entry's shares and a sell order, usually a trailing stop,
is placed on them.

**Operativa**:
The entry is under watch for the current session, with no order placed.

**En espera**:
The entry is parked: no position and no order.

**Roger**:
The trader holds the ticker at the entry's price and the user does not.

### Watchlist

**Watchlist**:
The Simply Wall St watchlist of tickers the user is waiting to enter. It holds
exactly the watchlist candidates.

**Watchlist candidate**:
A ticker of the tracking sheet whose every entry is Comprar, Roger or
Operativa. One entry in any other estado disqualifies the ticker.
_Avoid_: most permissive estado, last entry
