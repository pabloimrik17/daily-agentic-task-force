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

function readerWith(queryOutput: unknown, viewOutput: unknown = detail) {
    const exec = vi
        .fn<Exec>()
        .mockResolvedValueOnce({ ok: true, stdout: JSON.stringify(queryOutput) })
        .mockResolvedValueOnce({ ok: true, stdout: JSON.stringify(viewOutput) });
    return linearWorkReader(exec, { enabled: true });
}

function withRelations(count: number, index = 0) {
    const related = { type: "related", issue: { identifier: "DEMO-500" } };
    const inverseRelations = { nodes: Array.from({ length: count }, () => related) };
    const nodes = listing.nodes.map((node, at) =>
        at === index ? { ...node, inverseRelations } : node,
    );
    return { ...listing, nodes };
}

function withChildren(count: number) {
    const filler = Array.from({ length: count - detail.children.nodes.length }, (_, index) => ({
        ...detail.children.nodes[1],
        identifier: `DEMO-${1000 + index}`,
    }));
    return { ...detail, children: { nodes: [...detail.children.nodes, ...filler] } };
}

async function detailOf(view: unknown) {
    const work = readerWith(listing, view);
    const listed = await work.list();
    if (!listed.ok) throw new Error(listed.error);
    return work.detail(listed.value[2]!);
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
    it("parses 99 inverse relations", async () => {
        const result = await readerWith(withRelations(99)).list();
        expect(result.ok && result.value[0]?.blockedBy).toEqual([]);
    });
    it("fails closed at 100 inverse relations, the most linear-cli returns", async () => {
        expect(await readerWith(withRelations(100)).list()).toEqual({
            ok: false,
            error:
                "linear issue query --all-teams: output does not match the expected shape: $.nodes[0].inverseRelations has 100 nodes, " +
                "the most linear-cli returns; blockers may be missing",
        });
    });
    it("does not cap the relations of a completed issue, which selection never reads", async () => {
        const completed = listing.nodes.findIndex((node) => node.state.type === "completed");
        const result = await readerWith(withRelations(100, completed)).list();
        expect(result.ok && result.value.map(({ id }) => id)).toEqual([
            "DEMO-108",
            "DEMO-111",
            "DEMO-82",
        ]);
    });
    it("parses 249 children", async () => {
        const result = await detailOf(withChildren(249));
        expect(result.ok && result.value.children).toHaveLength(249 - 2);
    });
    it("fails closed at 250 children, the most linear-cli returns", async () => {
        expect(await detailOf(withChildren(250))).toEqual({
            ok: false,
            error:
                "linear issue view DEMO-82: output does not match the expected shape: $.children has 250 nodes, " +
                "the most linear-cli returns; children may be missing",
        });
    });
});
