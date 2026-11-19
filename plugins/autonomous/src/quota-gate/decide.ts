import type { StepOutcome } from "../runner.ts";
import { type Projection, project } from "./project.ts";
import {
    EVALUATED_WINDOWS,
    type QuotaAccount,
    type QuotaResource,
    type WindowName,
} from "./source.ts";

export interface WindowReport {
    name: WindowName;
    used: number | null;
    limit: number | null;
    unit: string | null;
    resetsAt: string | null;
    windowSeconds: number | null;
    // Why the window cannot be evaluated; null when its data is complete, valid and not outdated.
    problem: string | null;
    // True only when used >= limit and the reset is still ahead; an exhaustion whose
    // reset has passed is reported as an `outdated` problem instead.
    exhausted: boolean;
    projection: Projection | null;
}

export interface OtherResource {
    name: string;
    used: number | null;
    limit: number | null;
    // A balance, such as `rateLimitResets`, has an available amount instead of used and limit.
    available: number | null;
    unit: string;
    evaluated: false;
}

export interface AccountReport {
    key: string;
    email: string | null;
    displayName: string;
    plan: string | null;
    fetchedAt: string;
    expiresAt: string;
    stale: boolean;
}

export interface Evaluation {
    outcome: StepOutcome;
    reasons: string[];
    windows: WindowReport[];
    otherResources: OtherResource[];
}

export function evaluateAccount(
    account: AccountReport,
    quota: QuotaAccount,
    now: Date,
): Evaluation {
    const { resources } = quota;
    const windows = EVALUATED_WINDOWS.map((name) => evaluateWindow(name, resources[name], now));
    const otherResources = Object.entries(resources)
        .filter(([name]) => !(EVALUATED_WINDOWS as readonly string[]).includes(name))
        .map(([name, r]) => ({
            name,
            used: r.used ?? null,
            limit: r.limit ?? null,
            available: r.available ?? null,
            unit: r.unit,
            evaluated: false as const,
        }));
    return { ...decide(account, windows), windows, otherResources };
}

function evaluateWindow(
    name: WindowName,
    resource: QuotaResource | undefined,
    now: Date,
): WindowReport {
    if (resource === undefined) {
        return { ...UNKNOWN_VALUES, name, problem: "missing", exhausted: false, projection: null };
    }
    const report: WindowReport = {
        ...windowValues(resource),
        name,
        problem: null,
        exhausted: false,
        projection: null,
    };
    const { used, limit, resetsAt, windowSeconds } = resource;
    if (
        used === undefined ||
        limit === undefined ||
        resetsAt === undefined ||
        windowSeconds === undefined
    ) {
        const absent = REQUIRED_VALUES.filter((k) => resource[k] === undefined);
        return { ...report, problem: `incomplete (no ${absent.join(", ")})` };
    }
    const invalid = invalidValues(used, limit, windowSeconds);
    if (invalid.length > 0) {
        return { ...report, problem: `invalid (${invalid.join(", ")})` };
    }
    return {
        ...report,
        ...exhaustion(used, limit, resetsAt, now),
        projection: project({ used, limit, resetsAt: new Date(resetsAt), windowSeconds, now }),
    };
}

// An exhausted window whose reset time has passed is outdated rather than
// exhausted: waiting for that reset would wait for nothing (design D6).
function exhaustion(
    used: number,
    limit: number,
    resetsAt: string,
    now: Date,
): Pick<WindowReport, "problem" | "exhausted"> {
    if (used < limit) return { problem: null, exhausted: false };
    if (now.getTime() < Date.parse(resetsAt)) return { problem: null, exhausted: true };
    return {
        problem: `outdated (exhausted, but its reset time ${resetsAt} has passed; OpenUsage refreshes on its own schedule, or refresh the account in its app)`,
        exhausted: false,
    };
}

function invalidValues(used: number, limit: number, windowSeconds: number): string[] {
    return [
        ...(used < 0 ? [`used = ${used}`] : []),
        ...(limit <= 0 ? [`limit = ${limit}`] : []),
        ...(windowSeconds <= 0 ? [`windowSeconds = ${windowSeconds}`] : []),
    ];
}

const REQUIRED_VALUES = ["used", "limit", "resetsAt", "windowSeconds"] as const;

type WindowValues = Pick<WindowReport, "used" | "limit" | "unit" | "resetsAt" | "windowSeconds">;

const UNKNOWN_VALUES: WindowValues = {
    used: null,
    limit: null,
    unit: null,
    resetsAt: null,
    windowSeconds: null,
};

function windowValues(resource: QuotaResource): WindowValues {
    return {
        used: resource.used ?? null,
        limit: resource.limit ?? null,
        unit: resource.unit,
        resetsAt: resource.resetsAt ?? null,
        windowSeconds: resource.windowSeconds ?? null,
    };
}

// Precedence (design D6): exhausted → wait; missing, incomplete, invalid,
// outdated or stale → not-evaluable; otherwise advance. Projection never
// affects the outcome. OpenUsage 0.8 reports an account whose refreshes fail
// only as stale, so staleness alone decides whether the data is fresh.
function decide(
    account: AccountReport,
    windows: WindowReport[],
): Pick<Evaluation, "outcome" | "reasons"> {
    const fresh = !account.stale;

    const exhausted = fresh ? windows.filter((w) => w.problem === null && w.exhausted) : [];
    if (exhausted.length > 0) {
        return {
            outcome: "wait",
            reasons: exhausted.map(
                (w) =>
                    `${w.name} window exhausted: ${w.used}/${w.limit} ${w.unit}, resets at ${w.resetsAt}`,
            ),
        };
    }

    const blockers = [
        ...(account.stale
            ? [
                  `data is stale: fetched at ${account.fetchedAt}, expired at ${account.expiresAt}; OpenUsage is not running or its refreshes of ${account.key} are failing`,
              ]
            : []),
        ...windows.filter((w) => w.problem !== null).map((w) => `${w.name} window ${w.problem}`),
    ];
    if (blockers.length > 0) {
        return { outcome: "not-evaluable", reasons: blockers };
    }

    return {
        outcome: "advance",
        reasons: windows.map(
            (w) =>
                `${w.name} window has capacity: ${w.used}/${w.limit} ${w.unit}, resets at ${w.resetsAt}`,
        ),
    };
}
