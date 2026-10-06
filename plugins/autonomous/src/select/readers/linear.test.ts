import { describe, expect, it, vi } from "vitest";
import type { Exec } from "../../exec.ts";
import listing from "./fixtures/linear-query.json";
import detail from "./fixtures/linear-view.json";
import { linearWorkReader } from "./linear.ts";

function reader() {
    const exec = vi
        .fn<Exec>()
        .mockResolvedValueOnce({ ok: true, stdout: JSON.stringify(listing) })
        .mockResolvedValueOnce({ ok: true, stdout: JSON.stringify(detail) });
    return { exec, work: linearWorkReader(exec, { enabled: true }) };
}

describe("linearWorkReader", () => {
    it("reads the open blocker and its inverse with tracker priority", async () => {
        const { exec, work } = reader();
        const result = await work.list();
        expect(
            result.ok &&
                result.value.map(({ id, blocks, priority, children }) => ({
                    id,
                    blocks,
                    priority,
                    children,
                })),
        ).toEqual([
            { id: "DEMO-108", blocks: ["DEMO-111"], priority: "High", children: null },
            { id: "DEMO-111", blocks: [], priority: "High", children: null },
            { id: "DEMO-82", blocks: [], priority: null, children: null },
        ]);
        expect(exec.mock.calls[0]).toEqual([
            ["issue", "query", "--all-teams", "--limit", "0", "--json"],
        ]);
    });
    it("ignores a completed blocker", async () => {
        const result = await reader().work.list();
        expect(result.ok && result.value[1]?.blockedBy).toEqual(["DEMO-108"]);
    });
    it("reads description and open children using query state types", async () => {
        const { exec, work } = reader();
        const listed = await work.list();
        if (!listed.ok) throw new Error(listed.error);
        const result = await work.detail(listed.value[2]!);
        expect(result.ok && result.value.children).toEqual(["DEMO-108", "DEMO-999"]);
        expect(result.ok && result.value.description).toBe(detail.description);
        expect(exec.mock.calls[1]).toEqual([
            ["issue", "view", "DEMO-82", "--no-comments", "--json"],
        ]);
    });
    it("names linear auth login for an unauthenticated CLI", async () => {
        const { exec, work } = reader();
        const listed = await work.list();
        if (!listed.ok) throw new Error(listed.error);
        exec.mockReset().mockResolvedValue({ ok: false, error: "No API key configured" });
        expect(await work.detail(listed.value[0]!)).toEqual({
            ok: false,
            error: "linear issue view DEMO-108: Linear CLI is not authenticated, run `linear auth login`",
        });
        expect(await work.list()).toEqual({
            ok: false,
            error: "linear issue query --all-teams: Linear CLI is not authenticated, run `linear auth login`",
        });
    });
});
