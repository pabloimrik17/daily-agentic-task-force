// Mod tests run under `claude plugin test` (`bun run test:mod`), not Vitest
// (design D17): the kit mounts the pane through the engine's own host and
// raises the command and tool events the module hooks. The world beneath the
// module (files, store, environment, the pane host, the Bash tool) is answered
// by this file's hooks, so no test touches the disk. Every value is fictional.
import type { On } from "claude-code";
import { expect, mock, test } from "claude-code/testing";

const PANE_PROPS = {
    title: "Stonks",
    isFocused: false,
    bodyColumns: 100,
    placement: "inline",
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
} as const;

const MOUNT = {
    plugin: "stonks",
    surface: "terminal",
    component: "Pane",
    requestId: "stonks",
    props: PANE_PROPS,
} as const;

const STATE_DIR = "/stonks-test/state";
const REPORT_PATH = `${STATE_DIR}/runs/20261005T120000Z-abc123/report.json`;

/** The person running `/stonks:sync` on the main screen, as the engine stamps it. */
const SYNC = {
    command: "stonks:sync",
    args: "",
    origin: { kind: "composer" },
    presentation: { isFullscreen: false, columns: 156 },
} as const;

/** A Bash command running one engine step, as the command writes it. */
const step = (name: string): string => `bun "/plugins/stonks/src/cli.ts" ${name}`;

/** A step's stdout naming the file it wrote (design D13). */
const named = (path: string): string =>
    `# Stonks\n\n…\n\nstonks-report-path: ${path}\n\ndirective: {"kind":"gate-wait"}\n`;

const SNAPSHOT = {
    schema: "stonks.snapshot.v1",
    date: "2026-10-03T20:11:00.000Z",
    positions: [{ ticker: "HOOL", quantity: 2 }],
    orders: [],
    findings: [{ check: "B3", ticker: "GLBX", repeat: 2 }],
};

const LINKS = {
    STRK: "https://simplywall.st/stocks/us/tech/nasdaq-strk/strk",
    TYRL: "https://simplywall.st/search?q=TYRL",
    WNYE: "https://simplywall.st/search?q=WNYE",
    GLBX: "https://simplywall.st/stocks/us/retail/nyse-glbx/glbx",
    UMBR: "https://simplywall.st/search?q=UMBR",
    INIT: "https://simplywall.st/stocks/us/semis/nasdaq-init/init",
};

const REPORT = {
    schema: "stonks.report.v1",
    runId: "20261005T120000Z-abc123",
    generatedAt: "2026-10-05T12:00:30.000Z",
    ibkr: { provenance: "mcp", positions: 3, orders: 1 },
    counts: { swsPortfolio: 3, carteraViva: 2 },
    warnings: ["mcp__ibkr__submit_order is not in the known set of IBKR tools"],
    alerts: [
        {
            check: "B8",
            ticker: "STRK",
            sides: { ibkr: "holds 3, sell orders cover 2", "tracking-sheet": "Vender 3" },
            severity: "alert",
            affectsWatchlist: false,
            repeat: 1,
        },
    ],
    sections: [
        {
            mirror: "sws-portfolio",
            findings: [
                {
                    check: "A2",
                    ticker: "TYRL",
                    sides: { "sws-portfolio": "listed", ibkr: "not held" },
                    severity: "discrepancy",
                    affectsWatchlist: false,
                    repeat: 1,
                },
            ],
        },
        {
            mirror: "tracking-sheet",
            findings: [
                {
                    check: "B1",
                    ticker: "WNYE",
                    sides: { "tracking-sheet": "Vender 3", ibkr: "not held, no order" },
                    severity: "discrepancy",
                    affectsWatchlist: true,
                    repeat: 1,
                },
                {
                    check: "B3",
                    ticker: "GLBX",
                    sides: { ibkr: "holds 2", "tracking-sheet": "position 1" },
                    severity: "discrepancy",
                    affectsWatchlist: false,
                    repeat: 3,
                },
            ],
        },
        {
            mirror: "cartera-viva",
            findings: [
                {
                    check: "C1",
                    ticker: "UMBR",
                    sides: { "tracking-sheet": "Roger", "cartera-viva": "not listed" },
                    severity: "discrepancy",
                    affectsWatchlist: true,
                    repeat: 1,
                },
                {
                    check: "C6",
                    ticker: "INIT",
                    sides: { "cartera-viva": "trailing 10%", ibkr: "trailing 15%" },
                    severity: "warning",
                    affectsWatchlist: false,
                    repeat: 2,
                },
            ],
        },
    ],
    movements: {
        previousRunDate: "2026-10-03T20:11:00.000Z",
        items: [{ kind: "triggered-sell", ticker: "WNYE", quantity: 3, side: "sell" }],
    },
    gate: { tripped: true, affectedTickers: ["WNYE", "UMBR"] },
    links: LINKS,
    snapshot: {
        ...SNAPSHOT,
        date: "2026-10-05T12:00:30.000Z",
        findings: [{ check: "B3", ticker: "GLBX", repeat: 3 }],
    },
};

