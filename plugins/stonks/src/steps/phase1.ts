// Phase 1 and its resumption (design D3, D4, D5, D12, D13, D14; spec
// stonks-sync "Gate between phases", stonks-inputs "IBKR re-authentication
// before the screenshot fallback"): every input read in this run, then the
// checks, the gate and the report. IBKR comes from the confirmed screenshot
// table when there is one, else from this run's captures; a failed read offers
// `/mcp` once before the fallback. The previous run's snapshot feeds only
// Movimientos and the repeat counters, never a check. `sigue` re-reads the
// sheet alone, reuses everything else, and never pauses again.

import { existsSync, readFileSync } from "node:fs";

import { SEVERITY_OF } from "../checks/findings.ts";
import { decideGate } from "../checks/gate.ts";
import { runChecks } from "../checks/index.ts";
import {
    type ActiveOrder,
    type BrowserSource,
    type CarteraVivaRead,
    type CheckId,
    type Directive,
    type IbkrRead,
    type OrderType,
    type Position,
    type Report,
    SNAPSHOT_SCHEMA,
    type Snapshot,
    type SwsPortfolioRead,
    type TrackingSheet,
} from "../domain.ts";
import { parseCarteraViva } from "../inputs/cartera-viva.ts";
import type { ReadResult } from "../inputs/envelope.ts";
import { type IbkrFailure, type IbkrResult, readIbkr } from "../inputs/ibkr.ts";
import { parseSwsPortfolio } from "../inputs/sws-portfolio.ts";
import { withRepeatCounts } from "../report/counters.ts";
import { tickerLinks } from "../report/links.ts";
import { renderMarkdown } from "../report/markdown.ts";
import { buildReport } from "../report/model.ts";
import {
    ibkrConfirmedPath,
    listingsPath,
    previousPath,
    rawDir,
    reauthOfferedPath,
    reportPath,
    warningsPath,
    writePrivate,
} from "../state.ts";
import {
    array,
    type Json,
    number,
    object,
    ParseError,
    rejectUnknownKeys,
    string,
} from "../validate.ts";
import {
    learnFromLinks,
    type Listings,
    parseListings,
    serialiseListings,
} from "../watchlist/listings.ts";
import { captureJson, latestCapture, openRun, readSheet, type RunScope, stop } from "./shared.ts";
import {
    type Step,
    type StepContext,
    type StepOutput,
    type StepTable,
    UsageError,
} from "./types.ts";

type PhaseStep = "phase1" | "sigue";

interface Inputs {
    sheet: TrackingSheet;
    ibkr: IbkrRead;
    sws: SwsPortfolioRead;
    carteraViva: CarteraVivaRead;
}

type Outcome<T> = { ok: true; value: T } | { ok: false; output: StepOutput };

const NEXT_PHASE2 =
    "Next: run `collector watchlist` through `javascript_tool`, then `watchlist-plan`.";
const NEXT_END = "Next: run `end`; `--only sources` ends after this report.";
const NEXT_GATE =
    'Next: the gate paused the run. Relay this whole report and wait for the user: on "sigue" run `sigue`; on "stop" or "para" run `end`.';
const REAUTH =
    "Next: offer to re-authenticate the `ibkr` server through `/mcp`, and wait. When the user says it is done, run `ibkr-tools` again with the name of every `mcp__ibkr__*` tool now in this session, call `mcp__ibkr__get_account_positions` and `mcp__ibkr__get_account_orders` again, then run `phase1`. If the user declines, run `phase1` again at once.";
const FALLBACK =
    "Next: ask the user for screenshots of their positions and of their active orders, transcribe them into the screenshots JSON and send it to `ibkr-screenshots-stage` on stdin. Only after the user explicitly confirms the engine's rendering, run `ibkr-screenshots-confirm`, then `phase1`.";

const LABELS: Record<Exclude<BrowserSource, "watchlist">, string> = {
    "sws-portfolio": "SWS portfolio",
    "cartera-viva": "Cartera Viva",
};

function noArgs(name: PhaseStep, args: readonly string[]): void {
    if (args.length > 0) {
        throw new UsageError(`${name} takes no arguments`);
    }
}

function strictly<T>(read: () => T): { ok: true; value: T } | { ok: false; message: string } {
    try {
        return { ok: true, value: read() };
    } catch (error) {
        if (error instanceof ParseError) {
            return { ok: false, message: error.message };
        }
        throw error;
    }
}

