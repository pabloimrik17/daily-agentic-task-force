import { describe, expect, it } from "vitest";

import { parseLimits } from "./parse.ts";
import { limits, provider, session, weekly } from "./test-fixtures.ts";

describe("parseLimits", () => {
    it("accepts RFC 3339 timestamps", () => {
        expect(parseLimits(limits({ claude: provider({ session: session(10) }) })).ok).toBe(true);
    });

    it.each(["2026", "Sep 23 2026", "2026-09-23T12:00:00"])(
        "rejects %s as a timestamp",
        (value) => {
            expect(parseLimits({ ...limits({}), generatedAt: value })).toEqual({
                ok: false,
                error: "openusage output does not match openusage.limits.v1: $.generatedAt must be an RFC 3339 timestamp",
            });
        },
    );

    it("rejects a malformed resource the gate does not evaluate", () => {
        const fable = { ...session(5), resetsAt: null };
        const input = limits({
            claude: provider({ session: session(10), weekly: weekly(10), fable }),
        });
        expect(parseLimits(input)).toEqual({
            ok: false,
            error: "openusage output does not match openusage.limits.v1: $.providers.claude.resources.fable.resetsAt must be a string",
        });
    });
});
