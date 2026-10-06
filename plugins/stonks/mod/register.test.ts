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

/** `sigue`'s report: the sheet re-read and every finding recomputed, B1 on WNYE still among them. */
const RESUMED = { ...REPORT, generatedAt: "2026-10-05T12:20:00.000Z" };

const WATCHLIST = {
    removed: ["OSCP"],
    added: ["GLBX"],
    unresolved: [],
    final: ["GLBX", "INIT"],
    count: 2,
    capacity: 50,
    incomplete: { missing: ["STRK"], extra: [] },
};

/** The world beneath the module, held in memory and inspectable by the test. */
interface World {
    files: Record<string, string>;
    written: Record<string, string>;
    store: Record<string, unknown>;
    opened: string[];
    /** When set, opening a pane fails with this message. */
    openFails: string | null;
    /** How many times `/stonks:sync` itself ran, beneath the module's hook. */
    commandRuns: number;
    /** What the Bash tool answers to the next step. */
    stdout: string;
}

function world(on: On, seed: Partial<World> = {}): World {
    const w: World = {
        files: {},
        written: {},
        store: {},
        opened: [],
        openFails: null,
        commandRuns: 0,
        stdout: "",
        ...seed,
    };
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
        if (w.openFails !== null) {
            throw new Error(w.openFails);
        }
        w.opened.push(e.id);
        return { value: { isPlaced: true } };
    });
    on("command.run", { command: "stonks:sync" }, () => {
        w.commandRuns += 1;
        return { text: "" };
    });
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

test("a pane that fails to open does not stop the command", async ($, on) => {
    const w = world(on, { store: { snapshot: SNAPSHOT }, openFails: "no pane host" });
    await $.command.run(SYNC);
    expect(w.commandRuns).toBe(1);
    expect(w.opened).toEqual([]);
    expect(w.written[`${STATE_DIR}/previous.json`]).toBe(JSON.stringify(SNAPSHOT));
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
    // Each ticker links from its finding and from the row of tickers; WNYE also
    // from Movimientos, and WNYE and UMBR from the checklist.
    expect(await ui.findAll({ type: "Link" })).toHaveLength(2 * Object.keys(LINKS).length + 3);
    expect(await ui.find({ type: "Text", text: /^triggered-sell 3$/ })).toBeDefined();
    expect(await ui.findAll({ type: "Link", text: "WNYE" })).toHaveLength(4);
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

    await $.command.run(SYNC);
    expect(await ui.find({ type: "Text", text: /Syncing/ })).toBeDefined();
    await $.tool.call({ tool: "Bash", command: step("sigue") });
    expect((await ui.find({ key: "tick:B1:WNYE" }))?.text).toContain("[ ] B1 WNYE");
    await ui.unmount();
});

test("sigue's recomputed report shows its checklist unticked", async ($, on) => {
    const w = world(on, {
        files: { [REPORT_PATH]: JSON.stringify(REPORT) },
        stdout: named(REPORT_PATH),
    });
    await $.command.run(SYNC);
    await $.tool.call({ tool: "Bash", command: step("phase1") });
    const ui = await $.ui.mount(MOUNT);
    await ui.press({ key: "tick:B1:WNYE" });
    expect((await ui.find({ key: "tick:B1:WNYE" }))?.text).toContain("[x] B1 WNYE");

    w.files[REPORT_PATH] = JSON.stringify(RESUMED);
    await $.tool.call({ tool: "Bash", command: step("sigue") });
    expect((await ui.find({ key: "tick:B1:WNYE" }))?.text).toContain("[ ] B1 WNYE");
    await ui.unmount();
});

test("a tick stays while the report it was made on is loaded again", async ($, on) => {
    const w = world(on, {
        files: { [REPORT_PATH]: JSON.stringify(REPORT) },
        stdout: named(REPORT_PATH),
    });
    await $.tool.call({ tool: "Bash", command: step("phase1") });
    const ui = await $.ui.mount(MOUNT);
    await ui.press({ key: "tick:B1:WNYE" });

    // `watchlist-final` adds phase 2's result to the same report.
    w.files[REPORT_PATH] = JSON.stringify({ ...REPORT, watchlist: WATCHLIST });
    await $.tool.call({ tool: "Bash", command: step("watchlist-final") });
    expect(await ui.find({ key: "watchlist" })).toBeDefined();
    expect((await ui.find({ key: "tick:B1:WNYE" }))?.text).toContain("[x] B1 WNYE");
    await ui.unmount();
});

