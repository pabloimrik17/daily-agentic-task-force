// The vocabulary every engine module shares: inputs as the engine sees them
// after validation, findings, the report and the snapshot. Names follow
// CONTEXT.md. Modules import from here so that inputs, checks, report and
// watchlist agree on one shape; nothing here reads a file or decides anything.

// ---------------------------------------------------------------------------
// Configuration (design D15)

export const CONFIG_SCHEMA = "stonks.config.v1";

export interface StonksConfig {
    schema: typeof CONFIG_SCHEMA;
    trackingSheet: { spreadsheetId: string; tab: string };
    swsPortfolio: { url: string };
    watchlist: { name: string; url: string };
    carteraViva: { url: string };
    excludedTickers: string[];
}

// ---------------------------------------------------------------------------
// Tracking sheet

export const ESTADOS = [
    "Invertido",
    "Comprar",
    "Vender",
    "Operativa",
    "En espera",
    "Roger",
] as const;
export type Estado = (typeof ESTADOS)[number];

export const SHEET_HEADER = ["Ticker", "Sector", "Estado", "Cantidad", "$/u"] as const;

/** One row of the tracking sheet: one lot of a ticker at one price level. */
export interface Entry {
    /** 1-based row number in the tab, for messages that name a row. */
    row: number;
    /** Normalised ticker (see `checks/findings.ts`). */
    ticker: string;
    estado: Estado;
    /** Shares of the lot; a blank cell reads as zero. */
    cantidad: number;
    /** The `$/u` column; null when the cell is blank. */
    pricePerUnit: number | null;
}

export interface TrackingSheet {
    entries: Entry[];
}

// ---------------------------------------------------------------------------
// IBKR

export interface Position {
    ticker: string;
    quantity: number;
}

export type OrderSide = "buy" | "sell";

export type OrderType = "limit" | "trailing-stop" | "stop" | "market" | "other";

export interface ActiveOrder {
    ticker: string;
    side: OrderSide;
    quantity: number;
    orderType: OrderType;
    /** The limit price of a limit order; null otherwise. */
    limitPrice: number | null;
    /** The trail of a trailing stop as a percentage; null when unknown or not a trailing stop. */
    trailPercent: number | null;
}

export type IbkrProvenance = "mcp" | "screenshots";

export interface IbkrRead {
    provenance: IbkrProvenance;
    positions: Position[];
    orders: ActiveOrder[];
}

// ---------------------------------------------------------------------------
// Simply Wall St and the Cartera Viva

/** An exchange-qualified listing, `NasdaqGS:HOOL`. */
export interface Listing {
    exchange: string;
    ticker: string;
}

export function formatListing(listing: Listing): string {
    return `${listing.exchange}:${listing.ticker}`;
}

/** A Simply Wall St stock link as read from a page. */
export interface StockLink {
    href: string;
    text: string;
    listing: Listing;
    /** The company name when the page carries one next to the link. */
    name: string | null;
}

export interface SwsPortfolioRead {
    tickers: string[];
    links: StockLink[];
    /** The holdings counter the page itself shows. */
    count: number;
}

export interface WatchlistItem {
    listing: Listing;
    link: StockLink | null;
}

export interface WatchlistRead {
    title: string;
    items: WatchlistItem[];
    count: number;
    capacity: number;
}

export type TraderTrailing = { activated: false } | { activated: true; percent: number | null };

export interface CarteraVivaCard {
    ticker: string;
    averagePrice: number | null;
    trailing: TraderTrailing;
    /** The company name on the card, when the card carries one (design D11). */
    name: string | null;
}

export interface CarteraVivaRead {
    cards: CarteraVivaCard[];
}

/** One row of the "Add stock" search dropdown (design D11). */
export interface DropdownRow {
    index: number;
    label: string;
    listing: Listing | null;
}

/**
 * What every browser collector returns (design D5, D10): the collector's
 * name and version, the run it belongs to, the page it ran on, and the facts
 * it gathered. Parsers narrow `data` per collector.
 */
