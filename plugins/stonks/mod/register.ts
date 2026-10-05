// The report pane (design D13, D14). `command.run` on `stonks:sync` opens the
// pane and hands the stored snapshot to the engine as `<state>/previous.json`;
// `tool.call` on Bash recognises the engine's report-producing steps and loads
// `report.json` into `$.state`; `ui.render` draws it. The engine always prints
// the markdown as well, so nothing here is required for a run to complete.
//
// `$.state` is read and written directly, each call naming one of the file's
// reference constants: the validators of both the CI-pinned and the running
// Claude Code follow that form, while the `claude-code` state library
// (`atom`, `read`, `update`) is unknown to the pinned one (design D17).
//
//
// The engine names the file it wrote on a `stonks-report-path:` line and the
// mod reads it with `$.fs.read` (design D13); the pane's `[spike]` line shows
// the diagnostics the steps log.

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
const FEED = { plugin: "stonks", key: "feed" } as const;

// A Bash command running one of the engine's report-producing steps.
const STEP =
    /stonks\/src\/(?:cli|spike-stub)\.ts"?\s+(phase1|sigue|watchlist-final|spike-report)\b/;
// The engine names the file it wrote.
const PATH_LINE = /^stonks-report-path: (.+)$/m;

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

async function log($: EngineInterface, line: string): Promise<void> {
    const held = await $.state.get(FEED);
    await $.state.set(FEED, [...(held.value ?? []), line]);
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

function tickerCell(f: PaneFinding, links: Record<string, string>): string {
    const url = links[f.ticker];
    return url === undefined ? f.ticker : `[${f.ticker}](${url})`;
}

function sidesText(f: PaneFinding): string {
    return Object.entries(f.sides)
        .map(([source, says]) => `${source}: ${says}`)
        .join("; ");
}

function findingRow(f: PaneFinding, links: Record<string, string>): string {
    const repeat = f.repeat === undefined ? "" : ` ×${f.repeat}`;
    const gate = f.affectsWatchlist ? " ⚑" : "";
    const reason = f.reason === undefined ? "" : ` (${f.reason})`;
    return `| ${f.check}${gate} | ${tickerCell(f, links)} | ${SEVERITY_LABEL[f.severity]}${repeat} | ${sidesText(f)}${reason} |`;
}

function findingsTable(findings: PaneFinding[], links: Record<string, string>): string {
    if (findings.length === 0) {
        return "_Agrees with IBKR._";
    }
    const rows = findings.map((f) => findingRow(f, links));
    return ["| Check | Ticker | Severity | Sides |", "| --- | --- | --- | --- |", ...rows].join(
        "\n",
    );
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

const SECTION_BOX = {
    flexDirection: "column",
    borderStyle: "single",
    borderDimColor: true,
    paddingX: 1,
} as const;

// The tool result of a Bash call: `stdout` when it has one, else the text.
function stdoutOf(ran: { result?: unknown; text?: string }): string {
    const result = ran.result as { stdout?: string } | undefined;
    return result?.stdout ?? ran.text ?? "";
}

function reportPathOf(stdout: string): string | undefined {
    return PATH_LINE.exec(stdout)?.[1]?.trim();
}

async function readReport($: EngineInterface, reportPath: string): Promise<PaneReport | null> {
    try {
        const loaded = JSON.parse(await $.fs.read(reportPath)) as PaneReport;
        await log($, `feed A (fs.read): ok, ${reportPath}`);
        return loaded;
    } catch (error) {
        await log($, `feed A (fs.read): failed, ${String(error)}`);
        return null;
    }
}

async function loadReport($: EngineInterface, stdout: string): Promise<PaneReport | null> {
    const reportPath = reportPathOf(stdout);
    if (reportPath === undefined) {
        await log($, "feed A (fs.read): no path line in stdout");
        return null;
    }
    return readReport($, reportPath);
}

async function storeReport($: EngineInterface, loaded: PaneReport): Promise<void> {
    await $.state.set(REPORT, loaded);
    await $.state.set(STATUS, "ready");
    // D14: the pane's store keeps the snapshot between sessions. Every
    // recognised step rewrites `report.json` with the run's current
    // snapshot, so the store follows the last report of the run.
    await $.store.set("snapshot", loaded.snapshot);
    await log($, "store: snapshot replaced");
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
    const { Box, Text } = ui;
    const { value: status = "idle" } = await $.state.get(STATUS);
    const { value: lines = [] } = await $.state.get(FEED);
    return h(
        Box,
        { flexDirection: "column", paddingX: 1 },
        h(Text, { dimColor: true }, emptyHint(status)),
        ...lines.map((line) => h(Text, { dimColor: true }, line)),
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
    const { Box, Text, Markdown } = ui;
    return r.alerts.length === 0
        ? h(Text, { dimColor: true }, "No alerts.")
        : h(
              Box,
              { flexDirection: "column", borderStyle: "round", borderColor: "red", paddingX: 1 },
              h(Text, { bold: true, color: "red" }, `Alerts (${r.alerts.length})`),
              h(Markdown, { text: findingsTable(r.alerts, r.links) }),
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
    const body = isCollapsed ? [] : [h(ui.Markdown, { text: findingsTable(s.findings, links) })];
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

async function reportPane($: EngineInterface, ui: Ui, r: PaneReport) {
    const { value: collapsed = {} } = await $.state.get(COLLAPSED);
    const { value: ticks = {} } = await $.state.get(TICKS);
    const { value: lines = [] } = await $.state.get(FEED);
    return h(
        ui.Box,
        { flexDirection: "column", gap: 1, paddingX: 1 },
        headerLine(ui, r),
        ...r.warnings.map((w) => h(ui.Text, { color: "yellow" }, `WARNING: ${w}`)),
        alertsBox(ui, r),
        ...r.sections.map((s) => sectionBox($, ui, s, r.links, collapsed)),
        linksRow(ui, r),
        movementsBox(ui, r),
        ...checklistBox($, ui, r, ticks),
        h(ui.Text, { dimColor: true }, `[spike] ${lines.join(" | ")}`),
    );
}

export const register: Register = (on) => {
    on("command.run", { command: "stonks:sync" }, async ($, e, next) => {
        await $.state.set(STATUS, "syncing");
        await $.state.set(TICKS, {});
        await $.state.set(FEED, []);
        // D14 handoff: the stored snapshot goes to the engine, consumed once by `begin`.
        const snapshot = await $.store.get("snapshot");
        if (snapshot !== undefined) {
            const dir = await stateDir($);
            await $.fs.write(`${dir}/previous.json`, JSON.stringify(snapshot));
            await log($, `handoff: wrote ${dir}/previous.json`);
        } else {
            await log($, "handoff: no stored snapshot");
        }
        await $.ui.open({ id: PANE, title: "Stonks" });
        return next(e);
    });

    on("tool.call", { tool: "Bash" }, async ($, e, next) => {
        const ran = await next(e);
        if (STEP.exec(e.command) === null || ran.deny !== undefined) {
            return ran;
        }
        const loaded = await loadReport($, stdoutOf(ran));
        if (loaded === null) {
            await $.state.set(STATUS, "error");
            return ran;
        }
        await storeReport($, loaded);
        return ran;
    });

    on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
        const ui = $.ui.resolve(e);
        const { value: r = null } = await $.state.get(REPORT);
        const pane = r === null ? await emptyPane($, ui) : await reportPane($, ui, r);
        return pane as RenderElement;
    });
};
