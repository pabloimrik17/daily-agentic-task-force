import { describe, expect, it } from "vitest";

import type { Exec } from "../exec.ts";
import { quotaGateStep } from "./step.ts";
import {
    ACCOUNT,
    ANA,
    balance,
    context,
    fakeExec,
    fakeLogin,
    limits,
    LUIS,
    provider,
    session,
    weekly,
} from "./test-fixtures.ts";

async function rendered(output: unknown, login: Exec = fakeLogin(ANA)) {
    return quotaGateStep.render(await quotaGateStep.run(context(fakeExec(output), {}, login)));
}

describe("renderQuotaGate", () => {
    it("shows windows, projections, other resources and reasons", async () => {
        const text = await rendered(
            limits({
                [ACCOUNT]: provider({
                    session: session(20),
                    weekly: weekly(0),
                    fable: weekly(3),
                    rateLimitResets: balance(2),
                }),
            }),
        );
        expect(text).toBe(
            [
                "[quota-gate] advance (code)",
                `  account   ${ANA} — ${ACCOUNT} · Claude · ${ANA} · Pro`,
                "  fetched   2026-09-23T11:59:00.000Z",
                "  session   20% / 100%  window 5h  resets 2026-09-23T15:00:00.000Z  projected 50%",
                "  weekly    0% / 100%  window 7d  resets 2026-09-27T12:00:00.000Z  no projection: no consumption yet",
                "  fable     3% / 100%  not evaluated",
                "  rateLimitResets 2 resets available  not evaluated",
                "  reasons:",
                "    - session window has capacity: 20/100 percent, resets at 2026-09-23T15:00:00.000Z",
                "    - weekly window has capacity: 0/100 percent, resets at 2026-09-27T12:00:00.000Z",
            ].join("\n"),
        );
    });

    it("flags stale values and marks exhaustion", async () => {
        const text = await rendered(
            limits({
                [ACCOUNT]: provider({ session: session(100), weekly: weekly(30) }, { stale: true }),
            }),
        );
        expect(text).toContain("[quota-gate] not-evaluable (code)");
        expect(text).toContain("[STALE — values below are last known]");
        expect(text).toContain("projected 250%  EXHAUSTED");
    });

    it("marks missing windows", async () => {
        const text = await rendered(limits({ [ACCOUNT]: provider({ session: session(20) }) }));
        expect(text).toContain("  weekly    ? / ?  [missing]");
    });

    it("marks an outdated window without a projection", async () => {
        // 8 days into a 7-day window: the reset was a day ago
        const text = await rendered(
            limits({ [ACCOUNT]: provider({ session: session(20), weekly: weekly(100, 8) }) }),
        );
        expect(text).toContain("[quota-gate] not-evaluable (code)");
        expect(text.split("\n")).toContain(
            "  weekly    100% / 100%  window 7d  resets 2026-09-22T12:00:00.000Z  [outdated (exhausted, but its reset time 2026-09-22T12:00:00.000Z has passed; OpenUsage refreshes on its own schedule, or refresh the account in its app)]",
        );
    });

    it("lists the accounts with their email addresses when none could be selected", async () => {
        const text = await rendered(
            limits({
                [ACCOUNT]: provider({}),
                "claude@9f8e7d6c": provider({}, { displayName: "Claude · Work" }),
            }),
            fakeLogin(LUIS),
        );
        expect(text).toBe(
            [
                "[quota-gate] not-evaluable (code)",
                "  accounts:",
                `    - ${ANA} — ${ACCOUNT} · Claude · ${ANA}`,
                "    - claude@9f8e7d6c — Claude · Work",
                "  reasons:",
                `    - the active account ${LUIS} is not reported`,
            ].join("\n"),
        );
    });

    it("names the accounts with capacity on a wait, by email address or else by id", async () => {
        const exhausted = session(100);
        const capacity = (displayName: string) =>
            provider({ session: session(20), weekly: weekly(30) }, { displayName });
        const text = await rendered(
            limits({
                [ACCOUNT]: provider({ session: exhausted, weekly: weekly(30) }),
                "claude@5e6f7a8b": capacity("Claude"),
                "claude@9f8e7d6c": capacity(`Claude · ${LUIS}`),
            }),
        );
        expect(text).toMatch(/^\[quota-gate\] wait \(code\)\n {2}account {3}ana@example\.com — /);
        expect(text.split("\n").slice(-5)).toEqual([
            "  capacity elsewhere (Claude Code is not logged in as these):",
            "    - claude@5e6f7a8b",
            `    - ${LUIS}`,
            "  reasons:",
            `    - session window exhausted: 100/100 percent, resets at ${exhausted.resetsAt}`,
        ]);
    });
});
