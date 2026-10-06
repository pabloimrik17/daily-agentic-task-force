// The `stonks-report-path:` line the pane follows is added by the engine
// step, not here.

import type { Finding, Mirror, Movement, Report, WatchlistResult } from "../domain.ts";

/** The most characters one pane block may carry. */
export const BLOCK_LIMIT = 10_000;

const MIRROR_TITLES: Record<Mirror, string> = {
    "sws-portfolio": "SWS portfolio",
    "tracking-sheet": "Tracking sheet",
    "cartera-viva": "Cartera Viva",
};

/** What a section with no finding says: the A and B checks compare with IBKR, the C checks with the Cartera Viva. */
const AGREES: Record<Mirror, string> = {
    "sws-portfolio": "Agrees with IBKR.",
    "tracking-sheet": "Agrees with IBKR.",
    "cartera-viva": "The tracking sheet agrees with the Cartera Viva.",
};

const TABLE_HEAD = [
    "| Check | Ticker | Severity | Sides | Runs |",
    "| --- | --- | --- | --- | --- |",
];

function cell(text: string): string {
    return text.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");
}

function tickerLink(links: Record<string, string>, ticker: string): string {
    const url = links[ticker];
    return url === undefined ? ticker : `[${ticker}](${url})`;
}

function findingRow(report: Report, finding: Finding): string {
    const sides =
        finding.severity === "not-evaluable"
            ? `not evaluable: ${finding.reason ?? "no reason given"}`
            : Object.entries(finding.sides)
                  .map(([source, text]) => `${source}: ${text}`)
                  .join("; ");
    const check = finding.affectsWatchlist ? `${finding.check} ⚑` : finding.check;
    return `| ${check} | ${tickerLink(report.links, finding.ticker)} | ${finding.severity} | ${cell(sides)} | ${finding.repeat ?? 1} |`;
}

function movementLine(movement: Movement, links: Record<string, string>): string {
    const ticker = tickerLink(links, movement.ticker);
    switch (movement.kind) {
        case "fill":
            return `- fill ${movement.quantity} ${ticker}`;
        case "triggered-sell":
            return `- triggered sell ${movement.quantity} ${ticker}`;
        case "new-order":
            return `- new ${movement.side ?? ""} order ${movement.quantity} ${ticker}`.replace(
                "  ",
                " ",
            );
        case "cancelled-order":
            return `- cancelled ${movement.side ?? ""} order ${movement.quantity} ${ticker}`.replace(
                "  ",
                " ",
            );
    }
}

/**
 * A block is its heading and fixed lines, then rows. When `cap` is set and the
 * block would pass the limit, rows are dropped from the end for a last line
 * naming how many.
 */
function block(head: string[], rows: string[], cap: boolean): string {
    const join = (lines: string[]): string => lines.join("\n");
    const full = join([...head, ...rows]);
    if (!cap || full.length <= BLOCK_LIMIT) {
        return full;
    }
    const kept: string[] = [];
    let size = join(head).length;
    for (const row of rows) {
        const more = `… ${rows.length - kept.length} more, see the markdown report`;
        if (size + row.length + 1 + more.length + 1 > BLOCK_LIMIT) {
            break;
        }
        kept.push(row);
        size += row.length + 1;
    }
    return join([...head, ...kept, `… ${rows.length - kept.length} more, see the markdown report`]);
}

function findingsBlock(
    report: Report,
    title: string,
    findings: Finding[],
    agrees: string,
    cap: boolean,
): string {
    if (findings.length === 0) {
        return `## ${title}\n\n${agrees}`;
    }
    return block(
        [`## ${title}`, "", ...TABLE_HEAD],
        findings.map((f) => findingRow(report, f)),
        cap,
    );
}

function alertsBlock(report: Report, cap: boolean): string {
    return findingsBlock(report, "Alerts", report.alerts, "No alerts.", cap);
}