function jsonFile(path: string): { ok: true; value: unknown } | { ok: false } {
    try {
        return { ok: true, value: JSON.parse(readFileSync(path, "utf8")) };
    } catch {
        return { ok: false };
    }
}

// ---------------------------------------------------------------------------
// Strict readers for the engine's own files: the confirmed table and the snapshot

const ORDER_TYPES: readonly string[] = [
    "limit",
    "trailing-stop",
    "stop",
    "market",
    "other",
] satisfies OrderType[];

const isOrderType = (value: string): value is OrderType => ORDER_TYPES.includes(value);

const isCheckId = (value: string): value is CheckId => Object.hasOwn(SEVERITY_OF, value);

function nullableNumber(parent: Json, key: string, path: string): number | null {
    return parent[key] === null ? null : number(parent, key, path);
}

function readPositions(raw: unknown, path: string): Position[] {
    return array(raw, path).map((item, index) => {
        const at = `${path}[${index}]`;
        const row = object(item, at);
        rejectUnknownKeys(row, ["ticker", "quantity"], at);
        return { ticker: string(row, "ticker", at), quantity: number(row, "quantity", at) };
    });
}

function readOrders(raw: unknown, path: string): ActiveOrder[] {
    return array(raw, path).map((item, index) => {
        const at = `${path}[${index}]`;
        const row = object(item, at);
        rejectUnknownKeys(
            row,
            ["ticker", "side", "quantity", "orderType", "limitPrice", "trailPercent"],
            at,
        );
        const side = string(row, "side", at);
        if (side !== "buy" && side !== "sell") {
            throw new ParseError(`${at}.side must be buy or sell`);
        }
        const orderType = string(row, "orderType", at);
        if (!isOrderType(orderType)) {
            throw new ParseError(`${at}.orderType must be one of ${ORDER_TYPES.join(", ")}`);
        }
        return {
            ticker: string(row, "ticker", at),
            side,
            quantity: number(row, "quantity", at),
            orderType,
            limitPrice: nullableNumber(row, "limitPrice", at),
            trailPercent: nullableNumber(row, "trailPercent", at),
        };
    });
}

function readSnapshot(raw: unknown): Snapshot {
    const root = object(raw, "previous");
    rejectUnknownKeys(root, ["schema", "date", "positions", "orders", "findings"], "previous");
    if (root.schema !== SNAPSHOT_SCHEMA) {
        throw new ParseError(`previous.schema must be ${SNAPSHOT_SCHEMA}`);
    }
    const date = string(root, "date", "previous");
    if (Number.isNaN(Date.parse(date))) {
        throw new ParseError("previous.date must be an ISO 8601 date");
    }
    const findings = array(root.findings, "previous.findings").map((item, index) => {
        const at = `previous.findings[${index}]`;
        const row = object(item, at);
        rejectUnknownKeys(row, ["check", "ticker", "repeat"], at);
        const check = string(row, "check", at);
        if (!isCheckId(check)) {
            throw new ParseError(`${at}.check must be a check identifier`);
        }
        const repeat = number(row, "repeat", at);
        if (!Number.isInteger(repeat) || repeat < 1) {
            throw new ParseError(`${at}.repeat must be a positive integer`);
        }
        return { check, ticker: string(row, "ticker", at), repeat };
    });
    return {
        schema: SNAPSHOT_SCHEMA,
        date,
        positions: readPositions(root.positions, "previous.positions"),
        orders: readOrders(root.orders, "previous.orders"),
        findings,
    };
}

/** The handed-over snapshot when it validates; otherwise none, with the warning why. */
function readPrevious(scope: RunScope): { snapshot: Snapshot | null; warning: string | null } {
    const path = previousPath(scope.stateDir, scope.run.runId);
    if (!existsSync(path)) {
        return { snapshot: null, warning: null };
    }
    const ignored = (why: string) => ({
        snapshot: null,
        warning: `previous snapshot ignored: ${why}`,
    });
    const raw = jsonFile(path);
    if (!raw.ok) {
        return ignored("not valid JSON");
    }
    const read = strictly(() => readSnapshot(raw.value));
    return read.ok ? { snapshot: read.value, warning: null } : ignored(read.message);
}

// ---------------------------------------------------------------------------
// Inputs

