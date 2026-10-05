// The report as data (spec stonks-report): alerts first, then one section per
// mirror in a fixed order, movements, the gate, links and the snapshot the
// next run will compare against.

import {
    type Finding,
    type GateDecision,
    type IbkrRead,
    type Mirror,
    REPORT_SCHEMA,
    type Report,
    type ReportSection,
    SNAPSHOT_SCHEMA,
    type Snapshot,
    type WatchlistResult,
} from "../domain.ts";
import { movements } from "./movements.ts";

export interface ReportInput {
    runId: string;
    generatedAt: string;
    ibkr: IbkrRead;
    swsCount: number;
    carteraVivaCount: number;
    warnings: string[];
    /** Findings with their repeat counts already set (`withRepeatCounts`). */
    findings: Finding[];
    gate: GateDecision;
    previous: Snapshot | null;
    /** Ticker → URL, from `tickerLinks`. */
    links: Record<string, string>;
    watchlist: WatchlistResult | null;
}

const SECTION_ORDER: { mirror: Mirror; prefix: string }[] = [
    { mirror: "sws-portfolio", prefix: "A" },
    { mirror: "tracking-sheet", prefix: "B" },
    { mirror: "cartera-viva", prefix: "C" },
];

export function buildReport(input: ReportInput): Report {
    const alerts = input.findings
        .filter((f) => f.check === "B8")
        .sort((a, b) => a.ticker.localeCompare(b.ticker));
    const sections: ReportSection[] = SECTION_ORDER.map(({ mirror, prefix }) => ({
        mirror,
        findings: input.findings.filter((f) => f.check !== "B8" && f.check.startsWith(prefix)),
    }));
    return {
        schema: REPORT_SCHEMA,
        runId: input.runId,
        generatedAt: input.generatedAt,
        ibkr: {
            provenance: input.ibkr.provenance,
            positions: input.ibkr.positions.length,
            orders: input.ibkr.orders.length,
        },
        counts: { swsPortfolio: input.swsCount, carteraViva: input.carteraVivaCount },
        warnings: input.warnings,
        alerts,
        sections,
        movements: {
            previousRunDate: input.previous?.date ?? null,
            items: movements(input.previous, input.ibkr),
        },
        gate: input.gate,
        links: input.links,
        watchlist: input.watchlist,
        snapshot: {
            schema: SNAPSHOT_SCHEMA,
            date: input.generatedAt,
            positions: input.ibkr.positions,
            orders: input.ibkr.orders,
            findings: input.findings.map((f) => ({
                check: f.check,
                ticker: f.ticker,
                repeat: f.repeat ?? 1,
            })),
        },
    };
}
