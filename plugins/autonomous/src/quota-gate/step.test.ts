import { describe, expect, it } from "vitest";

import { quotaGateStep } from "./step.ts";
import { context, fakeExec, limits, provider, resource, session, weekly } from "./test-fixtures.ts";

async function gate(output: unknown, account?: string) {
    return quotaGateStep.run(context(fakeExec(output), { account }));
}

describe("quota gate decision: advance", () => {
    it("advances with capacity in both windows", async () => {
        const result = await gate(
            limits({ claude: provider({ session: session(20), weekly: weekly(30) }) }),
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
            limits({ claude: provider({ session: session(52), weekly: weekly(30) }) }),
        );
        expect(result.outcome).toBe("advance");
        const projection = result.data.windows[0]?.projection;
        expect(projection?.available && projection.projectedUsage).toBeCloseTo(130);
    });

    it("lists other resources as not evaluated without affecting the outcome", async () => {
        const result = await gate(
            limits({
                claude: provider({ session: session(20), weekly: weekly(30), fable: weekly(100) }),
            }),
        );
        expect(result.outcome).toBe("advance");
        expect(result.data.otherResources).toEqual([
            { name: "fable", used: 100, limit: 100, unit: "percent", evaluated: false },
        ]);
    });
});

describe("quota gate decision: wait", () => {
    it("waits on an exhausted window and names its reset", async () => {
        const exhausted = weekly(100);
        const result = await gate(
            limits({ claude: provider({ session: session(20), weekly: exhausted }) }),
        );
        expect(result.outcome).toBe("wait");
        expect(result.reasons).toEqual([
            `weekly window exhausted: 100/100 percent, resets at ${exhausted.resetsAt}`,
        ]);
    });

    it("waits at exactly used = limit", async () => {
        const result = await gate(
            limits({
                claude: provider({ session: resource(40, 3_600, 18_000, 40), weekly: weekly(30) }),
            }),
        );
        expect(result.outcome).toBe("wait");
    });

    it("lets an exhausted window beat a missing one, still reporting both", async () => {
        const result = await gate(limits({ claude: provider({ session: session(100) }) }));
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
                claude: provider({ session: session(20), weekly: weekly(100) }, { stale: true }),
            }),
        );
        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons[0]).toMatch(/^data is stale: fetched at /);
        expect(result.data.account?.stale).toBe(true);
        expect(result.data.windows.map((w) => w.used)).toEqual([20, 100]);
    });

    it("is not evaluable on an exhausted window when OpenUsage reports an error", async () => {
        const result = await gate(
            limits({ claude: provider({ session: session(20), weekly: weekly(100) }) }, [
                { providerId: "claude", message: "rate limited" },
            ]),
        );
        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons).toContain("OpenUsage reported an error for claude: rate limited");
    });

    it("is not evaluable when OpenUsage reports an error for the account", async () => {
        const result = await gate(
            limits({ claude: provider({ session: session(20), weekly: weekly(30) }) }, [
                { providerId: "claude", message: "rate limited" },
            ]),
        );
        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons).toEqual(["OpenUsage reported an error for claude: rate limited"]);
    });

    it("is not evaluable with several accounts and none selected", async () => {
        const result = await gate(
            limits({
                claude: provider({}),
                "claude@1": provider({}, { displayName: "Claude: Work" }),
            }),
        );
        expect(result.outcome).toBe("not-evaluable");
        expect(result.data.candidates).toEqual([
            { key: "claude", displayName: "Claude: Personal (me@example.com)" },
            { key: "claude@1", displayName: "Claude: Work" },
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
        const result = await gate(limits({ claude: provider({ session: session(20) }) }));
        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons).toEqual(["weekly window missing"]);
    });

    it("is not evaluable when a window lacks its reset time", async () => {
        const { resetsAt: _r, ...noReset } = weekly(30);
        const result = await gate(
            limits({ claude: provider({ session: session(20), weekly: noReset }) }),
        );
        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons).toEqual(["weekly window incomplete (no resetsAt)"]);
    });

    it("is not evaluable, rather than waiting, when an exhausted window is incomplete", async () => {
        const { resetsAt: _r, ...noReset } = session(100);
        const result = await gate(
            limits({ claude: provider({ session: noReset, weekly: weekly(30) }) }),
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
        const result = await gate(limits({ claude: provider({ session: s, weekly: weekly(30) }) }));
        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons).toEqual([`session window invalid (${invalid})`]);
        expect(result.data.windows.map((w) => w.used)).toEqual([s.used, 30]);
    });
});

describe("quota gate decision: accounts known only from OpenUsage errors", () => {
    it("is not evaluable for an account with an error and no data", async () => {
        const result = await gate(limits({}, [{ providerId: "claude", message: "token expired" }]));
        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons).toEqual([
            "OpenUsage reported an error for claude: token expired",
            "OpenUsage returned no data for claude",
            "session window missing",
            "weekly window missing",
        ]);
        expect(result.data.account).toMatchObject({
            key: "claude",
            displayName: null,
            errors: ["token expired"],
        });
    });

    it("counts an account known only from an error when deciding ambiguity", async () => {
        const result = await gate(
            limits({ claude: provider({ session: session(20), weekly: weekly(30) }) }, [
                { providerId: "claude@work", message: "token expired" },
            ]),
        );
        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons).toEqual([
            "ambiguous account: 2 Claude accounts present, pass --account <provider-key>",
        ]);
        expect(result.data.candidates).toEqual([
            { key: "claude", displayName: "Claude: Personal (me@example.com)" },
            { key: "claude@work", displayName: null },
        ]);
    });
});

describe("quota gate decision: not evaluable from malformed output", () => {
    it("is not evaluable when an account that is not selected is malformed", async () => {
        const result = await gate(
            limits({
                claude: provider({ session: session(20), weekly: weekly(30) }),
                "claude@work": provider({}, { resources: "none" }),
            }),
            "claude",
        );
        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons).toEqual([
            "openusage output does not match openusage.limits.v1: $.providers.claude@work.resources must be an object",
        ]);
    });
});
