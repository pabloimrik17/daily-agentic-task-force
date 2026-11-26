import { expect, it, vi } from "vitest";
import type { Exec } from "../exec.ts";
import { githubWorkReader } from "./readers/github.ts";

const entry = (number: number, blockedByTotal = 0) => ({
    number,
    title: "t",
    body: "",
    labels: [],
    updatedAt: "2026-01-01T00:00:00Z",
    state: "OPEN",
    blockedBy: { nodes: [], totalCount: blockedByTotal },
    blocking: { nodes: [], totalCount: 0 },
});

async function listError(items: unknown[]): Promise<string> {
    const exec = vi.fn<Exec>().mockResolvedValue({ ok: true, stdout: JSON.stringify(items) });
    const result = await githubWorkReader(exec, { enabled: true, repos: ["demo/one"] }).list();
    if (result.ok) throw new Error("expected the read to fail");
    return result.error;
}

const OVER_CAP = Array.from({ length: 1001 }, (_, index) => entry(index + 1));

it("control: over the cap with whole blocker lists reports the cap", async () => {
    expect(await listError(OVER_CAP)).toContain("more than 1000 results");
});

it("f13: over the cap with one cut-short blocker list still reports the cap", async () => {
    // The cut entry is the 1001st, the sentinel asked for only to detect the cap.
    expect(await listError([...OVER_CAP.slice(0, 1000), entry(1001, 1)])).toContain(
        "more than 1000 results",
    );
});
