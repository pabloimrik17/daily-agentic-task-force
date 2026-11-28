import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appendStuck, readStuck, startFiles } from "./files.ts";

describe("loop.stuck", () => {
    let state = "";

    beforeEach(async () => {
        state = await mkdtemp(join(tmpdir(), "loop-files-"));
    });

    afterEach(async () => {
        await rm(state, { recursive: true, force: true });
    });

    it("reads as empty when the file is missing", async () => {
        expect(await readStuck(state)).toEqual([]);
    });

    it("starts a new loop empty", async () => {
        await startFiles(state);
        await appendStuck(state, { task: "linear:DOT-1", exclusion: "needs-human", detail: "x" });
        await startFiles(state);

        expect(await readStuck(state)).toEqual([]);
    });

    it("round-trips appended entries", async () => {
        await startFiles(state);
        const first = { task: "linear:DOT-1", exclusion: "needs-human", detail: "a" };
        const second = { task: "beads:bd-2", exclusion: "no-launch", detail: "b\nc" };
        await appendStuck(state, first);
        await appendStuck(state, second);

        expect(await readStuck(state)).toEqual([first, second]);
    });

    it("skips a damaged line and a line missing a field", async () => {
        await startFiles(state);
        const first = { task: "linear:DOT-1", exclusion: "needs-human", detail: "a" };
        const second = { task: "beads:bd-2", exclusion: "no-launch", detail: "b" };
        await appendStuck(state, first);
        await appendFile(join(state, "loop.stuck"), '{"task": "linear:DOT-9", "exclu\n');
        await appendFile(join(state, "loop.stuck"), '{"task":"linear:DOT-3","exclusion":"x"}\n');
        await appendFile(join(state, "loop.stuck"), "null\n");
        await appendStuck(state, second);

        expect(await readStuck(state)).toEqual([first, second]);
    });
});
