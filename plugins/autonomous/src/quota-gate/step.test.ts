import { describe, expect, it } from "vitest";

import type { Exec } from "../exec.ts";
import { quotaGateStep } from "./step.ts";
import {
    ACCOUNT,
    ANA,
    balance,
    context,
    exitExec,
    fakeExec,
    fakeLogin,
    limits,
    LUIS,
    nothingFetchedDocument,
    nothingFetchedStderr,
    provider,
    resource,
    session,
    weekly,
} from "./test-fixtures.ts";

const WORK = "claude@9f8e7d6c";
const asLuis = { displayName: `Claude · ${LUIS}` };

async function gate(output: unknown, login: Exec = fakeLogin(ANA)) {
    return quotaGateStep.run(context(fakeExec(output), {}, login));
}

describe("quota gate decision: advance", () => {
    it("advances with capacity in both windows", async () => {
        const result = await gate(
            limits({ [ACCOUNT]: provider({ session: session(20), weekly: weekly(30) }) }),
        );
        expect(result.outcome).toBe("advance");
        expect(result.tier).toBe("code");
        const [s, w] = result.data.windows;
        expect(s?.projection).toMatchObject({ available: true });
        expect(w?.projection).toMatchObject({ available: true });
    });

    it("advances when only the projection exceeds capacity", async () => {
        // 52% after 2h of 5h projects to 130%
        const result = await gate(
            limits({ [ACCOUNT]: provider({ session: session(52), weekly: weekly(30) }) }),
        );
        expect(result.outcome).toBe("advance");
        const projection = result.data.windows[0]?.projection;
        expect(projection?.available && projection.projectedUsage).toBeCloseTo(130);
    });

    it("lists other resources as not evaluated without affecting the outcome", async () => {
        const result = await gate(
            limits({
                [ACCOUNT]: provider({
                    session: session(20),
                    weekly: weekly(30),
                    fable: weekly(100),
                    rateLimitResets: balance(0),
                }),
            }),
        );
        expect(result.outcome).toBe("advance");
        expect(result.data.otherResources).toEqual([
            {
                name: "fable",
                used: 100,
                limit: 100,
                available: null,
                unit: "percent",
                evaluated: false,
            },
            {
                name: "rateLimitResets",
                used: null,
                limit: null,
                available: 0,
                unit: "resets",
                evaluated: false,
            },
        ]);
    });
});

describe("quota gate decision: wait", () => {
    it("waits on an exhausted window and names its reset", async () => {
        const exhausted = weekly(100);
        const result = await gate(
            limits({ [ACCOUNT]: provider({ session: session(20), weekly: exhausted }) }),
        );
        expect(result.outcome).toBe("wait");
        expect(result.reasons).toEqual([
            `weekly window exhausted: 100/100 percent, resets at ${exhausted.resetsAt}`,
        ]);
    });

    it("waits at exactly used = limit", async () => {
        const result = await gate(
            limits({
                [ACCOUNT]: provider({
                    session: resource(40, 3_600, 18_000, 40),
                    weekly: weekly(30),
                }),
            }),
        );
        expect(result.outcome).toBe("wait");
    });

    it("lets an exhausted window beat a missing one, still reporting both", async () => {
        const result = await gate(limits({ [ACCOUNT]: provider({ session: session(100) }) }));
        expect(result.outcome).toBe("wait");
        expect(result.data.windows.map((w) => [w.name, w.problem])).toEqual([
            ["session", null],
            ["weekly", "missing"],
        ]);
    });
});