function readConfirmed(path: string): IbkrResult<IbkrRead> {
    const unreadable = (why: string): IbkrResult<IbkrRead> => ({
        ok: false,
        error: { kind: "unreadable", message: `IBKR confirmed screenshots: ${why}` },
    });
    const raw = jsonFile(path);
    if (!raw.ok) {
        return unreadable("not valid JSON");
    }
    const read = strictly((): IbkrRead => {
        const root = object(raw.value, "ibkr-confirmed");
        rejectUnknownKeys(root, ["provenance", "positions", "orders"], "ibkr-confirmed");
        if (root.provenance !== "screenshots") {
            throw new ParseError("ibkr-confirmed.provenance must be screenshots");
        }
        return {
            provenance: "screenshots",
            positions: readPositions(root.positions, "ibkr-confirmed.positions"),
            orders: readOrders(root.orders, "ibkr-confirmed.orders"),
        };
    });
    return read.ok ? read : unreadable(read.message);
}

/** The confirmed screenshot table when the user confirmed one, else this run's MCP captures. */
function readIbkrSource(scope: RunScope): IbkrResult<IbkrRead> {
    const confirmed = ibkrConfirmedPath(scope.stateDir, scope.run.runId);
    return existsSync(confirmed)
        ? readConfirmed(confirmed)
        : readIbkr(rawDir(scope.stateDir, scope.run.runId));
}

const describeFailure = (failure: IbkrFailure): string =>
    failure.kind === "needs-login"
        ? "the `ibkr` server asks for login; its authorisation has expired"
        : failure.message;

/** The `/mcp` offer the first time in the run; the screenshot fallback only after it. */
function ibkrUnread(ctx: StepContext, scope: RunScope, failure: IbkrFailure): StepOutput {
    const why = `IBKR could not be read: ${describeFailure(failure)}`;
    const marker = reauthOfferedPath(scope.stateDir, scope.run.runId);
    if (!existsSync(marker)) {
        writePrivate(marker, `${JSON.stringify({ offeredAt: ctx.now().toISOString() })}\n`);
        return { markdown: `${why}\n\n${REAUTH}`, directive: { kind: "ibkr-reauth" } };
    }
    return {
        markdown: `${why}\n\nRe-authentication through \`/mcp\` did not restore the reads, or the user declined it.\n\n${FALLBACK}`,
        directive: { kind: "ibkr-fallback" },
    };
}

function askLogin(
    scope: RunScope,
    source: Exclude<BrowserSource, "watchlist">,
    step: PhaseStep,
): StepOutput {
    const url =
        source === "sws-portfolio" ? scope.config.swsPortfolio.url : scope.config.carteraViva.url;
    return {
        markdown: `${LABELS[source]} shows a login page at ${url}. Ask the user to log in there and wait; never type credentials. When they say they have logged in, run \`collector ${source}\` through \`javascript_tool\`, then \`${step}\` again.`,
        directive: { kind: "ask-login", source },
    };
}

/** The newest capture of a collector in this run, parsed; another run's capture is unreadable. */
function readCollector<T>(
    scope: RunScope,
    source: Exclude<BrowserSource, "watchlist">,
    parse: (envelope: unknown, runId: string) => ReadResult<T>,
    step: PhaseStep,
): Outcome<T> {
    const label = LABELS[source];
    const capture = latestCapture(scope, source);
    if (capture === null) {
        return {
            ok: false,
            output: stop(
                `${label}: no read in this run; run \`collector ${source}\` through javascript_tool and run ${step} again`,
            ),
        };
    }
    const parsed = parse(captureJson(capture), scope.run.runId);
    if (parsed.ok) {
        return parsed;
    }
    return {
        ok: false,
        output:
            parsed.error.kind === "login-wall"
                ? askLogin(scope, source, step)
                : stop(`${label} could not be read: ${parsed.error.message}`),
    };
}

/** The live sheet, then IBKR, then the two collectors; the first failure decides the output. */
async function gather(
    ctx: StepContext,
    scope: RunScope,
    step: PhaseStep,
    onIbkrFailure: (failure: IbkrFailure) => StepOutput,
): Promise<Outcome<Inputs>> {
    const sheet = await readSheet(ctx, scope);
    if (!sheet.ok) {
        return { ok: false, output: stop(sheet.reason) };
    }
    const ibkr = readIbkrSource(scope);
    if (!ibkr.ok) {
        return { ok: false, output: onIbkrFailure(ibkr.error) };
    }
    const sws = readCollector(scope, "sws-portfolio", parseSwsPortfolio, step);
    if (!sws.ok) {
        return sws;
    }
    const carteraViva = readCollector(scope, "cartera-viva", parseCarteraViva, step);
    if (!carteraViva.ok) {
        return carteraViva;
    }
    return {
        ok: true,
        value: {
            sheet: sheet.sheet,
            ibkr: ibkr.value,
            sws: sws.value,
            carteraViva: carteraViva.value,
        },
    };
}

