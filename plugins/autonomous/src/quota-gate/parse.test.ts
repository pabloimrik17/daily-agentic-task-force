import { describe, expect, it } from "vitest";

import { parseLimits } from "./parse.ts";
import { ACCOUNT, balance, limits, provider, session, weekly } from "./test-fixtures.ts";

// What `openusage claude` printed on OpenUsage 0.8.0 on 2026-11-15 (evidence/openusage-0.8.0.md),
// with the account id replaced and the display name redacted.
const observed = {
    generatedAt: "2026-11-15T17:53:24.000Z",
    providers: {
        [ACCOUNT]: {
            displayName: "Claude · Personal",
            expiresAt: "2026-11-15T18:00:55.000Z",
            fetchedAt: "2026-11-15T17:50:55.000Z",
            plan: "Pro",
            resources: {
                fable: {
                    kind: "consumption",
                    limit: 100,
                    remaining: 65,
                    resetsAt: "2026-11-20T07:00:00.000Z",
                    unit: "percent",
                    used: 35,
                    utilization: 0.35,
                    windowSeconds: 604800,
                },
                rateLimitResets: {
                    available: 2,
                    expiresAt: ["2026-11-17T07:59:00.000Z", "2026-12-10T22:00:00.000Z"],
                    kind: "balance",
                    unit: "resets",
                },
                session: {
                    kind: "consumption",
                    limit: 100,
                    remaining: 100,
                    resetsAt: "2026-11-15T19:20:00.000Z",
                    unit: "percent",
                    used: 0,
                    utilization: 0,
                    windowSeconds: 18000,
                },
                weekly: {
                    kind: "consumption",
                    limit: 100,
                    remaining: 68,
                    resetsAt: "2026-11-20T07:00:00.000Z",
                    unit: "percent",
                    used: 32,
                    utilization: 0.32,
                    windowSeconds: 604800,
                },
            },
            stale: false,
        },
    },
    schema: "openusage.limits.v2",
};

describe("parseLimits", () => {
    it("accepts the document OpenUsage 0.8.0 printed", () => {
        const result = parseLimits(observed);
        expect(result.ok && result.value.providers[ACCOUNT]?.resources).toEqual({
            fable: {
                kind: "consumption",
                unit: "percent",
                used: 35,
                limit: 100,
                resetsAt: "2026-11-20T07:00:00.000Z",
                windowSeconds: 604800,
            },
            rateLimitResets: { kind: "balance", unit: "resets", available: 2 },
            session: {
                kind: "consumption",
                unit: "percent",
                used: 0,
                limit: 100,
                resetsAt: "2026-11-15T19:20:00.000Z",
                windowSeconds: 18000,
            },
            weekly: {
                kind: "consumption",
                unit: "percent",
                used: 32,
                limit: 100,
                resetsAt: "2026-11-20T07:00:00.000Z",
                windowSeconds: 604800,
            },
        });
    });

    it("accepts RFC 3339 timestamps", () => {
        expect(parseLimits(limits({ [ACCOUNT]: provider({ session: session(10) }) })).ok).toBe(
            true,
        );
    });

    it.each(["2026", "Sep 23 2026", "2026-09-23T12:00:00"])(
        "rejects %s as a timestamp",
        (value) => {
            expect(parseLimits({ ...limits({}), generatedAt: value })).toEqual({
                ok: false,
                error: "openusage output does not match openusage.limits.v2: $.generatedAt must be an RFC 3339 timestamp",
            });
        },
    );

    it("rejects a malformed resource the gate does not evaluate", () => {
        const fable = { ...session(5), resetsAt: null };
        const input = limits({
            [ACCOUNT]: provider({ session: session(10), weekly: weekly(10), fable }),
        });
        expect(parseLimits(input)).toEqual({
            ok: false,
            error: `openusage output does not match openusage.limits.v2: $.providers.${ACCOUNT}.resources.fable.resetsAt must be a string`,
        });
    });

    it.each([
        ["remaining", { ...session(10), remaining: "90" }, "remaining must be a finite number"],
        [
            "utilization",
            { ...session(10), utilization: null },
            "utilization must be a finite number",
        ],
        ["available", { ...balance(2), available: "2" }, "available must be a finite number"],
        ["expiresAt", { ...balance(2), expiresAt: "soon" }, "expiresAt must be an array"],
        [
            "an expiresAt entry",
            { ...balance(2), expiresAt: ["2026"] },
            "expiresAt[0] must be an RFC 3339 timestamp",
        ],
    ])("rejects a mistyped %s in a resource the gate does not evaluate", (_, other, message) => {
        const input = limits({
            [ACCOUNT]: provider({ session: session(10), weekly: weekly(10), other }),
        });
        expect(parseLimits(input)).toEqual({
            ok: false,
            error: `openusage output does not match openusage.limits.v2: $.providers.${ACCOUNT}.resources.other.${message}`,
        });
    });
});