test("only a full run's phase-1 report asks for sigue at the gate", async ($, on) => {
    const w = world(on, {
        files: { [REPORT_PATH]: JSON.stringify(REPORT) },
        stdout: named(REPORT_PATH),
    });
    await $.command.run(SYNC);
    await $.tool.call({ tool: "Bash", command: step("phase1") });
    const ui = await $.ui.mount(MOUNT);
    expect(
        await ui.find({ type: "Text", text: 'Gate: fix in the tracking sheet, then say "sigue"' }),
    ).toBeDefined();

    // The report `sigue` prints goes on to phase 2.
    w.files[REPORT_PATH] = JSON.stringify(RESUMED);
    await $.tool.call({ tool: "Bash", command: step("sigue") });
    expect(await ui.find({ type: "Text", text: /sigue/ })).toBeUndefined();
    expect(
        await ui.find({ type: "Text", text: "Gate: findings that affect the watchlist" }),
    ).toBeDefined();
    await ui.unmount();
});

test("an --only sources report lists the gate's findings without asking for sigue", async ($, on) => {
    world(on, { files: { [REPORT_PATH]: JSON.stringify(REPORT) }, stdout: named(REPORT_PATH) });
    await $.command.run({ ...SYNC, args: "--only sources" });
    await $.tool.call({ tool: "Bash", command: step("phase1") });
    const ui = await $.ui.mount(MOUNT);
    expect(
        await ui.find({ type: "Text", text: "Gate: findings that affect the watchlist" }),
    ).toBeDefined();
    expect(await ui.find({ type: "Text", text: /sigue/ })).toBeUndefined();
    expect(await ui.find({ key: "tick:B1:WNYE" })).toBeDefined();
    await ui.unmount();
});

test("each checklist row links its ticker, to a search when its page is unknown", async ($, on) => {
    // GLBX's page is known; UMBR's is not, so the engine linked it to a search.
    const report = {
        ...REPORT,
        sections: REPORT.sections.map((s) => ({
            ...s,
            findings: s.findings.map((f) =>
                f.ticker === "GLBX" ? { ...f, affectsWatchlist: true } : f,
            ),
        })),
    };
    world(on, { files: { [REPORT_PATH]: JSON.stringify(report) }, stdout: named(REPORT_PATH) });
    await $.tool.call({ tool: "Bash", command: step("phase1") });
    const ui = await $.ui.mount(MOUNT);
    expect(await ui.find({ key: "item:B3:GLBX" })).toBeDefined();
    expect(await ui.find({ key: "item:C1:UMBR" })).toBeDefined();
    // Each from its finding, the row of tickers and its checklist row.
    const glbx = await ui.findAll({ type: "Link", text: "GLBX" });
    expect(glbx.map((link) => link.props.href)).toEqual([LINKS.GLBX, LINKS.GLBX, LINKS.GLBX]);
    const umbr = await ui.findAll({ type: "Link", text: "UMBR" });
    const search = "https://simplywall.st/search?q=UMBR";
    expect(umbr.map((link) => link.props.href)).toEqual([search, search, search]);
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

    expect(w.store.snapshot).toBeUndefined();
    await ui.unmount();
});

test("a step of the copy installed from the marketplace loads the report too", async ($, on) => {
    const w = world(on, {
        files: { [REPORT_PATH]: JSON.stringify(REPORT) },
        stdout: named(REPORT_PATH),
    });
    await $.tool.call({
        tool: "Bash",
        command: 'bun "/home/u/.claude/plugins/cache/datf/stonks/0.1.0/src/cli.ts" phase1',
    });
    expect(w.store.snapshot).toEqual(REPORT.snapshot);
});