describe("quota gate decision: not evaluable from the account data", () => {
    it("is not evaluable on stale data, still reporting the last known values", async () => {
        const result = await gate(
            limits({
                [ACCOUNT]: provider({ session: session(20), weekly: weekly(100) }, { stale: true }),
            }),
        );
        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons[0]).toMatch(/^data is stale: fetched at /);
        expect(result.data.account?.stale).toBe(true);
        expect(result.data.windows.map((w) => w.used)).toEqual([20, 100]);
    });

    // OpenUsage 0.8 keeps a failing account's last values and marks them stale once they expire.
    const failing = (resources: Record<string, unknown>) =>
        provider(resources, {
            fetchedAt: "2026-09-23T11:00:00.000Z",
            expiresAt: "2026-09-23T11:10:00.000Z",
            stale: true,
        });
    const failingReason = `data is stale: fetched at 2026-09-23T11:00:00.000Z, expired at 2026-09-23T11:10:00.000Z; OpenUsage is not running or its refreshes of ${ACCOUNT} are failing`;

    it("is not evaluable on an exhausted window when the account's refreshes fail", async () => {
        const result = await gate(
            limits({ [ACCOUNT]: failing({ session: session(20), weekly: weekly(100) }) }),
        );
        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons).toEqual([failingReason]);
    });

    it("is not evaluable when the account's refreshes fail", async () => {
        const result = await gate(
            limits({ [ACCOUNT]: failing({ session: session(20), weekly: weekly(30) }) }),
        );
        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons).toEqual([failingReason]);
    });

    it("is not evaluable when no account has the active email address, listing them", async () => {
        const result = await gate(
            limits({
                [ACCOUNT]: provider({}, { displayName: "Claude · Personal" }),
                [WORK]: provider({}, asLuis),
            }),
        );
        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons).toEqual([`the active account ${ANA} is not reported`]);
        expect(result.data.account).toBeNull();
        expect(result.data.accounts).toEqual([
            { key: ACCOUNT, email: null, displayName: "Claude · Personal" },
            { key: WORK, email: LUIS, displayName: `Claude · ${LUIS}` },
        ]);
    });

    it("is not evaluable when OpenUsage cannot be read", async () => {
        const result = await quotaGateStep.run(
            context(() => Promise.resolve({ ok: false, error: "openusage CLI not found on PATH" })),
        );
        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons).toEqual(["openusage CLI not found on PATH"]);
    });
});

describe("quota gate decision: not evaluable from a window", () => {
    it("is not evaluable when a required window is missing", async () => {
        const result = await gate(limits({ [ACCOUNT]: provider({ session: session(20) }) }));
        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons).toEqual(["weekly window missing"]);
    });

    it("is not evaluable when a window lacks its reset time", async () => {
        const { resetsAt: _r, ...noReset } = weekly(30);
        const result = await gate(
            limits({ [ACCOUNT]: provider({ session: session(20), weekly: noReset }) }),
        );
        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons).toEqual(["weekly window incomplete (no resetsAt)"]);
    });

    it("is not evaluable when a window lacks its duration", async () => {
        const { windowSeconds: _w, ...noWindow } = session(20);
        const result = await gate(
            limits({ [ACCOUNT]: provider({ session: noWindow, weekly: weekly(30) }) }),
        );
        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons).toEqual(["session window incomplete (no windowSeconds)"]);
    });

    it("is not evaluable, rather than waiting, when an exhausted window is incomplete", async () => {
        const { resetsAt: _r, ...noReset } = session(100);
        const result = await gate(
            limits({ [ACCOUNT]: provider({ session: noReset, weekly: weekly(30) }) }),
        );
        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons).toEqual(["session window incomplete (no resetsAt)"]);
        expect(result.data.windows[0]).toMatchObject({ used: 100, limit: 100, exhausted: false });
    });

    it.each([
        ["limit = 0", resource(0, 7_200, 18_000, 0)],
        ["used = -5", session(-5)],
        ["windowSeconds = 0", { ...session(20), windowSeconds: 0 }],
    ])("is not evaluable when a window is invalid (%s)", async (invalid, s) => {
        const result = await gate(
            limits({ [ACCOUNT]: provider({ session: s, weekly: weekly(30) }) }),
        );
        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons).toEqual([`session window invalid (${invalid})`]);
        expect(result.data.windows.map((w) => w.used)).toEqual([s.used, 30]);
    });
});

