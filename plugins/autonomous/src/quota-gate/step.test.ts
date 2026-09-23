import { describe, expect, it } from "vitest";

import { quotaGateStep } from "./step.ts";
import { context, fakeExec, limits, provider, resource, session, weekly } from "./test-fixtures.ts";

async function gate(output: unknown, account?: string) {
    return quotaGateStep.run(context(fakeExec(output), { account }));
}

describe("quota gate decision", () => {
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

    it("advances when only the projection exceeds capacity", async () => {
        // 52% after 2h of 5h projects to 130%
        const result = await gate(
            limits({ claude: provider({ session: session(52), weekly: weekly(30) }) }),
        );
        expect(result.outcome).toBe("advance");
        const projection = result.data.windows[0]?.projection;
        expect(projection?.available && projection.projectedUsage).toBeCloseTo(130);
    });

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

    it("is not evaluable when OpenUsage reports an error for the account", async () => {
        const result = await gate(
            limits({ claude: provider({ session: session(20), weekly: weekly(30) }) }, [
                { providerId: "claude", message: "rate limited" },
            ]),
        );
        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons).toEqual(["OpenUsage reported an error for claude: rate limited"]);
    });

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
        expect(result.reasons).toEqual(["weekly window incomplete (no resetsAt)"]);
    });

    it("lets an exhausted window beat a missing one, still reporting both", async () => {
        const result = await gate(limits({ claude: provider({ session: session(100) }) }));
        expect(result.outcome).toBe("wait");
        expect(result.data.windows.map((w) => [w.name, w.problem])).toEqual([
            ["session", null],
            ["weekly", "missing"],
        ]);
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
