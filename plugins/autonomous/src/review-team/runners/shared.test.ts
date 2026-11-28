import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { temporaryDirectories } from "../../stages/test-fixtures.ts";
import type { RawFinding } from "../types.ts";
import { type RunContext, runTimed, saveRaw, skippedFile } from "./shared.ts";

const directories = temporaryDirectories("review-shared");
afterEach(() => directories.removeAll());

function context(times: number[]): RunContext {
    return { now: () => times.shift() ?? 0 } as unknown as RunContext;
}

const FINDING: RawFinding = {
    kind: "finding",
    title: "T",
    statement: "S",
    location: { scope: "change" },
    evidence: "E",
    label: "issue",
    nativeSeverity: "major",
};

describe("runTimed", () => {
    it("reports the items it is given, timed", async () => {
        const file = await runTimed(context([100, 460]), "coderabbit", () =>
            Promise.resolve({ items: [FINDING] }),
        );

        expect(file).toEqual({
            schema: "autonomous.finding.v1",
            reviewer: "coderabbit",
            outcome: "reported",
            durationMs: 360,
            items: [FINDING],
        });
    });

    it("skips instead of writing a file the schema would refuse", async () => {
        const file = await runTimed(context([0, 5]), "coderabbit", () =>
            Promise.resolve({ items: [{ ...FINDING, nativeSeverity: "huge" }] }),
        );

        expect(file).toMatchObject({ outcome: "skipped", durationMs: 5 });
        expect(file.outcome === "skipped" && file.reason).toMatch(
            /^coderabbit output is invalid: \$\.items\[0\]\.nativeSeverity "huge"/,
        );
    });

    it("never reports a negative duration when the clock steps back", async () => {
        const file = await runTimed(context([10, 4]), "coderabbit", () =>
            Promise.resolve({ skip: "no" }),
        );

        expect(file).toEqual(skippedFile("coderabbit", "no", 0));
    });
});

describe("saveRaw", () => {
    it("creates raw/ and writes the file in it", async () => {
        const dir = directories.make("report");

        await saveRaw(dir, "x.txt", "content");

        expect(await readFile(join(dir, "raw", "x.txt"), "utf8")).toBe("content");
    });
});
