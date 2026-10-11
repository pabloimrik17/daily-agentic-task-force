import { expect, it, vi } from "vitest";
import type { Exec } from "../../exec.ts";
import listing from "./fixtures/github-list.json";
import { githubWorkReader } from "./github.ts";

it("marks priority, blockers and children unevaluated for every GitHub task", async () => {
    const exec = vi.fn<Exec>().mockResolvedValue({ ok: true, stdout: JSON.stringify(listing) });
    const work = githubWorkReader(exec, { enabled: true, repos: ["demo/one", "demo/two"] });
    const result = await work.list();
    if (!result.ok) throw new Error(result.error);
    expect(result.value).toHaveLength(2);
    for (const task of result.value) {
        expect(task.priority).toBeNull();
        expect(task.blockedBy).toBeNull();
        expect(task.children).toBeNull();
        expect(task.blocks).toEqual([]);
        expect(await work.detail(task)).toEqual({ ok: true, value: task });
    }
    expect(exec).toHaveBeenCalledTimes(2);
});