describe("quota gate decision: another account's failing refreshes", () => {
    it("advances when only another account is stale", async () => {
        const result = await gate(
            limits({
                [ACCOUNT]: provider({ session: session(49), weekly: weekly(6) }),
                [WORK]: provider(
                    { session: session(20), weekly: weekly(30) },
                    { ...asLuis, stale: true },
                ),
            }),
        );
        expect(result.outcome).toBe("advance");
        expect(result.reasons.join("\n")).not.toMatch(new RegExp(`${WORK}|stale|failing`));
        expect(result.data.account?.stale).toBe(false);
    });

    it("does not count an account OpenUsage has not fetched yet", async () => {
        const result = await gate(
            limits({ [ACCOUNT]: provider({ session: session(20), weekly: weekly(30) }) }),
            fakeLogin(LUIS),
        );
        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons).toEqual([`the active account ${LUIS} is not reported`]);
        expect(result.data.accounts).toEqual([
            { key: ACCOUNT, email: ANA, displayName: `Claude · ${ANA}` },
        ]);
    });
});

describe("quota gate decision: not evaluable from malformed output", () => {
    it("is not evaluable after exit 0 when an account that is not selected is malformed", async () => {
        const result = await gate(
            limits({
                [ACCOUNT]: provider({ session: session(20), weekly: weekly(30) }),
                [WORK]: provider({}, { ...asLuis, resources: "none" }),
            }),
        );
        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons).toEqual([
            `openusage output does not match openusage.limits.v2: $.providers.${WORK}.resources must be an object`,
        ]);
    });
});

describe("quota gate step: --force stays off the OpenUsage call", () => {
    it.each([true, false])(
        "asks OpenUsage for the Claude accounts (--force: %s)",
        async (force) => {
            const exec = fakeExec(
                limits({ [ACCOUNT]: provider({ session: session(20), weekly: weekly(30) }) }),
            );
            const login = fakeLogin(ANA);
            const result = await quotaGateStep.run(context(exec, { force }, login));
            expect(exec.calls).toEqual([["claude"]]);
            expect(login.calls).toEqual([["auth", "status"]]);
            expect(result.outcome).toBe("advance");
        },
    );
});

describe("quota gate decision: windows past their reset time", () => {
    it("is not evaluable, rather than waiting, when an exhausted window's reset has passed", async () => {
        // 8 days into a 7-day window: the reset was a day ago
        const outdated = weekly(100, 8);
        const result = await gate(
            limits({ [ACCOUNT]: provider({ session: session(20), weekly: outdated }) }),
        );
        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons).toEqual([
            `weekly window outdated (exhausted, but its reset time ${outdated.resetsAt} has passed; OpenUsage refreshes on its own schedule, or refresh the account in its app)`,
        ]);
        expect(result.data.windows[1]).toMatchObject({ used: 100, limit: 100, exhausted: false });
    });

    it("is not evaluable when an exhausted window resets exactly now", async () => {
        const result = await gate(
            limits({ [ACCOUNT]: provider({ session: session(100, 5), weekly: weekly(30) }) }),
        );
        expect(result.outcome).toBe("not-evaluable");
        expect(result.data.windows[0]?.problem).toMatch(
            /^outdated \(exhausted, but its reset time /,
        );
    });

    it("still advances when a window below its limit is past its reset", async () => {
        const result = await gate(
            limits({ [ACCOUNT]: provider({ session: session(20, 6), weekly: weekly(30) }) }),
        );
        expect(result.outcome).toBe("advance");
        expect(result.data.windows[0]).toMatchObject({
            problem: null,
            projection: { available: false, reason: "window-expired" },
        });
    });

    it("lets an exhausted window beat an outdated one", async () => {
        const exhausted = session(100);
        const result = await gate(
            limits({ [ACCOUNT]: provider({ session: exhausted, weekly: weekly(100, 8) }) }),
        );
        expect(result.outcome).toBe("wait");
        expect(result.reasons).toEqual([
            `session window exhausted: 100/100 percent, resets at ${exhausted.resetsAt}`,
        ]);
        expect(result.data.windows[1]?.problem).toMatch(/^outdated \(exhausted, /);
    });
});

describe("quota gate decision: output after a non-zero exit", () => {
    const run = (stdout: string, stderr: string, code = 4) =>
        quotaGateStep.run(context(exitExec(stdout, stderr, code)));

    it("is not evaluable when nothing was fetched yet, naming the exit and stderr", async () => {
        const result = await run(JSON.stringify(nothingFetchedDocument), nothingFetchedStderr);
        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons).toEqual([
            "openusage failed: openusage: nothing fetched yet; open OpenUsage and add or refresh an account (exit 4)",
        ]);
        expect(result.data.accounts).toEqual([]);
    });

    it("is not evaluable when OpenUsage has no Claude account", async () => {
        const result = await run("", "openusage: Unknown provider: claude\n", 2);
        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons).toEqual([
            "openusage failed: openusage: Unknown provider: claude (exit 2)",
        ]);
    });

    it("does not read a valid document printed with a non-zero exit", async () => {
        const document = limits({
            [ACCOUNT]: provider({ session: session(49), weekly: weekly(6) }),
        });
        const result = await run(JSON.stringify(document), nothingFetchedStderr);
        expect(result.outcome).toBe("not-evaluable");
        expect(result.data.account).toBeNull();
        expect(result.reasons[0]).toMatch(/^openusage failed: .* \(exit 4\)$/);
    });
});