/** The world beneath the module, held in memory and inspectable by the test. */
interface World {
    files: Record<string, string>;
    written: Record<string, string>;
    store: Record<string, unknown>;
    opened: string[];
    /** What the Bash tool answers to the next step. */
    stdout: string;
}

function world(on: On, seed: Partial<World> = {}): World {
    const w: World = { files: {}, written: {}, store: {}, opened: [], stdout: "", ...seed };
    mock.env(on, { STONKS_STATE_DIR: STATE_DIR });
    on("fs.read", (_$, e) => {
        const text = w.files[e.path];
        if (text === undefined) {
            throw new Error(`ENOENT: no such file, ${e.path}`);
        }
        return { value: text };
    });
    on("fs.write", (_$, e) => {
        w.written[e.path] = e.text;
        return { value: undefined };
    });
    on("store.get", (_$, e) => ({ value: w.store[e.key] }));
    on("store.set", (_$, e) => {
        w.store[e.key] = e.value;
        return { value: undefined };
    });
    on("ui.open", (_$, e) => {
        w.opened.push(e.id);
        return { value: { isPlaced: true } };
    });
    on("command.run", { command: "stonks:sync" }, () => ({ text: "" }));
    on("tool.call", { tool: "Bash" }, () => ({
        result: { stdout: w.stdout, stderr: "", interrupted: false },
    }));
    return w;
}

test("the pane points at the markdown report while no report is loaded", async ($, on) => {
    world(on);
    const ui = await $.ui.mount(MOUNT);
    expect(await ui.find({ type: "Text", text: /No report yet/ })).toBeDefined();
    await ui.unmount();
});

test("the command opens the pane syncing and hands the stored snapshot to the engine", async ($, on) => {
    const w = world(on, { store: { snapshot: SNAPSHOT } });
    await $.command.run(SYNC);
    expect(w.opened).toEqual(["stonks"]);
    expect(w.written[`${STATE_DIR}/previous.json`]).toBe(JSON.stringify(SNAPSHOT));
    const ui = await $.ui.mount(MOUNT);
    expect(await ui.find({ type: "Text", text: /Syncing/ })).toBeDefined();
    await ui.unmount();
});

test("without a stored snapshot the command hands nothing over", async ($, on) => {
    const w = world(on);
    await $.command.run(SYNC);
    expect(w.opened).toEqual(["stonks"]);
    expect(Object.keys(w.written)).toEqual([]);
});

test("phase1 loads report.json into the pane and keeps its snapshot in the store", async ($, on) => {
    const w = world(on, {
        files: { [REPORT_PATH]: JSON.stringify(REPORT) },
        stdout: named(REPORT_PATH),
    });
    await $.tool.call({ tool: "Bash", command: step("phase1") });
    expect(w.store.snapshot).toEqual(REPORT.snapshot);

    const ui = await $.ui.mount(MOUNT);
    expect(await ui.find({ type: "Text", text: /Alerts \(1\)/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /WARNING: mcp__ibkr__submit_order/ })).toBeDefined();
    expect((await ui.find({ key: "toggle:tracking-sheet" }))?.text).toContain("Tracking sheet (2)");
    expect(await ui.find({ key: "findings:tracking-sheet" })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /B1 ⚑/ })).toBeDefined();
    // Each linked ticker is a link in its finding's row and again in the links row.
    expect(await ui.findAll({ type: "Link" })).toHaveLength(2 * Object.keys(LINKS).length);
    expect(await ui.find({ type: "Text", text: /triggered-sell 3 WNYE/ })).toBeDefined();
    expect((await ui.find({ key: "tick:B1:WNYE" }))?.text).toContain("[ ] B1 WNYE");
    expect(await ui.find({ key: "tick:C1:UMBR" })).toBeDefined();
    expect(await ui.find({ key: "tick:B3:GLBX" })).toBeUndefined();
    await ui.unmount();
});

