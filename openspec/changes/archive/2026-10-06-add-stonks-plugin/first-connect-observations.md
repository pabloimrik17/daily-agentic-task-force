# IBKR first-connect handoff

Recorded on 2026-10-04 during dotfiles `add-stonks-tooling` acceptance.
Only tool metadata and field names are retained. No account identifiers,
tickers, quantities, prices or response captures are included.

## Confirmed access and guards

- The official `ibkr` HTTP server is connected through Claude Code OAuth.
- The user confirmed successful reads with
  `mcp__ibkr__get_account_positions` and `mcp__ibkr__get_account_orders`.
- The dotfiles settings now deny exactly
  `mcp__ibkr__create_order_instruction` and
  `mcp__ibkr__delete_order_instruction`. Both rules were confirmed under Deny
  in a new Claude Code session. The former `get_order_instructions` deny has
  been removed.
- The observed UI has 34 tools; the session reported 33 internal identifiers.
  The UI also labels Get Order Instructions as read-only. The difference
  between the two counts has not been resolved.
- Alert, watchlist and customer-feedback mutations are present. They are
  outside the two instruction guards and must not be used by this command.

## Confirmed order fields

The user inspected the response already returned by `get_account_orders`:

- `order_type` is the order-type field. Its exact enum value was not supplied.
- Trailing information appears as text in `secondary_description`.
- There is no dedicated trailing field in the inspected response.
- The response does not state whether the trailing distance is a percentage
  or an amount. A percentage inferred from prices is not an API fact.

The adapter must keep the trailing unit and percentage unknown when the
response omits the unit. This matches the existing **Trail percentage not
exposed** scenario in `specs/stonks-inputs/spec.md` and the C6 **not evaluable**
behavior in `specs/stonks-reconciliation/spec.md`. Do not derive a trail
percentage from prices or from an unlabelled number in the description.

The [fictional fixture fragment](first-connect-fixtures/trailing-unit-unspecified.json)
captures this missing-unit case. Its wrapper is test metadata, its values are
invented, and its order-type value is a placeholder. It is not a full API or
PostToolUse capture; the complete response envelope, actual type enum and
pagination still need the capture work in tasks 3.2 and 3.3.

## Reauthentication

The first authenticated reads succeeded. No forced second login or access
lifetime has yet been observed, so the reauthentication interval remains
unknown. Continue the observation over the following days as task 3.2 already
requires. Do not substitute an assumed OAuth access-token expiry for a measured
user-login interval.

## Integration work for the plugin

Before implementing the command, capture matcher and adapter, reconcile the
planning artifacts with this handoff:

- Replace the former `mcp__ibkr__get_orders` references with
  `mcp__ibkr__get_account_orders`, including command `allowed-tools` and capture
  matchers.
- Replace the former drafting-guard assumption with the two exact
  creation/deletion denies supplied by dotfiles.
- Update the ten-tool known set using the connected catalog; resolve the
  34-versus-33 count discrepancy before treating that set as complete.
- Preserve the unknown trail-percentage behavior until the API explicitly
  supplies its unit, or a separately confirmed source supports the value.
- Keep the capture, pagination and reauthentication measurements pending in
  the plugin tasks. This handoff does not complete those implementation tasks.

## Reported internal identifiers

```text
mcp__ibkr__get_account_summary
mcp__ibkr__get_account_balances
mcp__ibkr__get_account_positions
mcp__ibkr__get_account_orders
mcp__ibkr__get_account_trades
mcp__ibkr__create_order_instruction
mcp__ibkr__delete_order_instruction
mcp__ibkr__get_pa_allocation
mcp__ibkr__get_pa_performance_all_periods
mcp__ibkr__get_price_snapshot
mcp__ibkr__get_price_history
mcp__ibkr__get_option_parameters
mcp__ibkr__get_option_data
mcp__ibkr__get_combo_identifier
mcp__ibkr__search_contracts
mcp__ibkr__search_futures
mcp__ibkr__get_company_connections
mcp__ibkr__get_company_themes
mcp__ibkr__get_theme_details
mcp__ibkr__search_investment_topics
mcp__ibkr__get_alerts
mcp__ibkr__get_alert
mcp__ibkr__create_alert
mcp__ibkr__update_alert
mcp__ibkr__set_alert_status
mcp__ibkr__delete_alert
mcp__ibkr__get_watchlists
mcp__ibkr__get_watchlist
mcp__ibkr__create_watchlist
mcp__ibkr__edit_watchlist
mcp__ibkr__delete_watchlist
mcp__ibkr__whats_new
mcp__ibkr__provide_customer_feedback
```
