// The report pane (design D13, D14). The engine always prints the markdown as
// well, so nothing here is required for a run to complete.
//
// `$.state` is read and written directly, each call naming one of the file's
// reference constants: the validators of both the CI-pinned and the running
// Claude Code follow that form, while the `claude-code` state library
// (`atom`, `read`, `update`) is unknown to the pinned one (design D17).

import type { CommandRunResult, EngineInterface, Register, RenderElement } from "claude-code";

import type {
    PaneFinding,
    PaneMirror,
    PaneMovement,
    PaneReport,
    PaneSection,
    PaneStatus,
    PaneWatchlist,
} from "./types/stonks-state";

const PANE = "stonks";

const STATUS = { plugin: "stonks", key: "status" } as const;
const REPORT = { plugin: "stonks", key: "report" } as const;
const COLLAPSED = { plugin: "stonks", key: "collapsed" } as const;
const TICKS = { plugin: "stonks", key: "ticks" } as const;
const FULL_RUN = { plugin: "stonks", key: "fullRun" } as const;
const GATE_WAIT = { plugin: "stonks", key: "gateWait" } as const;

// The plugin root is `…/plugins/stonks` under `--plugin-dir`, and
// `…/cache/<marketplace>/stonks/<version>` once installed from a marketplace.
const STEP = /stonks\/(?:[^/\s"]+\/)?src\/cli\.ts"?\s+(phase1|sigue|watchlist-final)\b/;
const PATH_LINE = /^stonks-report-path: (.+)$/m;
const ONLY = /--only\b/;
const PHASE2_ONLY = /--only\s+watchlist\b/;
const REPORT_SCHEMA = "stonks.report.v1";

const MIRROR_TITLE: Record<PaneSection["mirror"], string> = {
    "sws-portfolio": "SWS portfolio",
    "tracking-sheet": "Tracking sheet",
    "cartera-viva": "Cartera Viva",
};

// The A and B checks compare a mirror with IBKR; the C checks compare the
// tracking sheet with the Cartera Viva.
const AGREES: Record<PaneSection["mirror"], string> = {
    "sws-portfolio": "Agrees with IBKR.",
    "tracking-sheet": "Agrees with IBKR.",
    "cartera-viva": "The tracking sheet agrees with the Cartera Viva.",
};

// The tracking sheet's text when its B findings all went to the Alerts: the
// engine moves every B8 there.
const SEE_ALERTS = "No other finding; see Alerts.";

function agrees(r: PaneReport, mirror: PaneMirror): string {
    return mirror === "tracking-sheet" && r.alerts.some((f) => f.check.startsWith("B"))
        ? SEE_ALERTS
        : AGREES[mirror];
}

// Only a full run's `phase1` waits for "sigue": `--only sources` ends after its
// report, and the report `sigue` prints goes on to phase 2.
const GATE_HEADING = {
    wait: 'Gate: fix in the tracking sheet, then say "sigue"',
    list: "Gate: findings that affect the watchlist",
} as const;

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

type ChecklistItem = { key: string; label: string; ticker: string };

/** B4 and B5 can raise one finding per entry or order of a ticker; each later one gets its ordinal. */
function checklistItems(r: PaneReport): ChecklistItem[] {
    const affected = [...r.alerts, ...r.sections.flatMap((s) => s.findings)].filter(
        (f) => f.affectsWatchlist,
    );
    const seen = new Map<string, number>();
    return affected.map((f) => {
        const key = `${f.check}:${f.ticker}`;
        const nth = (seen.get(key) ?? 0) + 1;
        seen.set(key, nth);
        return {
            key: nth === 1 ? key : `${key}:${nth}`,
            label: `${f.check} ${f.ticker}`,
            ticker: f.ticker,
        };
    });
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

function tickerLink(ui: Ui, ticker: string, links: Record<string, string>) {
    const href = links[ticker];
    return href === undefined ? h(ui.Text, null, ticker) : h(ui.Link, { href, label: ticker });
}

function findingRow(ui: Ui, f: PaneFinding, links: Record<string, string>) {
    const repeat = f.repeat === undefined ? "" : ` ×${f.repeat}`;
    const gate = f.affectsWatchlist ? " ⚑" : "";
    const reason = f.reason === undefined ? "" : ` (${f.reason})`;
    return h(
        ui.Box,
        ROW,
        h(ui.Box, CHECK_CELL, h(ui.Text, null, `${f.check}${gate}`)),
        h(ui.Box, TICKER_CELL, tickerLink(ui, f.ticker, links)),
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

function findingsGrid(
    ui: Ui,
    key: string,
    findings: PaneFinding[],
    links: Record<string, string>,
    agrees: string,
) {
    const rows =
        findings.length === 0
            ? [h(ui.Text, { dimColor: true }, agrees)]
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

/**
 * Ticks belong to the report they were made on: `sigue` recomputes every
 * finding, so its report, like any other new one, starts unticked.
 */
async function settleTicks($: EngineInterface, step: string, loaded: PaneReport): Promise<void> {
    const { value: shown } = await $.state.get(REPORT);
    if (step === "sigue" || shown?.generatedAt !== loaded.generatedAt) {
        await $.state.set(TICKS, {});
    }
}

async function storeReport($: EngineInterface, step: string, loaded: PaneReport): Promise<void> {
    const { value: fullRun = false } = await $.state.get(FULL_RUN);
    await settleTicks($, step, loaded);
    await $.state.set(REPORT, loaded);
    await $.state.set(GATE_WAIT, fullRun && step === "phase1");
    await $.state.set(STATUS, "ready");
    // D14: the store keeps the snapshot between sessions; every step rewrites
    // `report.json`, so it follows the run's last report.
    await $.store.set("snapshot", loaded.snapshot);
}

/**
 * A step's report into the pane. `watchlist-final` names none in
 * `--only watchlist`, or when it stops; the pane then keeps what it shows.
 */
async function follow($: EngineInterface, step: string, stdout: string): Promise<void> {
    if (step === "watchlist-final" && !PATH_LINE.test(stdout)) {
        return;
    }
    const loaded = await loadReport($, stdout);
    await (loaded === null ? showUnloaded($) : storeReport($, step, loaded));
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

const NO_REPORT =
    "No report yet. Run /stonks:sync; the markdown report is always printed in the transcript.";

const HINTS: Record<PaneStatus, string> = {
    idle: NO_REPORT,
    syncing:
        "Syncing… the report appears here after phase 1. The markdown report is printed in the transcript as well.",
    watchlist:
        "Phase 2 alone (--only watchlist) has no phase-1 report to draw here; its watchlist result is printed in the transcript.",
    ready: NO_REPORT,
    error: "The report could not be loaded; read the markdown report in the transcript.",
};

async function emptyPane($: EngineInterface, ui: Ui) {
    const { value: status = "idle" } = await $.state.get(STATUS);
    return h(
        ui.Box,
        { flexDirection: "column", paddingX: 1 },
        h(ui.Text, { dimColor: true }, HINTS[status]),
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
              findingsGrid(ui, "findings:alerts", r.alerts, r.links, "No alerts."),
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
    r: PaneReport,
    collapsed: Record<string, boolean>,
) {
    const isCollapsed = collapsed[s.mirror] === true;
    const body = isCollapsed
        ? []
        : [findingsGrid(ui, `findings:${s.mirror}`, s.findings, r.links, agrees(r, s.mirror))];
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

function movementRow(ui: Ui, m: PaneMovement, links: Record<string, string>) {
    const side = m.side === null ? [] : [h(ui.Text, null, `(${m.side})`)];
    return h(
        ui.Box,
        ROW,
        h(ui.Text, null, `${m.kind} ${m.quantity}`),
        tickerLink(ui, m.ticker, links),
        ...side,
    );
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
        ...r.movements.items.map((m) => movementRow(ui, m, r.links)),
    );
}

function movementsBox(ui: Ui, r: PaneReport) {
    return r.movements.items.length === 0 ? noMovements(ui, r) : listedMovements(ui, r);
}

const WRAP_ROW = { flexDirection: "row", flexWrap: "wrap", columnGap: 1 } as const;

function tickerLine(ui: Ui, label: string, tickers: string[], links: Record<string, string>) {
    const items =
        tickers.length === 0
            ? [h(ui.Text, { dimColor: true }, "none")]
            : tickers.map((ticker) => tickerLink(ui, ticker, links));
    return h(ui.Box, WRAP_ROW, h(ui.Text, null, `${label}:`), ...items);
}

function incompleteLines(ui: Ui, w: PaneWatchlist, links: Record<string, string>) {
    return w.incomplete === null
        ? []
        : [
              h(ui.Text, { bold: true, color: "red" }, "Incomplete"),
              tickerLine(ui, "Missing", w.incomplete.missing, links),
              tickerLine(ui, "Unexpected", w.incomplete.extra, links),
          ];
}

/** Phase 2's result, once `watchlist-final` has added it to the report. */
function watchlistBox(ui: Ui, r: PaneReport) {
    const w = r.watchlist ?? null;
    if (w === null) {
        return [];
    }
    return [
        h(
            ui.Box,
            { key: "watchlist", ...SECTION_BOX },
            h(ui.Text, { bold: true }, `Watchlist ${w.count}/${w.capacity}`),
            tickerLine(ui, "Removed", w.removed, r.links),
            tickerLine(ui, "Added", w.added, r.links),
            tickerLine(ui, "Unresolved", w.unresolved, r.links),
            tickerLine(ui, "Final list", w.final, r.links),
            ...incompleteLines(ui, w, r.links),
        ),
    ];
}

async function toggleTick($: EngineInterface, key: string): Promise<void> {
    const held = await $.state.get(TICKS);
    const current = held.value ?? {};
    await $.state.set(TICKS, { ...current, [key]: !(current[key] === true) });
}

function tickButton(
    $: EngineInterface,
    ui: Ui,
    item: ChecklistItem,
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

function checklistBox(
    $: EngineInterface,
    ui: Ui,
    r: PaneReport,
    ticks: Record<string, boolean>,
    heading: string,
) {
    const items = checklistItems(r);
    if (!r.gate.tripped || items.length === 0) {
        return [];
    }
    return [
        h(
            ui.Box,
            { flexDirection: "column", borderStyle: "round", paddingX: 1 },
            h(ui.Text, { bold: true }, heading),
            ...items.map((item, index) =>
                h(
                    ui.Box,
                    { key: `item:${item.key}`, ...ROW },
                    tickButton($, ui, item, index, ticks),
                    tickerLink(ui, item.ticker, r.links),
                ),
            ),
        ),
    ];
}

async function reportPane($: EngineInterface, ui: Ui, r: PaneReport, bodyColumns: number) {
    const { value: collapsed = {} } = await $.state.get(COLLAPSED);
    const { value: ticks = {} } = await $.state.get(TICKS);
    const { value: gateWait = false } = await $.state.get(GATE_WAIT);
    return h(
        ui.Box,
        // Sized to the pane's body, which is narrower than the terminal while docked.
        { flexDirection: "column", gap: 1, paddingX: 1, width: bodyColumns },
        headerLine(ui, r),
        ...r.warnings.map((w) => h(ui.Text, { color: "yellow" }, `WARNING: ${w}`)),
        alertsBox(ui, r),
        ...r.sections.map((s) => sectionBox($, ui, s, r, collapsed)),
        linksRow(ui, r),
        movementsBox(ui, r),
        ...checklistBox($, ui, r, ticks, gateWait ? GATE_HEADING.wait : GATE_HEADING.list),
        ...watchlistBox(ui, r),
    );
}

/** A run's start: the pane reset to syncing, the snapshot handed over, then the pane opened. */
async function startRun($: EngineInterface, args: string): Promise<void> {
    await $.state.set(STATUS, PHASE2_ONLY.test(args) ? "watchlist" : "syncing");
    await $.state.set(FULL_RUN, !ONLY.test(args));
    await $.state.set(REPORT, null);
    await $.state.set(TICKS, {});
    await $.state.set(COLLAPSED, {});
    await handOver($);
    await $.ui.open({ id: PANE, title: "Stonks" });
}

export const register: Register = (on) => {
    on("command.run", { command: "stonks:sync" }, async ($, e, next) => {
        // The command runs whatever happens to the pane. A failure still fails
        // the hook, so the engine reports it, but after `next`, whose result
        // then stands.
        let ran: CommandRunResult;
        try {
            await startRun($, e.args);
        } finally {
            ran = await next(e);
        }
        return ran;
    });

    on("tool.call", { tool: "Bash" }, async ($, e, next) => {
        const ran = await next(e);
        const step = STEP.exec(e.command)?.[1];
        if (step === undefined || ran.deny !== undefined) {
            return ran;
        }
        await follow($, step, stdoutOf(ran));
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
