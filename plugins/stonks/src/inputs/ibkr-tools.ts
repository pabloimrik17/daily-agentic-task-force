// The known set of IBKR tools (design D4a): 33 identifiers plus
// `get_order_instructions`, which the UI lists as read-only. A tool of the
// `ibkr` server outside this set is reported as a warning and never called.

export const KNOWN_IBKR_TOOLS: readonly string[] = [
    "mcp__ibkr__get_account_summary",
    "mcp__ibkr__get_account_balances",
    "mcp__ibkr__get_account_positions",
    "mcp__ibkr__get_account_orders",
    "mcp__ibkr__get_account_trades",
    "mcp__ibkr__create_order_instruction",
    "mcp__ibkr__delete_order_instruction",
    "mcp__ibkr__get_order_instructions",
    "mcp__ibkr__get_pa_allocation",
    "mcp__ibkr__get_pa_performance_all_periods",
    "mcp__ibkr__get_price_snapshot",
    "mcp__ibkr__get_price_history",
    "mcp__ibkr__get_option_parameters",
    "mcp__ibkr__get_option_data",
    "mcp__ibkr__get_combo_identifier",
    "mcp__ibkr__search_contracts",
    "mcp__ibkr__search_futures",
    "mcp__ibkr__get_company_connections",
    "mcp__ibkr__get_company_themes",
    "mcp__ibkr__get_theme_details",
    "mcp__ibkr__search_investment_topics",
    "mcp__ibkr__get_alerts",
    "mcp__ibkr__get_alert",
    "mcp__ibkr__create_alert",
    "mcp__ibkr__update_alert",
    "mcp__ibkr__set_alert_status",
    "mcp__ibkr__delete_alert",
    "mcp__ibkr__get_watchlists",
    "mcp__ibkr__get_watchlist",
    "mcp__ibkr__create_watchlist",
    "mcp__ibkr__edit_watchlist",
    "mcp__ibkr__delete_watchlist",
    "mcp__ibkr__whats_new",
    "mcp__ibkr__provide_customer_feedback",
];

const IBKR_PREFIX = "mcp__ibkr__";

// Claude Code's own tools for a server that awaits login. They stand in for
// the server's catalog until the user authenticates, and are not IBKR's.
const CLIENT_LOGIN_TOOLS: readonly string[] = [
    "mcp__ibkr__authenticate",
    "mcp__ibkr__complete_authentication",
];

const isServerTool = (name: string): boolean =>
    name.startsWith(IBKR_PREFIX) && !CLIENT_LOGIN_TOOLS.includes(name);

/** The `ibkr` tools among `names` that are not in the known set; unique and sorted. */
export function unknownIbkrTools(names: readonly string[]): string[] {
    const unknown = names.filter((name) => isServerTool(name) && !KNOWN_IBKR_TOOLS.includes(name));
    return [...new Set(unknown)].sort();
}

/** The session showed the client's login tools alone: the server's catalog is not visible yet. */
export function awaitsLogin(names: readonly string[]): boolean {
    return names.some((name) => CLIENT_LOGIN_TOOLS.includes(name)) && !names.some(isServerTool);
}

export function ibkrToolWarnings(names: readonly string[]): string[] {
    return unknownIbkrTools(names).map(
        (name) => `${name} is not in the known set of IBKR tools; it was not called`,
    );
}