// A Markdown table is laid out for the terminal, not for a pane docked beside
// the transcript, and a wide one breaks there; the findings are a grid sized
// to the pane's body instead, their sides wrapping inside it.
test("the findings fit the pane's body, whatever its width", async ($, on) => {
    world(on, { files: { [REPORT_PATH]: JSON.stringify(REPORT) }, stdout: named(REPORT_PATH) });
    await $.tool.call({ tool: "Bash", command: step("phase1") });
    const ui = await $.ui.mount({ ...MOUNT, props: { ...PANE_PROPS, bodyColumns: 64 } });
    expect((await ui.find({ type: "Box" }))?.props.width).toBe(64);
    expect(await ui.findAll({ type: "Markdown" })).toHaveLength(0);
    const sides = await ui.find({ type: "Text", text: /cartera-viva: trailing 10%/ });
    expect(sides?.props.wrap).toBe("wrap");
    await ui.unmount();
});

test("a mirror's button collapses its findings and expands them again", async ($, on) => {
    world(on, { files: { [REPORT_PATH]: JSON.stringify(REPORT) }, stdout: named(REPORT_PATH) });
    await $.tool.call({ tool: "Bash", command: step("phase1") });
    const ui = await $.ui.mount(MOUNT);
    expect(await ui.find({ key: "findings:tracking-sheet" })).toBeDefined();

    await ui.press({ key: "toggle:tracking-sheet" });
    expect(await ui.find({ key: "findings:tracking-sheet" })).toBeUndefined();
    expect((await ui.find({ key: "toggle:tracking-sheet" }))?.text).toContain("▸");
    expect(await ui.find({ key: "findings:cartera-viva" })).toBeDefined();

    await ui.press({ key: "toggle:tracking-sheet" });
    expect(await ui.find({ key: "findings:tracking-sheet" })).toBeDefined();
    await ui.unmount();
});

test("ticks live in the session only and a new run clears them", async ($, on) => {
    const w = world(on, {
        files: { [REPORT_PATH]: JSON.stringify(REPORT) },
        stdout: named(REPORT_PATH),
    });
    await $.tool.call({ tool: "Bash", command: step("phase1") });
    const ui = await $.ui.mount(MOUNT);

    await ui.press({ key: "tick:B1:WNYE" });
    expect((await ui.find({ key: "tick:B1:WNYE" }))?.text).toContain("[x] B1 WNYE");
    expect(w.store.ticks).toBeUndefined();

    // The next run replaces the report and shows no earlier tick.
    await $.command.run(SYNC);
    expect(await ui.find({ type: "Text", text: /Syncing/ })).toBeDefined();
    await $.tool.call({ tool: "Bash", command: step("sigue") });
    expect((await ui.find({ key: "tick:B1:WNYE" }))?.text).toContain("[ ] B1 WNYE");
    await ui.unmount();
});

test("a missing or invalid report.json points at the markdown", async ($, on) => {
    const w = world(on, {
        files: { [REPORT_PATH]: JSON.stringify({ schema: "something.else" }) },
        stdout: named(REPORT_PATH),
    });
    await $.tool.call({ tool: "Bash", command: step("phase1") });
    const ui = await $.ui.mount(MOUNT);
    expect(await ui.find({ type: "Text", text: /could not be loaded/ })).toBeDefined();

    w.stdout = named(`${STATE_DIR}/runs/none/report.json`);
    await $.tool.call({ tool: "Bash", command: step("sigue") });
    expect(await ui.find({ type: "Text", text: /could not be loaded/ })).toBeDefined();

    w.stdout = 'Stopped: no run is open\n\ndirective: {"kind":"stop","reason":"no run"}\n';
    await $.tool.call({ tool: "Bash", command: step("watchlist-final") });
    expect(await ui.find({ type: "Text", text: /could not be loaded/ })).toBeDefined();

    expect(w.store.snapshot).toBeUndefined();
    await ui.unmount();
});

test("a step the pane does not follow leaves it alone", async ($, on) => {
    const w = world(on, {
        files: { [REPORT_PATH]: JSON.stringify(REPORT) },
        stdout: named(REPORT_PATH),
    });
    await $.tool.call({ tool: "Bash", command: step("begin --only sources") });
    const ui = await $.ui.mount(MOUNT);
    expect(await ui.find({ type: "Text", text: /No report yet/ })).toBeDefined();
    expect(w.store.snapshot).toBeUndefined();
    await ui.unmount();
});
