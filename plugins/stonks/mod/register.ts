// The report pane (design D13, D14). The engine always prints the markdown as
// well, so nothing here is required for a run to complete.
//
// `$.state` is read and written directly, each call naming one of the file's
// reference constants: the validators of both the CI-pinned and the running
// Claude Code follow that form, while the `claude-code` state library
// (`atom`, `read`, `update`) is unknown to the pinned one (design D17).

import type { EngineInterface, Register, RenderElement } from "claude-code";

import type {
    PaneFinding,
    PaneMirror,
    PaneMovement,
    PaneReport,
    PaneSection,
    PaneStatus,
} from "./types/stonks-state";

const PANE = "stonks";

const STATUS = { plugin: "stonks", key: "status" } as const;
const REPORT = { plugin: "stonks", key: "report" } as const;
const COLLAPSED = { plugin: "stonks", key: "collapsed" } as const;
const TICKS = { plugin: "stonks", key: "ticks" } as const;

const STEP = /stonks\/src\/cli\.ts"?\s+(?:phase1|sigue|watchlist-final)\b/;
const PATH_LINE = /^stonks-report-path: (.+)$/m;
const REPORT_SCHEMA = "stonks.report.v1";

const MIRROR_TITLE: Record<PaneSection["mirror"], string> = {
    "sws-portfolio": "SWS portfolio",
    "tracking-sheet": "Tracking sheet",
    "cartera-viva": "Cartera Viva",
};

const MIRROR_HOTKEY: Record<PaneSection["mirror"], string> = {
    "sws-portfolio": "1",
    "tracking-sheet": "2",
    "cartera-viva": "3",
};

