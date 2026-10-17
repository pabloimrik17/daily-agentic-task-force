import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import { RESULT_SCHEMA, readMarker } from "./result.ts";
import { tempState } from "./test-fixtures.ts";

const ID = "linear:DOT-109:test:2";

let dir: string;
let file: string;

beforeEach(() => {
    dir = tempState();
    file = join(dir, "result.json");
});

afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
});

function marker(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
        schema: RESULT_SCHEMA,
        attempt: ID,
        outcome: "completed",
        summary: "done",
        artifacts: ["/w/a.txt"],
        finishedAt: "2026-10-17T12:30:00.000Z",
        ...overrides,
    });
}

it("accepts a valid marker", async () => {
    await writeFile(file, marker());
    expect(await readMarker(file, ID)).toEqual({
        ok: true,
        marker: {
            schema: RESULT_SCHEMA,
            attempt: ID,
            outcome: "completed",
            summary: "done",
            artifacts: ["/w/a.txt"],
            finishedAt: "2026-10-17T12:30:00.000Z",
        },
    });
});

it("counts a marker naming another attempt as absent", async () => {
    await writeFile(file, marker({ attempt: "linear:DOT-109:test:1" }));
    expect(await readMarker(file, ID)).toEqual({
        ok: false,
        reason: `result marker names attempt linear:DOT-109:test:1, expected ${ID}`,
    });
});

it("counts an outcome other than completed as absent", async () => {
    await writeFile(file, marker({ outcome: "failed" }));
    expect(await readMarker(file, ID)).toEqual({
        ok: false,
        reason: 'result marker outcome is "failed", expected "completed"',
    });
});

it("counts malformed JSON as absent", async () => {
    await writeFile(file, "{ nope");
    const read = await readMarker(file, ID);
    expect(read.ok).toBe(false);
    expect(!read.ok && read.reason).toMatch(/^result marker is not valid JSON: /);
});

it("counts a marker of the wrong shape as absent", async () => {
    await writeFile(file, marker({ extra: 1 }));
    expect(await readMarker(file, ID)).toEqual({
        ok: false,
        reason: `result marker does not match ${RESULT_SCHEMA}: $.extra is not a recognised field`,
    });
    await writeFile(file, marker({ artifacts: "a" }));
    const read = await readMarker(file, ID);
    expect(!read.ok && read.reason).toContain("$.artifacts must be an array");
});

it("counts a missing file as absent", async () => {
    expect(await readMarker(file, ID)).toEqual({ ok: false, reason: "no result marker" });
});
