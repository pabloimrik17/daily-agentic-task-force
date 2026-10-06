// Phase 2 steps (design D9, D10, D11, D12; spec stonks-watchlist): plan from
// the live sheet and the live watchlist, resolve each addition to one exact
// listing, verify every change and the final set. `plan.json` is the only
// memory between steps; nothing is repaired, a mismatch stops (design D16).

import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";

import {
    type BrowserSource,
    type CarteraVivaCard,
    type Directive,
    formatListing,
    REPORT_SCHEMA,
    type Report,
    type WatchlistItem,
    type WatchlistRead,
} from "../domain.ts";
import { parseCarteraViva } from "../inputs/cartera-viva.ts";
import { parseDropdown } from "../inputs/dropdown.ts";
import type { ReadResult } from "../inputs/envelope.ts";
import { parseWatchlist } from "../inputs/watchlist.ts";
import { watchlistBlock } from "../report/markdown.ts";
import { planPath, listingsPath, reportPath, writePrivate } from "../state.ts";
import { normaliseTicker, parseListing } from "../ticker.ts";
import { candidates } from "../watchlist/candidates.ts";
import {
    learnAddition,
    learnFromLinks,
    type Listings,
    parseListings,
    serialiseListings,
} from "../watchlist/listings.ts";
import { type Plan, plan as planChanges, steps } from "../watchlist/plan.ts";
import { sameExchange, searchTerm, select, target } from "../watchlist/resolve.ts";
import { type ChangeDirective, verifyChange, verifyFinal } from "../watchlist/verify.ts";
import {
    type Capture,
    captureJson,
    latestCapture,
    openRun,
    readSheet,
    type RunScope,
    stop,
} from "./shared.ts";
import {
    type Step,
    type StepContext,
    type StepOutput,
    type StepTable,
    UsageError,
} from "./types.ts";

const PLAN_SCHEMA = "stonks.plan.v1";

/** The row `watchlist-resolve` selected, kept until `watchlist-verify` learns it. */
interface Selected {
    ticker: string;
    symbol: string;
    name: string;
    /** The dropdown carries no URL; the verified read supplies it. */
    url: string | null;
}

interface PlanState {
    schema: typeof PLAN_SCHEMA;
    plan: Plan;
    pending: ChangeDirective[];
    done: ChangeDirective[];
    unresolved: string[];
    /** Tickers on the watchlist as of `lastCapture`, in the collector's row order. */
    current: string[];
    /** The link path of each row of `current`, which `watchlist-row-menu` checks before acting. */
    rowPaths: string[];
    lastCapture: string;
    /** The dropdown read the last `watchlist-resolve` used; the next one must be newer. */
    lastDropdown: string | null;
    selected: Selected | null;
}

type DropdownRows = Extract<ReturnType<typeof parseDropdown>, { ok: true }>["value"];

type Outcome<T> = { ok: true; value: T } | { ok: false; output: StepOutput };

const askLogin = (source: BrowserSource, again: string): StepOutput => ({
    markdown: `${source} shows a login page. Ask the user to log in to it, wait, then run \`collector ${source}\` and \`${again}\` again. Never type credentials.`,
    directive: { kind: "ask-login", source },
});

const tickerOf = (item: WatchlistItem): string => normaliseTicker(item.listing.ticker);

function pathOf(item: WatchlistItem): string {
    try {
        return item.link === null ? "" : new URL(item.link.href).pathname;
    } catch {
        return "";
    }
}

/** Captures sort by their `<seq>-` prefix, whatever their kind. */
const seqOf = (path: string): string => basename(path).split("-", 1)[0] ?? "";

const isAfter = (path: string, than: string | null): boolean =>
    than === null || seqOf(path) > seqOf(than);

function listingsOf(scope: RunScope): Listings {
    const path = listingsPath(scope.stateDir);
    return existsSync(path) ? parseListings(readFileSync(path, "utf8")).listings : {};
}

function saveListings(scope: RunScope, listings: Listings): void {
    writePrivate(listingsPath(scope.stateDir), serialiseListings(listings));
}

