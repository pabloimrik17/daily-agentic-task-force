import { describe, expect, it } from "vitest";

import { readOpenUsage } from "./openusage.ts";
import { fakeExec, limits, provider, session, weekly } from "./test-fixtures.ts";

const valid = limits({ claude: provider({ session: session(20), weekly: weekly(30) }) });

describe("readOpenUsage", () => {
    it("parses valid output", async () => {
        const result = await readOpenUsage(fakeExec(valid), false);
        expect(result.ok).toBe(true);
        expect(result.ok && result.limits.providers.claude?.resources.session?.used).toBe(20);
    });

    it("reads the Claude provider from the cache, or refreshes with --force", async () => {
        const exec = fakeExec(valid);
        await readOpenUsage(exec, false);
        await readOpenUsage(exec, true);
        expect(exec.calls).toEqual([["claude"], ["claude", "--force"]]);
    });

    it("reports a CLI failure", async () => {
        const result = await readOpenUsage(
            () => Promise.resolve({ ok: false, error: "openusage CLI not found on PATH" }),
            false,
        );
        expect(result).toEqual({ ok: false, error: "openusage CLI not found on PATH" });
    });

    it("reports invalid JSON", async () => {
        const result = await readOpenUsage(
            () => Promise.resolve({ ok: true, stdout: "not json" }),
            false,
        );
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error).toMatch(/^openusage output is not valid JSON/);
    });

    it("rejects a different schema id", async () => {
        const result = await readOpenUsage(
            fakeExec({ ...valid, schema: "openusage.limits.v2" }),
            false,
        );
        expect(result).toEqual({
            ok: false,
            error: 'openusage output does not match openusage.limits.v1: $.schema is "openusage.limits.v2", expected "openusage.limits.v1"',
        });
    });

    it("names the path of a missing field", async () => {
        const { stale: _stale, ...noStale } = provider({ session: session(20) });
        const result = await readOpenUsage(fakeExec(limits({ claude: noStale })), false);
        expect(!result.ok && result.error).toContain("$.providers.claude.stale must be a boolean");
    });

    it("names the path of a mistyped resource value", async () => {
        const result = await readOpenUsage(
            fakeExec(limits({ claude: provider({ session: { ...session(20), used: "20" } }) })),
            false,
        );
        expect(!result.ok && result.error).toContain(
            "$.providers.claude.resources.session.used must be a finite number",
        );
    });

    it("accepts resources without optional values and providers without a plan", async () => {
        const { plan: _plan, ...noPlan } = provider({
            session: { kind: "consumption", unit: "percent" },
        });
        const result = await readOpenUsage(fakeExec(limits({ claude: noPlan })), false);
        expect(result.ok && result.limits.providers.claude).toEqual({
            ...noPlan,
            resources: { session: { kind: "consumption", unit: "percent" } },
        });
    });
});