const SEVERITY_LABEL: Record<PaneFinding["severity"], string> = {
    alert: "ALERT",
    discrepancy: "Discrepancy",
    warning: "warning",
    informational: "info",
    "not-evaluable": "not evaluable",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;

const REPORT_SHAPE: Record<string, (value: unknown) => boolean> = {
    schema: (value) => value === REPORT_SCHEMA,
    ibkr: isRecord,
    counts: isRecord,
    warnings: Array.isArray,
    alerts: Array.isArray,
    sections: Array.isArray,
    movements: isRecord,
    gate: isRecord,
    links: isRecord,
};

function isReport(value: unknown): value is PaneReport {
    return (
        isRecord(value) && Object.entries(REPORT_SHAPE).every(([key, holds]) => holds(value[key]))
    );
}

function firstNonEmpty(...values: (string | undefined)[]): string {
    for (const value of values) {
        if (value !== undefined && value !== "") {
            return value;
        }
    }
    return "";
}

async function stateDir($: EngineInterface): Promise<string> {
    const override = firstNonEmpty(await $.env.get("STONKS_STATE_DIR"));
    if (override !== "") {
        return override;
    }
    const xdg = await $.env.get("XDG_STATE_HOME");
    const home = await $.env.get("HOME");
    return `${firstNonEmpty(xdg, `${home ?? ""}/.local/state`)}/stonks`;
}

function sidesText(f: PaneFinding): string {
    return Object.entries(f.sides)
        .map(([source, says]) => `${source}: ${says}`)
        .join("; ");
}

function checklistItems(r: PaneReport): { key: string; label: string }[] {
    const affected = [...r.alerts, ...r.sections.flatMap((s) => s.findings)].filter(
        (f) => f.affectsWatchlist,
    );
    return affected.map((f) => ({
        key: `${f.check}:${f.ticker}`,
        label: `${f.check} ${f.ticker}`,
    }));
}

type Ui = ReturnType<EngineInterface["ui"]["resolve"]>;

// The findings are a grid, not a `Markdown` table: Markdown lays a table out
// for the terminal's width, and a wide one breaks in a pane docked beside the
// transcript. The first three cells are fixed; the sides take what is left of
// the pane's body and wrap inside it.
const ROW = { flexDirection: "row", columnGap: 1 } as const;
const CHECK_CELL = { width: 5, flexShrink: 0 } as const;
const TICKER_CELL = { width: 7, flexShrink: 0 } as const;
const SEVERITY_CELL = { width: 16, flexShrink: 0 } as const;
const SIDES_CELL = { flexGrow: 1, flexShrink: 1 } as const;

function tickerCell(ui: Ui, f: PaneFinding, links: Record<string, string>) {
    const href = links[f.ticker];
    return href === undefined ? h(ui.Text, null, f.ticker) : h(ui.Link, { href, label: f.ticker });
}

function findingRow(ui: Ui, f: PaneFinding, links: Record<string, string>) {
    const repeat = f.repeat === undefined ? "" : ` ×${f.repeat}`;
    const gate = f.affectsWatchlist ? " ⚑" : "";
    const reason = f.reason === undefined ? "" : ` (${f.reason})`;
    return h(
        ui.Box,
        ROW,
        h(ui.Box, CHECK_CELL, h(ui.Text, null, `${f.check}${gate}`)),
        h(ui.Box, TICKER_CELL, tickerCell(ui, f, links)),
        h(ui.Box, SEVERITY_CELL, h(ui.Text, null, `${SEVERITY_LABEL[f.severity]}${repeat}`)),
        h(ui.Box, SIDES_CELL, h(ui.Text, { wrap: "wrap" }, `${sidesText(f)}${reason}`)),
    );
}

function headerRow(ui: Ui) {
    const head = (text: string) => h(ui.Text, { bold: true, dimColor: true }, text);
    return h(
        ui.Box,
        ROW,
        h(ui.Box, CHECK_CELL, head("Check")),
        h(ui.Box, TICKER_CELL, head("Ticker")),
        h(ui.Box, SEVERITY_CELL, head("Severity")),
        h(ui.Box, SIDES_CELL, head("Sides")),
    );
}

function findingsGrid(ui: Ui, key: string, findings: PaneFinding[], links: Record<string, string>) {
    const rows =
        findings.length === 0
            ? [h(ui.Text, { dimColor: true }, "Agrees with IBKR.")]
            : [headerRow(ui), ...findings.map((f) => findingRow(ui, f, links))];
    return h(ui.Box, { key, flexDirection: "column" }, ...rows);
}

const SECTION_BOX = {
    flexDirection: "column",
    borderStyle: "single",
    borderDimColor: true,
    paddingX: 1,
} as const;

function stdoutOf(ran: { result?: unknown; text?: string }): string {
    const result = ran.result as { stdout?: string } | undefined;
    return result?.stdout ?? ran.text ?? "";
}

/** The report the step named, or null when the line, the file or its shape is missing. */
async function loadReport($: EngineInterface, stdout: string): Promise<PaneReport | null> {
    const reportPath = PATH_LINE.exec(stdout)?.[1]?.trim();
    if (reportPath === undefined) {
        return null;
    }
    try {
        const parsed: unknown = JSON.parse(await $.fs.read(reportPath));
        return isReport(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

async function storeReport($: EngineInterface, loaded: PaneReport): Promise<void> {
    await $.state.set(REPORT, loaded);
    await $.state.set(STATUS, "ready");
    // D14: the store keeps the snapshot between sessions; every step rewrites
    // `report.json`, so it follows the run's last report.
    await $.store.set("snapshot", loaded.snapshot);
}

/** A missing or invalid `report.json`: the pane points at the markdown instead. */
async function showUnloaded($: EngineInterface): Promise<void> {
    await $.state.set(REPORT, null);
    await $.state.set(STATUS, "error");
}

/** D14 handoff: the stored snapshot goes to the engine, consumed once by `begin`. */
async function handOver($: EngineInterface): Promise<void> {
    const snapshot = await $.store.get("snapshot");
    if (snapshot !== undefined) {
        await $.fs.write(`${await stateDir($)}/previous.json`, JSON.stringify(snapshot));
    }
}

function emptyHint(status: PaneStatus): string {
    if (status === "syncing") {
        return "Syncing… the report appears here after phase 1. The markdown report is printed in the transcript as well.";
    }
    return status === "error"
        ? "The report could not be loaded; read the markdown report in the transcript."
        : "No report yet. Run /stonks:sync; the markdown report is always printed in the transcript.";
}

async function emptyPane($: EngineInterface, ui: Ui) {
    const { value: status = "idle" } = await $.state.get(STATUS);
    return h(
        ui.Box,
        { flexDirection: "column", paddingX: 1 },
        h(ui.Text, { dimColor: true }, emptyHint(status)),
    );
}

function headerLine(ui: Ui, r: PaneReport) {
    return h(
        ui.Text,
        { dimColor: true },
        `Run ${r.runId} · ${r.generatedAt} · IBKR via ${r.ibkr.provenance}: ${r.ibkr.positions} positions, ${r.ibkr.orders} orders · SWS ${r.counts.swsPortfolio} · Cartera Viva ${r.counts.carteraViva}`,
    );
}

function alertsBox(ui: Ui, r: PaneReport) {
    const { Box, Text } = ui;
    return r.alerts.length === 0
        ? h(Text, { dimColor: true }, "No alerts.")
        : h(
              Box,
              { flexDirection: "column", borderStyle: "round", borderColor: "red", paddingX: 1 },
              h(Text, { bold: true, color: "red" }, `Alerts (${r.alerts.length})`),
              findingsGrid(ui, "findings:alerts", r.alerts, r.links),
          );
}

async function toggleMirror($: EngineInterface, mirror: PaneMirror): Promise<void> {
    const held = await $.state.get(COLLAPSED);
    const current = held.value ?? {};
    await $.state.set(COLLAPSED, { ...current, [mirror]: !(current[mirror] === true) });
}

function mirrorToggle($: EngineInterface, ui: Ui, s: PaneSection, isCollapsed: boolean) {
    return h(ui.Button, {
        key: `toggle:${s.mirror}`,
        hotkey: MIRROR_HOTKEY[s.mirror],
        label: `${isCollapsed ? "▸" : "▾"} ${MIRROR_TITLE[s.mirror]} (${s.findings.length})`,
        onPress: () => toggleMirror($, s.mirror),
    });
}

function sectionBox(
    $: EngineInterface,
    ui: Ui,
    s: PaneSection,
    links: Record<string, string>,
    collapsed: Record<string, boolean>,
) {
    const isCollapsed = collapsed[s.mirror] === true;
    const body = isCollapsed ? [] : [findingsGrid(ui, `findings:${s.mirror}`, s.findings, links)];
    return h(ui.Box, SECTION_BOX, mirrorToggle($, ui, s, isCollapsed), ...body);
}

function linksRow(ui: Ui, r: PaneReport) {
    const tickers = Object.entries(r.links).slice(0, 12);
    return h(
        ui.Box,
        { flexDirection: "row", flexWrap: "wrap", gap: 1 },
        h(ui.Text, { dimColor: true }, "Tickers:"),
        ...tickers.map(([ticker, href]) => h(ui.Link, { href, label: ticker })),
    );
}

function movementText(m: PaneMovement): string {
    return `${m.kind} ${m.quantity} ${m.ticker}${m.side === null ? "" : ` (${m.side})`}`;
}

function noMovements(ui: Ui, r: PaneReport) {
    return h(
        ui.Text,
        { dimColor: true },
        r.movements.previousRunDate === null
            ? "Movimientos: no previous run to compare with."
            : `Movimientos since ${r.movements.previousRunDate}: none.`,
    );
}

function listedMovements(ui: Ui, r: PaneReport) {
    return h(
        ui.Box,
        { flexDirection: "column" },
        h(ui.Text, { bold: true }, `Movimientos since ${r.movements.previousRunDate ?? "?"}`),
        ...r.movements.items.map((m) => h(ui.Text, null, movementText(m))),
    );
}

function movementsBox(ui: Ui, r: PaneReport) {
    return r.movements.items.length === 0 ? noMovements(ui, r) : listedMovements(ui, r);
}

async function toggleTick($: EngineInterface, key: string): Promise<void> {
    const held = await $.state.get(TICKS);
    const current = held.value ?? {};
    await $.state.set(TICKS, { ...current, [key]: !(current[key] === true) });
}

function tickButton(
    $: EngineInterface,
    ui: Ui,
    item: { key: string; label: string },
    index: number,
    ticks: Record<string, boolean>,
) {
    return h(ui.Button, {
        key: `tick:${item.key}`,
        plain: true,
        ...(index < 26 ? { hotkey: String.fromCharCode(97 + index) } : {}),
        label: `${ticks[item.key] === true ? "[x]" : "[ ]"} ${item.label}`,
        onPress: () => toggleTick($, item.key),
    });
}

function checklistBox($: EngineInterface, ui: Ui, r: PaneReport, ticks: Record<string, boolean>) {
    const items = checklistItems(r);
    if (!r.gate.tripped || items.length === 0) {
        return [];
    }
    return [
        h(
            ui.Box,
            { flexDirection: "column", borderStyle: "round", paddingX: 1 },
            h(ui.Text, { bold: true }, 'Gate: fix in the tracking sheet, then say "sigue"'),
            ...items.map((item, index) => tickButton($, ui, item, index, ticks)),
        ),
    ];
}

async function reportPane($: EngineInterface, ui: Ui, r: PaneReport, bodyColumns: number) {
    const { value: collapsed = {} } = await $.state.get(COLLAPSED);
    const { value: ticks = {} } = await $.state.get(TICKS);
    return h(
        ui.Box,
        // Sized to the pane's body, which is narrower than the terminal while docked.
        { flexDirection: "column", gap: 1, paddingX: 1, width: bodyColumns },
        headerLine(ui, r),
        ...r.warnings.map((w) => h(ui.Text, { color: "yellow" }, `WARNING: ${w}`)),
        alertsBox(ui, r),
        ...r.sections.map((s) => sectionBox($, ui, s, r.links, collapsed)),
        linksRow(ui, r),
        movementsBox(ui, r),
        ...checklistBox($, ui, r, ticks),
    );
}

export const register: Register = (on) => {
    on("command.run", { command: "stonks:sync" }, async ($, e, next) => {
        await $.state.set(STATUS, "syncing");
        await $.state.set(REPORT, null);
        await $.state.set(TICKS, {});
        await $.state.set(COLLAPSED, {});
        await handOver($);
        await $.ui.open({ id: PANE, title: "Stonks" });
        return next(e);
    });

    on("tool.call", { tool: "Bash" }, async ($, e, next) => {
        const ran = await next(e);
        if (!STEP.test(e.command) || ran.deny !== undefined) {
            return ran;
        }
        const loaded = await loadReport($, stdoutOf(ran));
        await (loaded === null ? showUnloaded($) : storeReport($, loaded));
        return ran;
    });

    on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
        const ui = $.ui.resolve(e);
        const { value: r = null } = await $.state.get(REPORT);
        const pane =
            r === null ? await emptyPane($, ui) : await reportPane($, ui, r, e.props.bodyColumns);
        return pane as RenderElement;
    });
};