test("two findings of one check and ticker tick apart", async ($, on) => {
    const b4 = {
        check: "B4",
        ticker: "WNYE",
        sides: { "tracking-sheet": "Comprar 1 at 10", ibkr: "no buy order" },
        severity: "discrepancy",
        affectsWatchlist: true,
        repeat: 1,
    };
    const report = {
        ...REPORT,
        sections: REPORT.sections.map((s) =>
            s.mirror === "tracking-sheet" ? { ...s, findings: [b4, b4] } : s,
        ),
    };
    world(on, { files: { [REPORT_PATH]: JSON.stringify(report) }, stdout: named(REPORT_PATH) });
    await $.tool.call({ tool: "Bash", command: step("phase1") });
    const ui = await $.ui.mount(MOUNT);

    await ui.press({ key: "tick:B4:WNYE:2" });
    expect((await ui.find({ key: "tick:B4:WNYE" }))?.text).toContain("[ ] B4 WNYE");
    expect((await ui.find({ key: "tick:B4:WNYE:2" }))?.text).toContain("[x] B4 WNYE");
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

test("a section without findings says what it agrees with", async ($, on) => {
    const report = {
        ...REPORT,
        alerts: [],
        sections: REPORT.sections.map((s) => ({ ...s, findings: [] })),
    };
    world(on, { files: { [REPORT_PATH]: JSON.stringify(report) }, stdout: named(REPORT_PATH) });
    await $.tool.call({ tool: "Bash", command: step("phase1") });
    const ui = await $.ui.mount(MOUNT);
    expect(await ui.findAll({ type: "Text", text: "Agrees with IBKR." })).toHaveLength(2);
    expect(
        await ui.find({ type: "Text", text: "The tracking sheet agrees with the Cartera Viva." }),
    ).toBeDefined();
    await ui.unmount();
});

test("a tracking sheet whose only B finding is an alert points at the Alerts", async ($, on) => {
    const report = {
        ...REPORT,
        sections: REPORT.sections.map((s) => ({ ...s, findings: [] })),
    };
    world(on, { files: { [REPORT_PATH]: JSON.stringify(report) }, stdout: named(REPORT_PATH) });
    await $.tool.call({ tool: "Bash", command: step("phase1") });
    const ui = await $.ui.mount(MOUNT);
    expect(await ui.find({ type: "Text", text: "No other finding; see Alerts." })).toBeDefined();
    expect(await ui.findAll({ type: "Text", text: "Agrees with IBKR." })).toHaveLength(1);
    await ui.unmount();
});

test("the final step adds phase 2's result to the pane, its tickers linked", async ($, on) => {
    const report = {
        ...REPORT,
        links: { ...LINKS, OSCP: "https://simplywall.st/search?q=OSCP" },
        watchlist: WATCHLIST,
    };
    world(on, { files: { [REPORT_PATH]: JSON.stringify(report) }, stdout: named(REPORT_PATH) });
    await $.tool.call({ tool: "Bash", command: step("watchlist-final") });
    const ui = await $.ui.mount(MOUNT);
    expect(await ui.find({ key: "watchlist" })).toBeDefined();
    expect(await ui.find({ type: "Text", text: "Watchlist 2/50" })).toBeDefined();
    expect(await ui.find({ type: "Link", text: "OSCP" })).toBeDefined();
    expect(await ui.find({ type: "Text", text: "Incomplete" })).toBeDefined();
    expect(await ui.findAll({ type: "Link", text: "STRK" })).toHaveLength(3);
    await ui.unmount();
});

test("a phase-1 report has no watchlist box", async ($, on) => {
    world(on, { files: { [REPORT_PATH]: JSON.stringify(REPORT) }, stdout: named(REPORT_PATH) });
    await $.tool.call({ tool: "Bash", command: step("phase1") });
    const ui = await $.ui.mount(MOUNT);
    expect(await ui.find({ key: "watchlist" })).toBeUndefined();
    await ui.unmount();
});

test("a final step that names no report leaves the pane as it is", async ($, on) => {
    const w = world(on, {
        files: { [REPORT_PATH]: JSON.stringify(REPORT) },
        stdout: named(REPORT_PATH),
    });
    await $.tool.call({ tool: "Bash", command: step("phase1") });
    const ui = await $.ui.mount(MOUNT);

    w.stdout =
        'Stopped: no fresh watchlist read\n\ndirective: {"kind":"stop","reason":"no read"}\n';
    await $.tool.call({ tool: "Bash", command: step("watchlist-final") });
    expect(await ui.find({ type: "Text", text: /Alerts \(1\)/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /could not be loaded/ })).toBeUndefined();
    await ui.unmount();
});

test("an --only watchlist run says it has no phase-1 report, through its final step", async ($, on) => {
    const w = world(on);
    await $.command.run({ ...SYNC, args: "--only watchlist" });
    const ui = await $.ui.mount(MOUNT);
    expect(await ui.find({ type: "Text", text: /Phase 2 alone/ })).toBeDefined();

    w.stdout = '## Watchlist\n\n- Removed: none\n\ndirective: {"kind":"done"}\n';
    await $.tool.call({ tool: "Bash", command: step("watchlist-final") });
    expect(await ui.find({ type: "Text", text: /Phase 2 alone/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /could not be loaded/ })).toBeUndefined();
    await ui.unmount();
});