function movementsBlock(report: Report, cap: boolean): string {
    const { previousRunDate, items } = report.movements;
    if (previousRunDate === null) {
        return "## Movimientos\n\nNo previous run to compare with.";
    }
    const head = [`## Movimientos since ${previousRunDate}`, ""];
    return items.length === 0
        ? `${head.join("\n")}No movements.`
        : block(
              head,
              items.map((m) => movementLine(m, report.links)),
              cap,
          );
}

function checklistBlock(report: Report, cap: boolean): string {
    if (!report.gate.tripped) {
        return "";
    }
    const items = [...report.alerts, ...report.sections.flatMap((s) => s.findings)].filter(
        (f) => f.affectsWatchlist,
    );
    const tickers =
        report.gate.affectedTickers.length === 0 ? "none" : report.gate.affectedTickers.join(", ");
    return block(
        ["## Gate", "", `Affected tickers: ${tickers}`, ""],
        items.map((f) => `- [ ] ${f.check} ${tickerLink(report.links, f.ticker)}`),
        cap,
    );
}

/** The `## Watchlist` block, its tickers linked; empty while phase 2 has not run. The final step prints it alone. */
export function watchlistBlock(w: WatchlistResult | null, links: Record<string, string>): string {
    if (w === null) {
        return "";
    }
    const list = (items: string[]): string =>
        items.length === 0 ? "none" : items.map((ticker) => tickerLink(links, ticker)).join(", ");
    const lines = [
        "## Watchlist",
        "",
        `- Removed: ${list(w.removed)}`,
        `- Added: ${list(w.added)}`,
        `- Unresolved: ${list(w.unresolved)}`,
        `- Final list: ${list(w.final)}`,
        `- Count: ${w.count}/${w.capacity}`,
    ];
    if (w.incomplete !== null) {
        lines.push(
            `- Incomplete: missing ${list(w.incomplete.missing)}; unexpected ${list(w.incomplete.extra)}`,
        );
    }
    return lines.join("\n");
}

function header(report: Report): string {
    const how =
        report.ibkr.provenance === "mcp"
            ? "IBKR read through the MCP server"
            : "IBKR from user-confirmed screenshots";
    const lines = [
        "# Stonks · phase 1",
        "",
        `Run ${report.runId} · ${report.generatedAt}`,
        "",
        `${how}. IBKR positions: ${report.ibkr.positions} · IBKR active orders: ${report.ibkr.orders} · SWS portfolio tickers: ${report.counts.swsPortfolio} · Cartera Viva tickers: ${report.counts.carteraViva}`,
    ];
    for (const warning of report.warnings) {
        lines.push("", `WARNING: ${warning}`);
    }
    return lines.join("\n");
}

function sectionBlock(report: Report, mirror: Mirror, cap: boolean): string {
    const findings = report.sections.find((s) => s.mirror === mirror)?.findings ?? [];
    return findingsBlock(report, MIRROR_TITLES[mirror], findings, AGREES[mirror], cap);
}

const MIRRORS: Mirror[] = ["sws-portfolio", "tracking-sheet", "cartera-viva"];

/** The full report: nothing truncated. */
export function renderMarkdown(report: Report): string {
    const parts = [
        header(report),
        alertsBlock(report, false),
        ...MIRRORS.map((m) => sectionBlock(report, m, false)),
        movementsBlock(report, false),
        checklistBlock(report, false),
        watchlistBlock(report.watchlist, report.links),
    ].filter((part) => part !== "");
    return `${parts.join("\n\n")}\n`;
}

/** Each block of the report on its own, truncated to what a pane block may carry. */
export function renderSections(report: Report): {
    alerts: string;
    sections: Record<Mirror, string>;
    movements: string;
    checklist: string;
} {
    return {
        alerts: alertsBlock(report, true),
        sections: {
            "sws-portfolio": sectionBlock(report, "sws-portfolio", true),
            "tracking-sheet": sectionBlock(report, "tracking-sheet", true),
            "cartera-viva": sectionBlock(report, "cartera-viva", true),
        },
        movements: movementsBlock(report, true),
        checklist: checklistBlock(report, true),
    };
}
