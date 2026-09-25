import { describe, expect, it } from "vitest";

import { quotaGateStep } from "./step.ts";
import { context, fakeExec, limits, provider, session, weekly } from "./test-fixtures.ts";

async function rendered(output: unknown, account?: string) {
    return quotaGateStep.render(await quotaGateStep.run(context(fakeExec(output), { account })));
}

describe("renderQuotaGate", () => {
    it("shows windows, projections, other resources and reasons", async () => {
        const text = await rendered(
            limits({
                claude: provider({ session: session(20), weekly: weekly(0), fable: weekly(3) }),
            }),
        );
        expect(text).toBe(
            [
                "[quota-gate] advance (code)",
                "  account   claude — Claude: Personal (me@example.com) · Pro",
                "  fetched   2026-09-23T11:59:00.000Z",
                "  session   20% / 100%  window 5h  resets 2026-09-23T15:00:00.000Z  projected 50%",
                "  weekly    0% / 100%  window 7d  resets 2026-09-27T12:00:00.000Z  no projection: no consumption yet",
                "  fable     3% / 100%  not evaluated",
                "  reasons:",
                "    - session window has capacity: 20/100 percent, resets at 2026-09-23T15:00:00.000Z",
                "    - weekly window has capacity: 0/100 percent, resets at 2026-09-27T12:00:00.000Z",
            ].join("\n"),
        );
    });

    it("flags stale values and marks exhaustion", async () => {
        const text = await rendered(
            limits({
                claude: provider({ session: session(100), weekly: weekly(30) }, { stale: true }),
            }),
        );
        expect(text).toContain("[quota-gate] not-evaluable (code)");
        expect(text).toContain("[STALE — values below are last known]");
        expect(text).toContain("projected 250%  EXHAUSTED");
    });

    it("marks missing windows", async () => {
        const text = await rendered(limits({ claude: provider({ session: session(20) }) }));
        expect(text).toContain("  weekly    ? / ?  [missing]");
    });

    it("marks an outdated window without a projection", async () => {
        // 8 days into a 7-day window: the reset was a day ago
        const text = await rendered(
            limits({ claude: provider({ session: session(20), weekly: weekly(100, 8) }) }),
        );
        expect(text).toContain("[quota-gate] not-evaluable (code)");
        expect(text.split("\n")).toContain(
            "  weekly    100% / 100%  window 7d  resets 2026-09-22T12:00:00.000Z  [outdated (exhausted, but its reset time 2026-09-22T12:00:00.000Z has passed; refresh with --force)]",
        );
    });

    it("lists candidates when no account could be selected", async () => {
        const text = await rendered(
            limits({
                claude: provider({}),
                "claude@1": provider({}, { displayName: "Claude: Work" }),
            }),
        );
        expect(text).toBe(
            [
                "[quota-gate] not-evaluable (code)",
                "  candidates:",
                "    - claude — Claude: Personal (me@example.com)",
                "    - claude@1 — Claude: Work",
                "  reasons:",
                "    - ambiguous account: 2 Claude accounts present, pass --account <provider-key>",
            ].join("\n"),
        );
    });
});
