# IBKR fixtures

Every ticker, quantity, price, identifier and path in this folder is fictional.
The files mirror the `PostToolUse` payload and response shapes recorded at the
first IBKR connect on 2026-10-04. Trailing stops read `Trailing <amount> Stop
<price>, <tif>`, as observed; the percent form (`Trailing 12.50% Stop …` in
`orders.json` and `hook-orders.json`) is assumed, not observed.