function savePlan(scope: RunScope, state: PlanState): void {
    writePrivate(planPath(scope.stateDir, scope.run.runId), `${JSON.stringify(state, null, 2)}\n`);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;

function hasPlanShape(raw: unknown): raw is Partial<PlanState> {
    return (
        isRecord(raw) &&
        raw.schema === PLAN_SCHEMA &&
        [raw.pending, raw.done, raw.unresolved, raw.current, raw.rowPaths].every(Array.isArray) &&
        typeof raw.lastCapture === "string" &&
        isRecord(raw.plan)
    );
}

function loadPlan(scope: RunScope, step: string): Outcome<PlanState> {
    const path = planPath(scope.stateDir, scope.run.runId);
    if (!existsSync(path)) {
        return {
            ok: false,
            output: stop(`no watchlist plan in this run; run \`watchlist-plan\` before ${step}`),
        };
    }
    let raw: unknown;
    try {
        raw = JSON.parse(readFileSync(path, "utf8"));
    } catch {
        return {
            ok: false,
            output: stop("plan.json is not valid JSON; run `watchlist-plan` again"),
        };
    }
    if (!hasPlanShape(raw)) {
        return {
            ok: false,
            output: stop("plan.json has an unknown shape; run `watchlist-plan` again"),
        };
    }
    return { ok: true, value: { selected: null, lastDropdown: null, ...raw } as PlanState };
}

/** Phase 2 never runs in `--only sources`. */
function phase2Scope(
    ctx: Parameters<typeof openRun>[0],
): { ok: true; scope: RunScope } | { ok: false; output: StepOutput } {
    const opened = openRun(ctx);
    if (opened.ok && opened.scope.run.mode === "sources") {
        return { ok: false, output: stop("phase 2 does not run in --only sources") };
    }
    return opened;
}

/** The run scope and its plan, or the output to print when either is unusable. */
function openPlan(ctx: StepContext, step: string): Outcome<{ scope: RunScope; state: PlanState }> {
    const opened = phase2Scope(ctx);
    if (!opened.ok) {
        return opened;
    }
    const loaded = loadPlan(opened.scope, step);
    return loaded.ok ? { ok: true, value: { scope: opened.scope, state: loaded.value } } : loaded;
}

function readWatchlist(scope: RunScope, capture: Capture): ReadResult<WatchlistRead> {
    return parseWatchlist(captureJson(capture), scope.run.runId, scope.config);
}

/** The newest watchlist capture, parsed; the output to print when there is none or it is unusable. */
function newestWatchlist(
    scope: RunScope,
    step: string,
): Outcome<{ path: string; read: WatchlistRead }> {
    const capture = latestCapture(scope, "watchlist");
    if (capture === null) {
        return {
            ok: false,
            output: stop(
                `watchlist: no read in this run; run \`collector watchlist\` and run ${step} again`,
            ),
        };
    }
    const read = readWatchlist(scope, capture);
    if (!read.ok) {
        return {
            ok: false,
            output:
                read.error.kind === "login-wall"
                    ? askLogin("watchlist", step)
                    : stop(`watchlist: ${read.error.message}`),
        };
    }
    return { ok: true, value: { path: capture.path, read: read.value } };
}

/** As `newestWatchlist`, but the read must be newer than the one the plan last saw. */
function freshWatchlist(
    scope: RunScope,
    state: PlanState,
    step: string,
): Outcome<{ path: string; read: WatchlistRead }> {
    const newest = newestWatchlist(scope, step);
    if (newest.ok && newest.value.path === state.lastCapture) {
        return {
            ok: false,
            output: stop(
                "no fresh watchlist read since the change; run `collector watchlist` and run " +
                    `${step} again`,
            ),
        };
    }
    return newest;
}

const code = (text: string): string => `\`${text}\``;

const STOP_ON_REFUSAL = `An action that answers ${code("done: false")} is a stop: relay its reason and run ${code("end")}.`;

/** The numbered browser steps and the engine step to run for the next change, or the final read. */
function nextSteps(directive: Directive, state: PlanState): string {
    if (directive.kind === "remove") {
        const index = state.current.indexOf(normaliseTicker(directive.ticker));
        return [
            `Next: remove ${directive.ticker} (row ${index}). Run, in order:`,
            `1. ${code(`action watchlist-row-menu ${index} ${state.rowPaths[index] ?? ""}`)}`,
            `2. ${code("action remove-from-menu")}`,
            `3. ${code("collector watchlist")}`,
            `4. ${code("watchlist-verify")}`,
            "",
            STOP_ON_REFUSAL,
        ].join("\n");
    }
    if (directive.kind === "add") {
        return `Next: add ${directive.ticker}. Run ${code(`watchlist-search ${directive.ticker}`)}.`;
    }
    return `Next: run ${code("collector watchlist")}, then ${code("watchlist-final")}.`;
}

function next(state: PlanState, lead: string[]): StepOutput {
    const [first] = state.pending;
    const directive: Directive = first ?? { kind: "done" };
    return {
        markdown: [...lead, "", nextSteps(directive, state)].join("\n"),
        directive,
    };
}

const list = (items: string[]): string => (items.length === 0 ? "none" : items.join(", "));

const planStep: StepTable[string]["step"] = async (ctx) => {
    const opened = phase2Scope(ctx);
    if (!opened.ok) {
        return opened.output;
    }
    const { scope } = opened;
    const sheet = await readSheet(ctx, scope);
    if (!sheet.ok) {
        return stop(sheet.reason);
    }
    const newest = newestWatchlist(scope, "watchlist-plan");
    if (!newest.ok) {
        return newest.output;
    }
    const { path, read } = newest.value;
    saveListings(
        scope,
        learnFromLinks(
            listingsOf(scope),
            read.items.flatMap((item) => (item.link === null ? [] : [item.link])),
        ),
    );
    const changes = planChanges(candidates(sheet.sheet), read);
    const pending = steps(changes) as ChangeDirective[];
    const state: PlanState = {
        schema: PLAN_SCHEMA,
        plan: changes,
        pending,
        done: [],
        unresolved: [],
        current: read.items.map(tickerOf),
        rowPaths: read.items.map(pathOf),
        lastCapture: path,
        lastDropdown: null,
        selected: null,
    };
    savePlan(scope, state);
    if (changes.overCapacity !== null) {
        const { desired, capacity } = changes.overCapacity;
        return {
            markdown: [
                "## Watchlist plan",
                "",
                `${desired} tickers are desired and the capacity is ${capacity}: no change is made.`,
                "",
                nextSteps({ kind: "done" }, state),
            ].join("\n"),
            directive: { kind: "done" },
        };
    }
    const lead = [
        "## Watchlist plan",
        "",
        `- Remove: ${list(changes.removals)}`,
        `- Add: ${list(changes.additions)}`,
        `- Watchlist now: ${read.count}/${read.capacity}`,
    ];
    if (pending.length === 0) {
        lead.push("", "The watchlist is in step; nothing to change.");
    }
    return next(state, lead);
};

function tickerArg(args: readonly string[], step: string): string {
    const [raw, ...rest] = args;
    if (raw === undefined || raw.trim() === "" || rest.length > 0) {
        throw new UsageError(`${step} takes one ticker`);
    }
    return normaliseTicker(raw);
}

const searchStep = (ctx: StepContext, args: readonly string[]): StepOutput => {
    const ticker = tickerArg(args, "watchlist-search");
    const opened = phase2Scope(ctx);
    if (!opened.ok) {
        return opened.output;
    }
    const { scope } = opened;
    const listings = listingsOf(scope);
    const wanted = target(ticker, listings);
    const cartera = latestCapture(scope, "cartera-viva");
    const parsed =
        cartera === null ? null : parseCarteraViva(captureJson(cartera), scope.run.runId);
    const cards: CarteraVivaCard[] = parsed?.ok ? parsed.value.cards : [];
    const term = searchTerm(ticker, listings, cards);
    return {
        markdown: [
            `## Add ${ticker}`,
            "",
            `Target: ${wanted.kind === "known" ? formatListing(wanted.listing) : `${ticker} on a US primary exchange`}`,
            term === null
                ? `Search term: no name known; choose a search term for ${ticker} yourself (a hint only).`
                : `Search term: ${term} (a hint only)`,
            "",
            "Run, in order:",
            `1. ${code("action reposition-add-panel")}`,
            `2. Type the term with ${code("computer")} ${code("type")}: the action leaves the search box focused.`,
            `3. ${code("action expand-listings")}, where "+ N listings" shows.`,
            `4. ${code("collector dropdown")}`,
            `5. ${code(`watchlist-resolve ${ticker}`)}`,
        ].join("\n"),
        directive: { kind: "add", ticker },
    };
};

function unresolvedOutput(
    scope: RunScope,
    state: PlanState,
    ticker: string,
    selection: Extract<ReturnType<typeof select>, { kind: "unresolved" }>,
): StepOutput {
    state.pending = state.pending.slice(1);
    state.unresolved = [...state.unresolved, ticker];
    state.selected = null;
    savePlan(scope, state);
    const seen = selection.candidates.map(
        (row) =>
            `- ${row.index}: ${row.label} (${row.listing === null ? "no symbol" : formatListing(row.listing)})`,
    );
    return next(state, [
        `## ${ticker} is unresolved`,
        "",
        `${ticker} is not added: ${selection.reason}.`,
        ...(seen.length === 0 ? [] : ["", `Results with the ticker ${ticker}:`, ...seen]),
        "",
        `Ask the user for the exact listing of ${ticker}.`,
    ]);
}

function selectedOutput(
    scope: RunScope,
    state: PlanState,
    ticker: string,
    row: Extract<ReturnType<typeof select>, { kind: "selected" }>["row"],
): StepOutput {
    const listing = row.listing as NonNullable<typeof row.listing>;
    state.selected = {
        ticker,
        symbol: formatListing(listing),
        name: row.label,
        url: null,
    };
    savePlan(scope, state);
    return {
        markdown: [
            `## ${ticker} resolved`,
            "",
            `Selected row ${row.index}: ${row.label} (${formatListing(listing)}).`,
            "",
            "Run, in order:",
            `1. ${code(`action click-row ${row.index} ${formatListing(listing)}`)}`,
            `2. ${code("collector watchlist")}`,
            `3. ${code("watchlist-verify")}`,
            "",
            STOP_ON_REFUSAL,
        ].join("\n"),
        directive: { kind: "add", ticker },
    };
}

/**
 * The newest dropdown capture, parsed, when it is newer than the last change
 * and than the dropdown an earlier `watchlist-resolve` used: an older one
 * shows another ticker's search. Otherwise the output to print.
 */
function freshDropdown(
    scope: RunScope,
    state: PlanState,
    ticker: string,
): Outcome<{ path: string; rows: DropdownRows }> {
    const capture = latestCapture(scope, "dropdown");
    if (
        capture === null ||
        !isAfter(capture.path, state.lastCapture) ||
        !isAfter(capture.path, state.lastDropdown)
    ) {
        return {
            ok: false,
            output: stop(
                `dropdown: no read since the search for ${ticker}; run \`collector dropdown\` and run watchlist-resolve ${ticker} again`,
            ),
        };
    }
    const rows = parseDropdown(captureJson(capture), scope.run.runId);
    if (rows.ok) {
        return { ok: true, value: { path: capture.path, rows: rows.value } };
    }
    return {
        ok: false,
        output:
            rows.error.kind === "login-wall"
                ? askLogin("watchlist", `watchlist-resolve ${ticker}`)
                : stop(`dropdown: ${rows.error.message}`),
    };
}

const resolveStep = (ctx: StepContext, args: readonly string[]): StepOutput => {
    const ticker = tickerArg(args, "watchlist-resolve");
    const opened = openPlan(ctx, "watchlist-resolve");
    if (!opened.ok) {
        return opened.output;
    }
    const { scope, state } = opened.value;
    const [first] = state.pending;
    if (first?.kind !== "add" || first.ticker !== ticker) {
        return stop(`${ticker} is not the next addition of the plan`);
    }
    const fresh = freshDropdown(scope, state, ticker);
    if (!fresh.ok) {
        return fresh.output;
    }
    state.lastDropdown = fresh.value.path;
    const selection = select(fresh.value.rows, target(ticker, listingsOf(scope)));
    return selection.kind === "unresolved"
        ? unresolvedOutput(scope, state, ticker, selection)
        : selectedOutput(scope, state, ticker, selection.row);
};

/** Learn the listing `watchlist-resolve` selected, from the link the verified read shows. */
function learnSelected(
    scope: RunScope,
    state: PlanState,
    change: ChangeDirective,
    read: WatchlistRead,
): void {
    const { selected } = state;
    if (change.kind !== "add" || selected?.ticker !== change.ticker) {
        return;
    }
    const link = read.items.find((item) => tickerOf(item) === change.ticker)?.link ?? null;
    const listing = parseListing(selected.symbol);
    if (link !== null && listing !== null) {
        saveListings(
            scope,
            learnAddition(listingsOf(scope), listing, link.name ?? selected.name, link.href),
        );
    }
}

/** Why an addition did not land as the listing `watchlist-resolve` selected; null when it did. */
function wrongListing(
    state: PlanState,
    change: ChangeDirective,
    read: WatchlistRead,
): string | null {
    const selected =
        state.selected?.ticker === change.ticker ? parseListing(state.selected.symbol) : null;
    if (selected === null) {
        return `no listing was selected for ${change.ticker}; run \`watchlist-resolve ${change.ticker}\` before adding it`;
    }
    const added = read.items.find((item) => tickerOf(item) === change.ticker);
    if (added === undefined || sameExchange(added.listing.exchange, selected.exchange)) {
        return null;
    }
    return `${formatListing(added.listing)} was added instead of ${formatListing(selected)}`;
}

/** The change's verdict against the fresh read: the tickers now on the watchlist, or the reason to stop. */
function verifyAgainst(
    state: PlanState,
    change: ChangeDirective,
    read: WatchlistRead,
): Outcome<string[]> {
    const after = read.items.map(tickerOf);
    const verdict = verifyChange(state.current, after, change);
    if (!verdict.ok) {
        return { ok: false, output: stop(verdict.reason) };
    }
    const wrong = change.kind === "add" ? wrongListing(state, change, read) : null;
    return wrong === null ? { ok: true, value: after } : { ok: false, output: stop(wrong) };
}

const verifyStep = (ctx: StepContext): StepOutput => {
    const opened = openPlan(ctx, "watchlist-verify");
    if (!opened.ok) {
        return opened.output;
    }
    const { scope, state } = opened.value;
    const [change] = state.pending;
    if (change === undefined) {
        return stop("no change is pending; run `watchlist-final`");
    }
    const fresh = freshWatchlist(scope, state, "watchlist-verify");
    if (!fresh.ok) {
        return fresh.output;
    }
    const { path, read } = fresh.value;
    const after = verifyAgainst(state, change, read);
    if (!after.ok) {
        return after.output;
    }
    learnSelected(scope, state, change, read);
    state.pending = state.pending.slice(1);
    state.done = [...state.done, change];
    state.current = after.value;
    state.rowPaths = read.items.map(pathOf);
    state.lastCapture = path;
    state.selected = null;
    savePlan(scope, state);
    return next(state, [
        `Verified: ${change.kind} ${change.ticker}. Watchlist now ${read.count}/${read.capacity}.`,
    ]);
};

const finalStep = (ctx: StepContext): StepOutput => {
    const opened = openPlan(ctx, "watchlist-final");
    if (!opened.ok) {
        return opened.output;
    }
    const { scope, state } = opened.value;
    const fresh = freshWatchlist(scope, state, "watchlist-final");
    if (!fresh.ok) {
        return fresh.output;
    }
    const result = verifyFinal(
        state.plan.desired,
        fresh.value.read.items.map(tickerOf),
        state.plan,
        state.unresolved,
    );
    const block = watchlistBlock(result);
    const path = reportPath(scope.stateDir, scope.run.runId);
    if (!existsSync(path)) {
        return { markdown: block, directive: { kind: "done" } };
    }
    let report: Report;
    try {
        report = JSON.parse(readFileSync(path, "utf8")) as Report;
    } catch {
        return stop("report.json is not valid JSON; run `phase1` again");
    }
    if (report.schema !== REPORT_SCHEMA) {
        return stop("report.json has an unknown schema; run `phase1` again");
    }
    report.watchlist = result;
    writePrivate(path, JSON.stringify(report, null, 2));
    return {
        markdown: `${block}\n\nstonks-report-path: ${path}`,
        directive: { kind: "done" },
    };
};

/** A synchronous step as a `Step`: a throw becomes a rejection, as in an async one. */
const lift =
    (step: (ctx: StepContext, args: readonly string[]) => StepOutput): Step =>
    (ctx, args) =>
        new Promise((resolve) => {
            resolve(step(ctx, args));
        });

export const watchlistSteps: StepTable = {
    "watchlist-plan": { step: planStep },
    "watchlist-search": { step: lift(searchStep) },
    "watchlist-resolve": { step: lift(resolveStep) },
    "watchlist-verify": { step: lift(verifyStep) },
    "watchlist-final": { step: lift(finalStep) },
};