// ---------------------------------------------------------------------------
// The report

const isStrings = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((item) => typeof item === "string");

/** The unknown-IBKR-tool warnings `ibkr-tools` recorded in this run. */
function toolWarnings(scope: RunScope): string[] {
    const path = warningsPath(scope.stateDir, scope.run.runId);
    if (!existsSync(path)) {
        return [];
    }
    const raw = jsonFile(path);
    return raw.ok && isStrings(raw.value)
        ? raw.value
        : ["warnings.json ignored: not a JSON array of strings"];
}

/** Learns this run's SWS links into `listings.json` and returns what the links may use. */
function learnListings(
    scope: RunScope,
    sws: SwsPortfolioRead,
): { listings: Listings; warning: string | null } {
    const path = listingsPath(scope.stateDir);
    const read = parseListings(existsSync(path) ? readFileSync(path, "utf8") : "");
    const listings = learnFromLinks(read.listings, sws.links);
    writePrivate(path, serialiseListings(listings));
    return { listings, warning: read.warning };
}

function writeReport(
    ctx: StepContext,
    scope: RunScope,
    inputs: Inputs,
): { report: Report; path: string } {
    const previous = readPrevious(scope);
    const findings = withRepeatCounts(
        runChecks({ ...inputs, excludedTickers: scope.config.excludedTickers }),
        previous.snapshot,
    );
    const learnt = learnListings(scope, inputs.sws);
    const notes = [learnt.warning, previous.warning].filter((note) => note !== null);
    const report = buildReport({
        runId: scope.run.runId,
        generatedAt: ctx.now().toISOString(),
        ibkr: inputs.ibkr,
        swsCount: inputs.sws.count,
        carteraVivaCount: inputs.carteraViva.cards.length,
        warnings: [...toolWarnings(scope), ...notes],
        findings,
        gate: decideGate(findings),
        previous: previous.snapshot,
        links: tickerLinks([...new Set(findings.map((item) => item.ticker))], {
            runLinks: inputs.sws.links,
            listings: learnt.listings,
        }),
        watchlist: null,
    });
    const path = reportPath(scope.stateDir, scope.run.runId);
    writePrivate(path, JSON.stringify(report, null, 2));
    return { report, path };
}

/** The whole report, the pane's feed line (design D13), then what the command runs next. */
function reportOutput(
    { report, path }: { report: Report; path: string },
    directive: Directive,
    next: string,
): StepOutput {
    return {
        markdown: `${renderMarkdown(report)}\nstonks-report-path: ${path}\n\n${next}`,
        directive,
    };
}

// ---------------------------------------------------------------------------
// Steps

const phase1: Step = async (ctx, args) => {
    noArgs("phase1", args);
    const opened = openRun(ctx);
    if (!opened.ok) {
        return opened.output;
    }
    const { scope } = opened;
    const { mode } = scope.run;
    if (mode === "watchlist") {
        return stop("phase 1 does not run in --only watchlist");
    }
    const gathered = await gather(ctx, scope, "phase1", (failure) =>
        ibkrUnread(ctx, scope, failure),
    );
    if (!gathered.ok) {
        return gathered.output;
    }
    const written = writeReport(ctx, scope, gathered.value);
    if (written.report.gate.tripped && mode === "full") {
        return reportOutput(written, { kind: "gate-wait" }, NEXT_GATE);
    }
    return reportOutput(written, { kind: "done" }, mode === "full" ? NEXT_PHASE2 : NEXT_END);
};

const sigue: Step = async (ctx, args) => {
    noArgs("sigue", args);
    const opened = openRun(ctx);
    if (!opened.ok) {
        return opened.output;
    }
    const { scope } = opened;
    if (scope.run.mode !== "full") {
        return stop(`sigue follows the gate of a full run, not --only ${scope.run.mode}`);
    }
    if (!existsSync(reportPath(scope.stateDir, scope.run.runId))) {
        return stop("phase 1 has not run in this run");
    }
    const gathered = await gather(ctx, scope, "sigue", (failure) =>
        stop(`IBKR could not be read: ${describeFailure(failure)}`),
    );
    if (!gathered.ok) {
        return gathered.output;
    }
    return reportOutput(
        writeReport(ctx, scope, gathered.value),
        { kind: "done" },
        `The gate does not pause again.\n\n${NEXT_PHASE2}`,
    );
};

export const phase1Steps: StepTable = {
    phase1: { step: phase1 },
    sigue: { step: sigue },
};
