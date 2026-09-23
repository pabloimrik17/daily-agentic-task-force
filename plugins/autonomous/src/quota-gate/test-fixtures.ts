import type { RunArgs } from "../args.ts";
import type { RunContext } from "../runner.ts";
import type { OpenUsageExec } from "./openusage.ts";

export const NOW = new Date("2026-09-23T12:00:00.000Z");

const HOUR = 3_600;
const DAY = 86_400;

function isoFromNow(seconds: number): string {
    return new Date(NOW.getTime() + seconds * 1000).toISOString();
}

// A window of `windowSeconds` that started `elapsedSeconds` before NOW.
export function resource(used: number, elapsedSeconds: number, windowSeconds: number, limit = 100) {
    return {
        kind: "consumption",
        unit: "percent",
        used,
        limit,
        remaining: Math.max(0, limit - used),
        utilization: limit > 0 ? used / limit : 0,
        resetsAt: isoFromNow(windowSeconds - elapsedSeconds),
        windowSeconds,
    };
}

export const session = (used: number, elapsedHours = 2) =>
    resource(used, elapsedHours * HOUR, 5 * HOUR);
export const weekly = (used: number, elapsedDays = 3) => resource(used, elapsedDays * DAY, 7 * DAY);

export function provider(
    resources: Record<string, unknown>,
    overrides: Record<string, unknown> = {},
) {
    return {
        displayName: "Claude: Personal (me@example.com)",
        plan: "Pro",
        fetchedAt: isoFromNow(-60),
        expiresAt: isoFromNow(240),
        stale: false,
        resources,
        ...overrides,
    };
}

export function limits(providers: Record<string, unknown>, errors: unknown[] = []) {
    return { schema: "openusage.limits.v1", generatedAt: NOW.toISOString(), providers, errors };
}

export function fakeExec(output: unknown): OpenUsageExec & { calls: string[][] } {
    const calls: string[][] = [];
    const exec = (args: string[]) => {
        calls.push(args);
        return Promise.resolve({ ok: true as const, stdout: JSON.stringify(output) });
    };
    return Object.assign(exec, { calls });
}

export function context(exec: OpenUsageExec, args: Partial<RunArgs> = {}): RunContext {
    return {
        args: { account: undefined, force: false, json: false, ...args },
        now: NOW,
        io: { openUsage: exec },
    };
}
