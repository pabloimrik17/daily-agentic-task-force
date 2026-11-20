import type { RunArgs } from "../args.ts";
import type { Exec } from "../exec.ts";
import type { RunContext } from "../runner.ts";
import { type OpenUsageExec, openUsageSource } from "./openusage.ts";
import type { QuotaAccount } from "./source.ts";

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

// A balance shaped like the `rateLimitResets` that OpenUsage 0.8.0 prints for a Claude account.
export function balance(available: number) {
    return {
        kind: "balance",
        unit: "resets",
        available,
        expiresAt: [isoFromNow(2 * DAY), isoFromNow(25 * DAY)],
    };
}

export const session = (used: number, elapsedHours = 2) =>
    resource(used, elapsedHours * HOUR, 5 * HOUR);
export const weekly = (used: number, elapsedDays = 3) => resource(used, elapsedDays * DAY, 7 * DAY);

export const ANA = "ana@example.com";
export const LUIS = "luis@example.com";

export function provider(
    resources: Record<string, unknown>,
    overrides: Record<string, unknown> = {},
) {
    return {
        displayName: `Claude · ${ANA}`,
        plan: "Pro",
        fetchedAt: isoFromNow(-60),
        expiresAt: isoFromNow(240),
        stale: false,
        resources,
        ...overrides,
    };
}

// OpenUsage 0.8 keys an account by its kind and the first 8 hex digits of its id.
export const ACCOUNT = "claude@1a2b3c4d";

export function limits(providers: Record<string, unknown>) {
    return { schema: "openusage.limits.v2", generatedAt: NOW.toISOString(), providers };
}

export function fakeExec(output: unknown): OpenUsageExec & { calls: string[][] } {
    const calls: string[][] = [];
    const exec = (args: string[]) => {
        calls.push(args);
        return Promise.resolve({ ok: true as const, stdout: JSON.stringify(output) });
    };
    return Object.assign(exec, { calls });
}

// The accounts the OpenUsage quota source reads from a document with these providers.
export async function quotaAccounts(providers: Record<string, unknown>): Promise<QuotaAccount[]> {
    const read = await openUsageSource(fakeExec(limits(providers))).read();
    if (!read.ok) throw new Error(read.error);
    return read.accounts;
}

// OpenUsage 0.8.0 with no Claude account fetched yet: exit 4, the empty envelope on stdout.
export const nothingFetchedDocument = limits({});
export const nothingFetchedStderr =
    "openusage: nothing fetched yet; open OpenUsage and add or refresh an account\n";

// A failed exec that carries the exit output, as `execOpenUsage` returns it.
export function exitExec(
    stdout: string,
    stderr: string,
    code = 4,
): OpenUsageExec & { calls: string[][] } {
    const calls: string[][] = [];
    const exec = (args: string[]) => {
        calls.push(args);
        return Promise.resolve({
            ok: false as const,
            error: `openusage failed: ${stderr.trim()}`,
            exit: { code, stdout },
        });
    };
    return Object.assign(exec, { calls });
}

// What `claude auth status` printed on Claude Code 2.1.325 for a login, fields the gate
// ignores included; with no email it is the answer for no login, exit 1.
export function authStatus(email?: string) {
    if (email === undefined) {
        return { loggedIn: false, authMethod: "none", apiProvider: "firstParty" };
    }
    return {
        loggedIn: true,
        authMethod: "claude.ai",
        apiProvider: "firstParty",
        email,
        orgId: "00000000-0000-0000-0000-000000000000",
        orgName: "Example",
        subscriptionType: "pro",
    };
}

// A `claude` that answers `auth status` with each email address in turn, keeping the last.
export function fakeLogin(...emails: string[]): Exec & { calls: string[][] } {
    const calls: string[][] = [];
    const exec = (args: string[]) => {
        calls.push(args);
        const email = emails[Math.min(calls.length, emails.length) - 1];
        return Promise.resolve({ ok: true as const, stdout: JSON.stringify(authStatus(email)) });
    };
    return Object.assign(exec, { calls });
}

export function context(
    exec: OpenUsageExec,
    args: Partial<RunArgs> = {},
    login: Exec = fakeLogin(ANA),
): RunContext {
    return {
        args: {
            task: undefined,
            stage: undefined,
            discard: undefined,
            transition: undefined,
            persist: undefined,
            pullRequest: undefined,
            title: undefined,
            log: undefined,
            releaseWorkspace: false,
            force: false,
            json: false,
            apply: false,
            bootstrapLabels: false,
            noHandoff: false,
            answers: [],
            loop: false,
            grills: undefined,
            parallel: undefined,
            interval: undefined,
            notices: undefined,
            triageQuestions: false,
            stopLoop: false,
            ...args,
        },
        now: NOW,
        config: { ok: false, path: "", error: "unused" },
        results: [],
        io: {
            quota: openUsageSource(exec),
            login,
            trackers: () => {
                throw new Error("unused");
            },
            judgement: () => Promise.resolve({ ok: false, error: "unused" }),
            chezmoi: () => Promise.resolve({ ok: false, error: "unused" }),
            work: () => {
                throw new Error("unused");
            },
            selection: () => Promise.resolve({ ok: false, error: "unused" }),
            sessions: () => {
                throw new Error("unused");
            },
            workspace: () => {
                throw new Error("unused");
            },
            naming: () => Promise.resolve({ ok: false, error: "unused" }),
            context: () => {
                throw new Error("unused");
            },
            pullRequests: () => {
                throw new Error("unused");
            },
            openspec: () => Promise.resolve({ ok: false, error: "unused" }),
            git: () => Promise.resolve({ ok: false, error: "unused" }),
            state: "/unused/state",
            home: "/unused/home",
        },
    };
}