export interface CollectorEnvelope {
    stonks: string;
    run: string;
    url: string;
    /** True when the page shows a login form instead of the content. */
    loginWall: boolean;
    data: unknown;
}

// ---------------------------------------------------------------------------
// Findings (spec stonks-reconciliation, design D3 and D16)

export type CheckId =
    | "A1"
    | "A2"
    | "B1"
    | "B2"
    | "B3"
    | "B4"
    | "B5"
    | "B6"
    | "B7"
    | "B8"
    | "C1"
    | "C2"
    | "C3"
    | "C4"
    | "C5"
    | "C6"
    | "C7"
    | "C8"
    | "C9";

export type Severity = "alert" | "discrepancy" | "warning" | "informational" | "not-evaluable";

export type Source = "ibkr" | "tracking-sheet" | "sws-portfolio" | "cartera-viva";

export type Mirror = Exclude<Source, "ibkr">;

export interface Finding {
    check: CheckId;
    ticker: string;
    /** What each side says, as a short phrase per source. */
    sides: Partial<Record<Source, string>>;
    severity: Severity;
    affectsWatchlist: boolean;
    /** Why a finding is not evaluable, when it is. */
    reason?: string;
    /** Consecutive runs with this finding, the current one included; set by the report. */
    repeat?: number;
}

export interface GateDecision {
    tripped: boolean;
    affectedTickers: string[];
}

// ---------------------------------------------------------------------------
// Report and snapshot (spec stonks-report, design D13 and D14)

export const REPORT_SCHEMA = "stonks.report.v1";
export const SNAPSHOT_SCHEMA = "stonks.snapshot.v1";

export type MovementKind = "fill" | "triggered-sell" | "new-order" | "cancelled-order";

export interface Movement {
    kind: MovementKind;
    ticker: string;
    quantity: number;
    side: OrderSide | null;
}

export interface Snapshot {
    schema: typeof SNAPSHOT_SCHEMA;
    /** ISO 8601 UTC date of the run. */
    date: string;
    positions: Position[];
    orders: ActiveOrder[];
    findings: { check: CheckId; ticker: string; repeat: number }[];
}

export interface ReportSection {
    mirror: Mirror;
    findings: Finding[];
}

export interface WatchlistResult {
    removed: string[];
    added: string[];
    unresolved: string[];
    final: string[];
    count: number;
    capacity: number;
    /** Set when the final read differs from the desired set. */
    incomplete: { missing: string[]; extra: string[] } | null;
}

export interface Report {
    schema: typeof REPORT_SCHEMA;
    runId: string;
    generatedAt: string;
    ibkr: { provenance: IbkrProvenance; positions: number; orders: number };
    counts: { swsPortfolio: number; carteraViva: number };
    /** Unknown-IBKR-tool warnings of the run (design D4a). */
    warnings: string[];
    alerts: Finding[];
    sections: ReportSection[];
    movements: { previousRunDate: string | null; items: Movement[] };
    gate: GateDecision;
    /** Ticker → Simply Wall St URL (page or search). */
    links: Record<string, string>;
    watchlist: WatchlistResult | null;
    snapshot: Snapshot;
}

// ---------------------------------------------------------------------------
// Directives the engine prints for the command (design D12)

export type BrowserSource = "sws-portfolio" | "watchlist" | "cartera-viva";

export type Directive =
    | { kind: "ask-login"; source: BrowserSource }
    | { kind: "ibkr-reauth" }
    | { kind: "ibkr-fallback" }
    | { kind: "gate-wait" }
    | { kind: "remove"; ticker: string }
    | { kind: "add"; ticker: string }
    | { kind: "stop"; reason: string }
    | { kind: "done" };

// ---------------------------------------------------------------------------
// Run state (design D6)

/** What a run covers: `full` is phase 1 then phase 2; the others are `--only`. */
export type RunMode = "full" | "sources" | "watchlist";

/** The contents of `active.json` while a run is open. */
export interface ActiveRun {
    runId: string;
    /** ISO 8601 UTC instant the run began; captures expire 6 hours after it. */
    startedAt: string;
    mode: RunMode;
}
