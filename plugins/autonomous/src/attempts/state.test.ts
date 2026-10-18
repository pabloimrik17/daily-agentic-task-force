import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { attemptId } from "./record.ts";
import {
    attemptDir,
    capturePath,
    listRecords,
    nextAttempt,
    parseRecord,
    promptPath,
    readRecord,
    recordPath,
    resolveStateDir,
    resultPath,
    writeJsonAtomic,
    writeRecord,
} from "./state.ts";
import { record, tempState } from "./test-fixtures.ts";

let state: string;

beforeEach(() => {
    state = tempState();
});

afterEach(async () => {
    await rm(state, { recursive: true, force: true });
});

describe("resolveStateDir", () => {
    it("prefers AUTONOMOUS_STATE, then XDG_STATE_HOME, then HOME", () => {
        const all = { AUTONOMOUS_STATE: "/a", XDG_STATE_HOME: "/x", HOME: "/h" };
        expect(resolveStateDir(all)).toBe("/a");
        expect(resolveStateDir({ XDG_STATE_HOME: "/x", HOME: "/h" })).toBe("/x/autonomous");
        expect(resolveStateDir({ HOME: "/h" })).toBe("/h/.local/state/autonomous");
    });

    it("ignores empty values", () => {
        const env = { AUTONOMOUS_STATE: "", XDG_STATE_HOME: "", HOME: "/h" };
        expect(resolveStateDir(env)).toBe("/h/.local/state/autonomous");
    });
});

describe("attempt paths", () => {
    it("nests a Linear id by source, task, stage and number", () => {
        const dir = attemptDir("/s", "linear:DOT-109:test:1");
        expect(dir).toBe("/s/attempts/linear/DOT-109/test/1");
        expect(recordPath(dir)).toBe("/s/attempts/linear/DOT-109/test/1/record.json");
        expect(promptPath(dir)).toBe("/s/attempts/linear/DOT-109/test/1/prompt.md");
        expect(resultPath(dir)).toBe("/s/attempts/linear/DOT-109/test/1/result.json");
        expect(capturePath(dir)).toBe("/s/attempts/linear/DOT-109/test/1/capture.txt");
    });

    it("nests a GitHub id one directory deeper", () => {
        expect(attemptDir("/s", "github:owner/name#12:test:1")).toBe(
            "/s/attempts/github/owner/name#12/test/1",
        );
    });

    it("throws on a malformed id", () => {
        expect(() => attemptDir("/s", "linear::test:1")).toThrow("malformed attempt id");
    });
});

describe("writeJsonAtomic", () => {
    it("creates the directory and leaves no temporary file", async () => {
        const file = join(state, "a", "b", "x.json");
        await writeJsonAtomic(file, { n: 1 });
        expect(await readdir(join(state, "a", "b"))).toEqual(["x.json"]);
    });
});

describe("records", () => {
    it("reads back a written record equal", async () => {
        const written = record({
            observed: {
                status: "Idle",
                state: "open",
                needsHuman: true,
                at: "2026-10-17T13:00:00Z",
            },
            cleanup: { pending: true, error: "aoe remove failed" },
            retained: { at: "2026-10-17T13:00:00Z", reason: "several sessions" },
        });
        await writeRecord(state, written);
        const file = recordPath(attemptDir(state, written.id));
        expect(await readRecord(file)).toEqual(written);
    });

    it("reads back a GitHub record", async () => {
        const written = record({
            id: "github:owner/name#12:test:1",
            task: { source: "github", id: "owner/name#12", title: "Fix" },
            session: null,
        });
        await writeRecord(state, written);
        expect(await listRecords(state)).toEqual([written]);
    });

    it("names the file for a malformed record", async () => {
        const dir = attemptDir(state, "linear:DOT-109:test:1");
        await mkdir(dir, { recursive: true });
        const file = recordPath(dir);

        await writeFile(file, "{ nope");
        await expect(readRecord(file)).rejects.toThrow(`${file} is not valid JSON`);

        await writeFile(file, JSON.stringify({ ...record(), extra: 1 }));
        await expect(readRecord(file)).rejects.toThrow(`${file} does not match`);

        await expect(readRecord(join(dir, "missing.json"))).rejects.toThrow(
            `${join(dir, "missing.json")}`,
        );
    });

    it("lists a malformed record as an Error", async () => {
        const dir = attemptDir(state, "linear:DOT-109:test:1");
        await mkdir(dir, { recursive: true });
        await writeFile(recordPath(dir), "[]");
        await expect(listRecords(state)).rejects.toThrow(recordPath(dir));
    });

    it("lists records sorted by id, and none for a missing directory", async () => {
        expect(await listRecords(join(state, "absent"))).toEqual([]);
        expect(await listRecords(state)).toEqual([]);
        const second = record({ id: "linear:DOT-109:test:2", attempt: 2 });
        const first = record();
        await writeRecord(state, second);
        await writeRecord(state, first);
        expect((await listRecords(state)).map((r) => r.id)).toEqual([first.id, second.id]);
    });
});

describe("parseRecord", () => {
    const parse = (change: (r: Record<string, unknown>) => void): (() => unknown) => {
        const copy = structuredClone(record()) as unknown as Record<string, unknown>;
        change(copy);
        return () => parseRecord(copy);
    };

    it("accepts the fixture", () => {
        expect(parseRecord(record())).toEqual(record());
    });

    it("rejects a wrong schema, an unknown state or stage and an id that disagrees", () => {
        expect(parse((r) => (r.schema = "v2"))).toThrow("$.schema");
        expect(parse((r) => (r.state = "running"))).toThrow("$.state");
        expect(parse((r) => (r.stage = "grill"))).toThrow("$.stage must be one of");
        expect(parse((r) => (r.id = "linear:DOT-109:test:2"))).toThrow("$.id must equal");
        expect(parse((r) => (r.attempt = 0))).toThrow("$.attempt");
    });

    it("rejects unknown keys, missing fields and bad nested values", () => {
        expect(parse((r) => (r.extra = 1))).toThrow("$.extra");
        expect(parse((r) => delete r.taken)).toThrow("$.taken");
        expect(parse((r) => delete r.session)).toThrow("$.session");
        expect(parse((r) => (r.history = [{ state: "nope", at: "x" }]))).toThrow("$.history[0]");
        expect(parse((r) => (r.cleanup = { pending: false, error: "x" }))).toThrow(
            "$.cleanup.pending",
        );
        expect(parse((r) => ((r.task as { extra?: 1 }).extra = 1))).toThrow("$.task.extra");
    });
});

describe("nextAttempt", () => {
    it("is one past the highest of that task and stage", () => {
        const records = [
            record(),
            record({ id: "linear:DOT-109:test:2", attempt: 2 }),
            record({ id: "linear:DOT-109:proposal:7", stage: "proposal", attempt: 7 }),
            record({
                id: "beads:DOT-109:test:9",
                task: { source: "beads", id: "DOT-109", title: "x" },
                attempt: 9,
            }),
        ];
        const task = { source: "linear", id: "DOT-109" } as const;
        expect(nextAttempt(records, task, "test")).toBe(3);
        expect(nextAttempt(records, task, "proposal")).toBe(8);
        expect(nextAttempt(records, task, "grill-me")).toBe(1);
        expect(nextAttempt([], task, "test")).toBe(1);
        expect(attemptId(task, "test", 3)).toBe("linear:DOT-109:test:3");
    });
});
