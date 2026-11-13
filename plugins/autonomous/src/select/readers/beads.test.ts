import { describe, expect, it, vi } from "vitest";
import type { Exec } from "../../exec.ts";
import blocked from "./fixtures/beads-blocked.json";
import listing from "./fixtures/beads-list.json";
import { beadsWorkReader } from "./beads.ts";

const config = { enabled: true, directory: "/demo/.beads" };
function reader() {
    const exec = vi
        .fn<Exec>()
        .mockResolvedValueOnce({ ok: true, stdout: JSON.stringify(listing) })
        .mockResolvedValueOnce({ ok: true, stdout: JSON.stringify(blocked) });
    return { exec, work: beadsWorkReader(exec, config) };
}

describe("beadsWorkReader", () => {
    it("reads Beads blockers, their inverse and priority with exact argv", async () => {
        const { work, exec } = reader();
        const result = await work.list();
        expect(
            result.ok &&
                result.value.map(({ id, blockedBy, blocks, priority }) => ({
                    id,
                    blockedBy,
                    blocks,
                    priority,
                })),
        ).toEqual([
            { id: "demo-a", blockedBy: [], blocks: ["demo-b"], priority: "P2" },
            { id: "demo-b", blockedBy: ["demo-a"], blocks: [], priority: "P2" },
        ]);
        expect(exec.mock.calls).toEqual([
            [
                [
                    "-C",
                    config.directory,
                    "list",
                    "--json",
                    "--limit",
                    "0",
                    "--status",
                    "open,in_progress,blocked,deferred",
                ],
            ],
            [["-C", config.directory, "blocked", "--json"]],
        ]);
    });
    it("includes blocked and deferred children of an open parent", async () => {
        const result = await reader().work.list();
        expect(result.ok && result.value[0]?.children).toEqual(["demo-c", "demo-d"]);
    });
    it("ignores a closed child", async () => {
        const result = await reader().work.list();
        expect(result.ok && result.value[1]?.children).toEqual([]);
    });
    it("reads the parent id from the listing and has no url", async () => {
        const subtask = listing.map((entry) =>
            entry.id === "demo-b" ? { ...entry, parent: "demo-a" } : entry,
        );
        const exec = vi
            .fn<Exec>()
            .mockResolvedValueOnce({ ok: true, stdout: JSON.stringify(subtask) })
            .mockResolvedValueOnce({ ok: true, stdout: JSON.stringify(blocked) });
        const work = beadsWorkReader(exec, config);
        const listed = await work.list();
        if (!listed.ok) throw new Error(listed.error);
        const task = listed.value[1]!;
        expect([task.url, task.parent]).toEqual([null, { id: "demo-a", url: null }]);
        expect(await work.detail(task)).toEqual({ ok: true, value: task });
        expect(exec).toHaveBeenCalledTimes(2); // detail runs no command
    });
    it("sets a null url and a null parent for a task without a parent", async () => {
        const { exec, work } = reader();
        const listed = await work.list();
        if (!listed.ok) throw new Error(listed.error);
        const task = listed.value[0]!;
        expect(await work.detail(task)).toEqual({
            ok: true,
            value: { ...task, url: null, parent: null },
        });
        expect(exec).toHaveBeenCalledTimes(2);
    });
    it("names bd blocked when that command fails", async () => {
        const exec = vi
            .fn<Exec>()
            .mockResolvedValueOnce({ ok: true, stdout: JSON.stringify(listing) })
            .mockResolvedValueOnce({ ok: false, error: "bd failed" });
        expect(await beadsWorkReader(exec, config).list()).toEqual({
            ok: false,
            error: "bd blocked --json: bd failed",
        });
    });
});