describe("quota gate step: the active account", () => {
    const capacity = () => provider({ session: session(20), weekly: weekly(30) });

    it("does not read the login when the quota cannot be read", async () => {
        const login = fakeLogin(ANA);
        const result = await quotaGateStep.run(
            context(exitExec("", nothingFetchedStderr), {}, login),
        );
        expect(result.outcome).toBe("not-evaluable");
        expect(login.calls).toEqual([]);
    });

    it("is not evaluable when the login cannot be read, still listing the accounts", async () => {
        const result = await gate(limits({ [ACCOUNT]: capacity(), [WORK]: capacity() }), () =>
            Promise.resolve({ ok: false, error: "claude CLI not found on PATH" }),
        );
        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons).toEqual(["claude CLI not found on PATH"]);
        expect(result.data.account).toBeNull();
        expect(result.data.accounts.map((a) => [a.key, a.email])).toEqual([
            [ACCOUNT, ANA],
            [WORK, ANA],
        ]);
    });

    it("evaluates the account of the login, and reports its email address", async () => {
        const result = await gate(
            limits({ [ACCOUNT]: capacity(), [WORK]: provider({ session: session(100) }, asLuis) }),
            fakeLogin(LUIS),
        );
        expect(result.outcome).toBe("wait");
        expect(result.data.account).toMatchObject({ key: WORK, email: LUIS });
    });
});

describe("quota gate step: other accounts with capacity", () => {
    const exhausted = session(100);
    const active = provider({ session: exhausted, weekly: weekly(30) });
    const capacity = (overrides: Record<string, unknown>) =>
        provider({ session: session(20), weekly: weekly(30) }, overrides);
    const OTHER = "claude@5e6f7a8b";

    it("waits on the active account and names another that would advance", async () => {
        const result = await gate(limits({ [ACCOUNT]: active, [WORK]: capacity(asLuis) }));
        const alone = await gate(limits({ [ACCOUNT]: active }));
        expect(result.outcome).toBe("wait");
        expect(result.reasons).toEqual(alone.reasons);
        expect(result.reasons).toEqual([
            `session window exhausted: 100/100 percent, resets at ${exhausted.resetsAt}`,
        ]);
        expect(result.data.account?.key).toBe(ACCOUNT);
        expect(result.data.accountsWithCapacity).toEqual([{ email: LUIS, key: WORK }]);
    });

    it("lists an account with no email address by its id", async () => {
        const result = await gate(
            limits({ [ACCOUNT]: active, [WORK]: capacity({ displayName: "Claude" }) }),
        );
        expect(result.data.accountsWithCapacity).toEqual([{ email: null, key: WORK }]);
    });

    it("lists no account when every other one is exhausted or stale", async () => {
        const result = await gate(
            limits({
                [ACCOUNT]: active,
                [WORK]: provider({ session: session(20), weekly: weekly(100) }, asLuis),
                [OTHER]: capacity({ displayName: "Claude · eva@example.com", stale: true }),
            }),
        );
        expect(result.outcome).toBe("wait");
        expect(result.data).not.toHaveProperty("accountsWithCapacity");
    });

    it("lists no account when the gate advances", async () => {
        const result = await gate(limits({ [ACCOUNT]: capacity({}), [WORK]: capacity(asLuis) }));
        expect(result.outcome).toBe("advance");
        expect(result.data).not.toHaveProperty("accountsWithCapacity");
    });
});
