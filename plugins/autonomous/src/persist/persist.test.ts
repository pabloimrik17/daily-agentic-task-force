import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OPEN_STATES } from "../attempts/record.ts";
import { attemptDir, readRecord, receiptPath, recordPath, writeRecord } from "../attempts/state.ts";
import { tempState } from "../attempts/test-fixtures.ts";
import { config } from "../label-triage/test-fixtures.ts";
import { READ_BACK_TRIES } from "../read-back.ts";
import { exitCodeFor } from "../report.ts";
import autolink from "./fixtures/linear-autolink.json";
import rewrite from "./fixtures/linear-rewrite.json";
import { headerOf, RECEIPT_SCHEMA, runPersist } from "./persist.ts";
import {
    PERSIST_SCHEMA,
    renderPersistJson,
    renderPersistText,
    unconfiguredPersist,
} from "./report.ts";
import { spliceDefinition } from "./splice.ts";
import {
    type AttemptOptions,
    DEFINITION,
    type DocumentScript,
    fakeDocuments,
    startAttempt,
    SUMMARY,
    trackersWith,
} from "./test-fixtures.ts";

const STARTED = new Date("2026-11-03T10:00:00.000Z");

const STATES: string[] = [];
afterAll(() => {
    for (const dir of STATES) {
        rmSync(dir, { recursive: true, force: true });
    }
});

// The read-back waits on setTimeout between reads. The clock is fake, so nothing sleeps for real:
// each wait is fired as it is scheduled and `Date.now()` tells how long the run would have waited.
beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
});
afterEach(() => {
    vi.useRealTimers();
});

async function lagged<T>(pending: Promise<T>): Promise<T> {
    let done = false;
    const finish = () => {
        done = true;
    };
    pending.then(finish, finish);
    while (!done) {
        await vi.advanceTimersToNextTimerAsync();
        await new Promise((resolve) => setImmediate(resolve)); // real file I/O between the waits
    }
    return pending;
}

async function arrange(options: AttemptOptions = {}, script: DocumentScript = {}) {
    const state = tempState();
    STATES.push(state);
    const { id, dir } = await startAttempt(state, options);
    const fake = fakeDocuments(options.source ?? "linear", script);
    const deps = { config: config(), trackers: trackersWith(fake), state };
    const began = Date.now();
    return {
        id,
        dir,
        state,
        fake,
        deps,
        run: () => lagged(runPersist(id, deps, STARTED)),
        waited: () => Date.now() - began,
    };
}

const ORIGINAL_BLOCK = "\n---\n\n## Original description\n\n";

// The task Linear re-serialised on 2026-11-03 (DOT-122): it holds the original below the
// definition, and returns the recorded `read` text for the `written` one.
async function arrangeRewrite(script: DocumentScript = {}, fixture = rewrite) {
    const at = fixture.written.indexOf(ORIGINAL_BLOCK);
    const definition = fixture.written.slice(0, at);
    const original = fixture.written.slice(at + ORIGINAL_BLOCK.length);
    expect(spliceDefinition(original, definition)).toBe(fixture.written);
    return arrange(
        { definition },
        {
            description: original,
            store: (given) => (given === fixture.written ? fixture.read : given),
            ...script,
        },
    );
}

const READ_FILE = "description.read.md";
const reserialised = (file: string) =>
    `linear DOT-121: the tracker re-serialised the description; its text matches what was written, and what it returned is at ${file}`;
const differs = (file: string) =>
    `linear DOT-121: the description read back differs from the one written (${READ_BACK_TRIES}); what the tracker returned is at ${file}`;
const NOT_FOUND = (header: string) =>
    `linear DOT-121: the comment headed "${header}" was not found when read back (${READ_BACK_TRIES})`;

const ALL_WAITS_MS = 30_000; // the delays of READ_BACK_TRIES, added up

const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8")) as unknown;

describe("persist: Definition layout", () => {
    it("First grill: the description is the definition, the separator, the heading and the original", async () => {
        const { run, fake, dir } = await arrange({}, { description: "Fix the login" });
        const report = await run();
        expect(report.outcome).toBe("advance");
        const stored = fake.description() ?? "";
        expect(stored).toBe(spliceDefinition("Fix the login", DEFINITION));
        expect(stored.startsWith("## Definition")).toBe(true);
        expect(stored).toContain(`The login loops.\n${ORIGINAL_BLOCK}Fix the login`);
        expect(stored.endsWith(`${ORIGINAL_BLOCK}Fix the login`)).toBe(true);
        expect(readFileSync(join(dir, "description.md"), "utf8")).toBe(stored);
    });

    it("Second grill: the old definition is replaced and the original below the separator is unchanged", async () => {
        const original = "Fix the login\n\nSteps:\n1. open the page\n\n---\n\nnot a heading";
        const earlier = spliceDefinition(original, "## Definition\n\nOLD-DEFINITION\n");
        const { run, fake } = await arrange({}, { description: earlier });
        expect((await run()).outcome).toBe("advance");
        const stored = fake.description() ?? "";
        expect(stored).not.toContain("OLD-DEFINITION");
        expect(stored).toBe(spliceDefinition(original, DEFINITION));
        expect(stored.endsWith(`${ORIGINAL_BLOCK}${original}`)).toBe(true);
    });

    it("a task without a description gets the definition and an empty original", async () => {
        const { run, fake } = await arrange({}, { description: null });
        expect((await run()).outcome).toBe("advance");
        expect(fake.description()).toBe(spliceDefinition(null, DEFINITION));
    });
});

describe("persist: Stage summary comment", () => {
    it("Comment header: the new comment's first line is the header and the summary follows a blank line", async () => {
        const { run, fake } = await arrange({ source: "beads", taskId: "agentic-task-x1" });
        const report = await run();
        expect(report.attempt).toBe("beads:agentic-task-x1:grill-me:1");
        const header =
            "autonomous · grill-me · beads:agentic-task-x1:grill-me:1 · definition saved";
        expect(headerOf(report.attempt)).toBe(header);
        expect(fake.comments()).toEqual([`${header}\n\n${SUMMARY}`]);
    });

    it("the comment goes through a file in the attempt directory", async () => {
        const { run, dir } = await arrange();
        await run();
        expect(readFileSync(join(dir, "comment.md"), "utf8")).toBe(
            `${headerOf("linear:DOT-121:grill-me:1")}\n\n${SUMMARY}`,
        );
    });
});

describe("persist: Persistence is read back and leaves a receipt", () => {
    it("Persisted: the writes are read back, the receipt is written and the exit code is 0", async () => {
        const { run, fake, dir, id } = await arrange();
        const report = await run();
        expect(report).toMatchObject({
            schema: PERSIST_SCHEMA,
            startedAt: STARTED.toISOString(),
            outcome: "advance",
            attempt: id,
            task: { source: "linear", id: "DOT-121", title: "Fix the login" },
            written: { description: true, comment: "posted" },
            readBack: { description: true, comment: true },
            notes: [],
            reasons: [],
            receipt: receiptPath(dir),
        });
        expect(existsSync(join(dir, READ_FILE))).toBe(false);
        expect(exitCodeFor(report.outcome)).toBe(0);
        expect(readJson(receiptPath(dir))).toEqual({
            schema: RECEIPT_SCHEMA,
            attempt: id,
            task: { source: "linear", id: "DOT-121" },
            at: STARTED.toISOString(),
            header: headerOf(id),
        });
        expect(fake.calls).toEqual([
            "readTask DOT-121",
            "updateDescription DOT-121",
            "readTask DOT-121",
            "readComments DOT-121",
            "addComment DOT-121",
            "readComments DOT-121",
        ]);
    });

    it("Comment write fails: the description stays written, no receipt is left and the exit code is 3 naming the command", async () => {
        const error = "linear issue comment add DOT-121 --body-file comment.md: boom";
        const { run, dir } = await arrange({}, { failures: [{ method: "addComment", error }] });
        const report = await run();
        expect(report.outcome).toBe("not-evaluable");
        expect(exitCodeFor(report.outcome)).toBe(3);
        expect(report.reasons).toEqual([error]);
        expect(report.written).toEqual({ description: true, comment: "none" });
        expect(report.readBack).toEqual({ description: true, comment: false });
        expect(report.receipt).toBeNull();
        expect(existsSync(receiptPath(dir))).toBe(false);
    });

    it("a rerun after a failed comment read-back posts no second comment and writes the receipt", async () => {
        const error = "linear issue comment list DOT-121: boom";
        const { run, fake, dir } = await arrange(
            {},
            { failures: [{ method: "readComments", call: 2, error }] },
        );
        const first = await run();
        expect(first.outcome).toBe("not-evaluable");
        expect(first.reasons).toEqual([error]);
        expect(first.written.comment).toBe("posted");
        expect(existsSync(receiptPath(dir))).toBe(false);
        const afterFirst = fake.description();

        const second = await run();
        expect(second.outcome).toBe("advance");
        expect(second.written.comment).toBe("existing");
        expect(second.readBack.comment).toBe(true);
        expect(fake.calls.filter((call) => call.startsWith("addComment"))).toHaveLength(1);
        expect(fake.comments()).toHaveLength(1);
        expect(fake.description()).toBe(afterFirst);
        expect(existsSync(receiptPath(dir))).toBe(true);
    });

    it("a second full run changes nothing: the same description, no second comment", async () => {
        const { run, fake } = await arrange({}, { description: "Fix the login" });
        await run();
        const description = fake.description();
        const comments = [...fake.comments()];
        const again = await run();
        expect(again.outcome).toBe("advance");
        expect(again.written.comment).toBe("existing");
        expect(fake.description()).toBe(description);
        expect(fake.comments()).toEqual(comments);
    });

    it("a description read back that differs writes no receipt and posts no comment", async () => {
        const { run, fake, dir } = await arrange({}, { store: (text) => text.slice(0, 20) });
        const report = await run();
        expect(report.outcome).toBe("not-evaluable");
        expect(report.reasons).toEqual([differs(join(dir, READ_FILE))]);
        expect(report.notes).toEqual([]);
        expect(report.written).toEqual({ description: true, comment: "none" });
        expect(report.readBack).toEqual({ description: false, comment: false });
        expect(existsSync(receiptPath(dir))).toBe(false);
        expect(fake.calls.filter((call) => call.startsWith("addComment"))).toEqual([]);
        expect(readFileSync(join(dir, READ_FILE), "utf8")).toBe(fake.description());
    });

    it("a tracker that drops a word fails the read-back and keeps what it returned", async () => {
        const { run, fake, dir } = await arrange(
            {},
            { store: (text) => text.replace("loops", "") },
        );
        const report = await run();
        const file = join(dir, READ_FILE);
        expect(report.outcome).toBe("not-evaluable");
        expect(exitCodeFor(report.outcome)).toBe(3);
        expect(report.reasons).toEqual([differs(file)]);
        expect(report.notes).toEqual([]);
        expect(report.readBack.description).toBe(false);
        expect(report.receipt).toBeNull();
        expect(existsSync(receiptPath(dir))).toBe(false);
        expect(fake.calls.filter((call) => call.startsWith("addComment"))).toEqual([]);
        expect(fake.comments()).toEqual([]);
        expect(readFileSync(file, "utf8")).toBe(fake.description());
        expect(readFileSync(file, "utf8")).not.toContain("loops");
        expect(readFileSync(join(dir, "description.md"), "utf8")).toContain("loops");
    });

    it("a tracker that returns nothing fails the read-back", async () => {
        const { run, dir } = await arrange({}, { store: () => "" });
        const report = await run();
        expect(report.reasons).toEqual([differs(join(dir, READ_FILE))]);
        expect(readFileSync(join(dir, READ_FILE), "utf8")).toBe("");
    });

    it("trailing whitespace is normalised in the read-back, with no note and no file", async () => {
        const stores = [(text: string) => text.trimEnd(), (text: string) => `${text}\n\n  \n`];
        for (const store of stores) {
            const { run, dir } = await arrange({}, { store });
            const report = await run();
            expect(report.outcome).toBe("advance");
            expect(report.notes).toEqual([]);
            expect(existsSync(join(dir, READ_FILE))).toBe(false);
        }
    });

    it("a description Linear re-serialised passes on its text, with one note and the returned text kept", async () => {
        const { run, fake, dir, id } = await arrangeRewrite();
        const report = await run();
        const file = join(dir, READ_FILE);
        expect(report).toMatchObject({
            outcome: "advance",
            written: { description: true, comment: "posted" },
            readBack: { description: true, comment: true },
            notes: [reserialised(file)],
            reasons: [],
            receipt: receiptPath(dir),
        });
        expect(exitCodeFor(report.outcome)).toBe(0);
        expect(readFileSync(file, "utf8")).toBe(rewrite.read);
        expect(readFileSync(join(dir, "description.md"), "utf8")).toBe(rewrite.written);
        expect(fake.description()).toBe(rewrite.read);
        expect(fake.comments()).toHaveLength(1);
        expect(readJson(receiptPath(dir))).toMatchObject({ attempt: id, header: headerOf(id) });
    });

    it("a second run over the re-serialised description passes the same way", async () => {
        const { run, fake, dir } = await arrangeRewrite();
        await run();
        const again = await run();
        expect(again).toMatchObject({
            outcome: "advance",
            notes: [reserialised(join(dir, READ_FILE))],
        });
        expect(again.written.comment).toBe("existing");
        expect(fake.comments()).toHaveLength(1);
    });

    it("a returned text that cannot be kept is a reason and leaves no receipt", async () => {
        const { run, dir } = await arrangeRewrite();
        const file = join(dir, READ_FILE);
        mkdirSync(file);
        const report = await run();
        expect(report.outcome).toBe("not-evaluable");
        expect(report.reasons[0]).toContain(`cannot write ${file}`);
        expect(report.readBack.description).toBe(false);
        expect(report.notes).toEqual([]);
        expect(existsSync(receiptPath(dir))).toBe(false);
    });

    it("a description write that fails stops before the comment and leaves no receipt", async () => {
        const error = "linear issue update DOT-121 --description-file description.md: boom";
        const { run, fake, dir } = await arrange(
            {},
            { failures: [{ method: "updateDescription", error }] },
        );
        const report = await run();
        expect(report.reasons).toEqual([error]);
        expect(report.written).toEqual({ description: false, comment: "none" });
        expect(fake.calls).toEqual(["readTask DOT-121", "updateDescription DOT-121"]);
        expect(existsSync(receiptPath(dir))).toBe(false);
    });

    it("a description read-back that fails to read is a reason and leaves no receipt", async () => {
        const error = "linear issue view DOT-121: boom";
        const { run, dir } = await arrange(
            {},
            { failures: [{ method: "readTask", call: 2, error }] },
        );
        const report = await run();
        expect(report.reasons).toEqual([error]);
        expect(report.written.description).toBe(true);
        expect(report.readBack.description).toBe(false);
        expect(existsSync(receiptPath(dir))).toBe(false);
    });

    it("a comment the tracker accepts but does not list fails the read-back", async () => {
        const { run, dir } = await arrange({}, { forgetsComments: true });
        const report = await run();
        expect(report.outcome).toBe("not-evaluable");
        expect(report.reasons).toEqual([NOT_FOUND(headerOf("linear:DOT-121:grill-me:1"))]);
        expect(report.written.comment).toBe("posted");
        expect(report.readBack.comment).toBe(false);
        expect(existsSync(receiptPath(dir))).toBe(false);
    });

    it("a comment that cannot be listed before posting stops before the post", async () => {
        const error = "linear issue comment list DOT-121: boom";
        const { run, fake } = await arrange({}, { failures: [{ method: "readComments", error }] });
        const report = await run();
        expect(report.reasons).toEqual([error]);
        expect(fake.calls).not.toContain("addComment DOT-121");
    });

    it("another attempt's comment does not stand in for this one's", async () => {
        const other =
            "autonomous · grill-me · linear:DOT-121:grill-me:10 · definition saved\n\nold";
        const { run, fake } = await arrange({}, { comments: [other, "a human wrote this"] });
        const report = await run();
        expect(report.written.comment).toBe("posted");
        expect(fake.comments()).toHaveLength(3);
    });

    it("an earlier comment of this attempt is found among others and not posted again", async () => {
        const header = headerOf("linear:DOT-121:grill-me:1");
        const { run, fake } = await arrange(
            {},
            { comments: ["first", `${header}\n\nearlier summary`, "last"] },
        );
        const report = await run();
        expect(report.outcome).toBe("advance");
        expect(report.written.comment).toBe("existing");
        expect(fake.comments()).toHaveLength(3);
    });

    it("a receipt that cannot be written is a reason", async () => {
        const { run, dir } = await arrange();
        mkdirSync(receiptPath(dir));
        const report = await run();
        expect(report.outcome).toBe("not-evaluable");
        expect(report.reasons[0]).toContain(`cannot write the receipt ${receiptPath(dir)}`);
        expect(report.receipt).toBeNull();
    });

    it("never writes the attempt record", async () => {
        const { run, dir } = await arrange();
        const before = readFileSync(recordPath(dir), "utf8");
        await run();
        expect(readFileSync(recordPath(dir), "utf8")).toBe(before);
    });
});

describe("persist: Persistence is read back through the tracker's read lag", () => {
    const callsTo = (fake: { calls: string[] }, method: string) =>
        fake.calls.filter((call) => call.startsWith(method)).length;

    it("a description that still reads as the old one is read again until it shows the new", async () => {
        const { run, fake, dir, waited } = await arrange({}, { lag: { description: 2 } });
        const report = await run();
        expect(report).toMatchObject({
            outcome: "advance",
            readBack: { description: true, comment: true },
            notes: [],
            reasons: [],
        });
        expect(callsTo(fake, "readTask")).toBe(1 + 3);
        expect(waited()).toBe(1000 + 2000);
        expect(existsSync(join(dir, READ_FILE))).toBe(false);
        expect(existsSync(receiptPath(dir))).toBe(true);
    });

    it("a description that never shows the new one fails after every read, and keeps the last read", async () => {
        const { run, fake, dir, waited } = await arrange(
            {},
            { description: "Fix the login", lag: { description: Infinity } },
        );
        const report = await run();
        const file = join(dir, READ_FILE);
        expect(report.outcome).toBe("not-evaluable");
        expect(report.reasons).toEqual([differs(file)]);
        expect(report.reasons[0]).toContain("(read 6 times over 30 s)");
        expect(report.written.description).toBe(true);
        expect(report.readBack).toEqual({ description: false, comment: false });
        expect(callsTo(fake, "readTask")).toBe(1 + 6);
        expect(waited()).toBe(ALL_WAITS_MS);
        expect(readFileSync(file, "utf8")).toBe("Fix the login");
        expect(callsTo(fake, "addComment")).toBe(0);
        expect(existsSync(receiptPath(dir))).toBe(false);
    });

    it("a description read that fails after a stale one is not read again", async () => {
        const error = "linear issue view DOT-121: boom";
        const { run, fake, dir, waited } = await arrange(
            {},
            { lag: { description: Infinity }, failures: [{ method: "readTask", call: 3, error }] },
        );
        const report = await run();
        expect(report.outcome).toBe("not-evaluable");
        expect(report.reasons).toEqual([error]);
        expect(callsTo(fake, "readTask")).toBe(3);
        expect(waited()).toBe(1000);
        expect(existsSync(receiptPath(dir))).toBe(false);
    });

    it("a description Linear linked the identifiers of passes on its text, with one note", async () => {
        const { run, fake, dir, waited } = await arrangeRewrite(
            { lag: { description: 1 } },
            autolink,
        );
        const report = await run();
        const file = join(dir, READ_FILE);
        expect(report).toMatchObject({
            outcome: "advance",
            readBack: { description: true, comment: true },
            notes: [reserialised(file)],
            reasons: [],
        });
        expect(readFileSync(file, "utf8")).toBe(autolink.read);
        expect(fake.description()).toBe(autolink.read);
        expect(callsTo(fake, "readTask")).toBe(1 + 2);
        expect(waited()).toBe(1000);
    });

    it("a comment that is not listed yet is read again until it is", async () => {
        const { run, fake, dir, waited } = await arrange({}, { lag: { comments: 2 } });
        const report = await run();
        expect(report).toMatchObject({
            outcome: "advance",
            written: { description: true, comment: "posted" },
            readBack: { description: true, comment: true },
            reasons: [],
        });
        expect(callsTo(fake, "readComments")).toBe(1 + 3);
        expect(callsTo(fake, "addComment")).toBe(1);
        expect(waited()).toBe(1000 + 2000);
        expect(existsSync(receiptPath(dir))).toBe(true);
    });

    it("a comment that is never listed fails after every read", async () => {
        const { run, fake, dir, waited } = await arrange({}, { lag: { comments: Infinity } });
        const report = await run();
        expect(report.outcome).toBe("not-evaluable");
        expect(report.reasons).toEqual([NOT_FOUND(headerOf("linear:DOT-121:grill-me:1"))]);
        expect(report.written.comment).toBe("posted");
        expect(report.readBack).toEqual({ description: true, comment: false });
        expect(callsTo(fake, "readComments")).toBe(1 + 6);
        expect(waited()).toBe(ALL_WAITS_MS);
        expect(existsSync(receiptPath(dir))).toBe(false);
    });

    it("a comment read that fails after a stale one is not read again", async () => {
        const error = "linear issue comment list DOT-121: boom";
        const { run, fake, dir, waited } = await arrange(
            {},
            { lag: { comments: Infinity }, failures: [{ method: "readComments", call: 3, error }] },
        );
        const report = await run();
        expect(report.reasons).toEqual([error]);
        expect(callsTo(fake, "readComments")).toBe(3);
        expect(waited()).toBe(1000);
        expect(existsSync(receiptPath(dir))).toBe(false);
    });

    it("a first read that already settles waits for nothing", async () => {
        const { run, waited } = await arrange();
        expect((await run()).outcome).toBe("advance");
        expect(waited()).toBe(0);
    });
});

describe("persist: Persist preconditions", () => {
    function expectNothingWritten(
        report: Awaited<ReturnType<typeof runPersist>>,
        fake: { calls: string[] },
        dir: string,
    ) {
        expect(report.outcome).toBe("not-evaluable");
        expect(exitCodeFor(report.outcome)).toBe(3);
        expect(report.written).toEqual({ description: false, comment: "none" });
        expect(report.receipt).toBeNull();
        expect(report.task).toBeNull();
        expect(fake.calls).toEqual([]);
        expect(existsSync(receiptPath(dir))).toBe(false);
        expect(existsSync(join(dir, "description.md"))).toBe(false);
        expect(existsSync(join(dir, "comment.md"))).toBe(false);
    }

    it("Missing stage summary: nothing is written and the report names the file", async () => {
        const { run, fake, dir } = await arrange({ summary: null });
        const report = await run();
        expectNothingWritten(report, fake, dir);
        expect(report.reasons).toEqual([`${join(dir, "stage-summary.md")} is missing`]);
    });

    it("a missing definition is named too", async () => {
        const { run, fake, dir } = await arrange({ definition: null });
        const report = await run();
        expectNothingWritten(report, fake, dir);
        expect(report.reasons).toEqual([`${join(dir, "definition.md")} is missing`]);
    });

    it("both missing files are named", async () => {
        const { run, fake, dir } = await arrange({ definition: null, summary: null });
        const report = await run();
        expectNothingWritten(report, fake, dir);
        expect(report.reasons).toEqual([
            `${join(dir, "definition.md")} is missing`,
            `${join(dir, "stage-summary.md")} is missing`,
        ]);
    });

    it.each([
        ["definition.md", "definition"],
        ["stage-summary.md", "summary"],
    ] as const)("an empty %s is refused, and so is one of whitespace only", async (name, key) => {
        for (const text of ["", "  \n\t \n"]) {
            const { run, fake, dir } = await arrange({ [key]: text });
            const report = await run();
            expectNothingWritten(report, fake, dir);
            expect(report.reasons).toEqual([`${join(dir, name)} is empty`]);
        }
    });

    it("Attempt already completed: nothing is written", async () => {
        const { run, fake, dir, id } = await arrange({ status: "completed" });
        const report = await run();
        expectNothingWritten(report, fake, dir);
        expect(report.reasons).toEqual([`attempt ${id} is completed, not open`]);
    });

    it.each(["discarded", "aborted"] as const)(
        "an attempt that is %s is refused",
        async (status) => {
            const { run, fake, dir, id } = await arrange({ status });
            const report = await run();
            expectNothingWritten(report, fake, dir);
            expect(report.reasons).toEqual([`attempt ${id} is ${status}, not open`]);
        },
    );

    it.each(OPEN_STATES)("an attempt that is %s is persisted", async (status) => {
        const { run } = await arrange({ status });
        expect((await run()).outcome).toBe("advance");
    });

    it("an attempt that is completed with a cleanup owed is persisted", async () => {
        const { run, state, dir } = await arrange({ status: "completed" });
        const record = await readRecord(recordPath(dir));
        const cleanup = { pending: true as const, error: "aoe remove failed" };
        await writeRecord(state, { ...record, cleanup });
        expect((await run()).outcome).toBe("advance");
    });

    it("an unknown attempt is refused naming it", async () => {
        const { deps, state, fake } = await arrange();
        const report = await runPersist("linear:DOT-999:grill-me:1", deps, STARTED);
        expect(report.outcome).toBe("not-evaluable");
        const file = recordPath(attemptDir(state, "linear:DOT-999:grill-me:1"));
        expect(report.reasons).toEqual([
            `unknown attempt linear:DOT-999:grill-me:1: no record at ${file}`,
        ]);
        expect(fake.calls).toEqual([]);
    });

    it("an attempt of another stage is refused", async () => {
        const { run, fake, dir, id } = await arrange({ stage: "test" });
        const report = await run();
        expectNothingWritten(report, fake, dir);
        expect(report.reasons).toEqual([
            `attempt ${id} is a test attempt: persist mode takes only grill-me attempts`,
        ]);
    });

    it("a source that is not enabled is refused", async () => {
        const { fake, dir, state, id } = await arrange();
        const given = config();
        const sources = { ...given.sources, linear: { ...given.sources.linear, enabled: false } };
        const report = await runPersist(
            id,
            { config: { ...given, sources }, trackers: trackersWith(fake), state },
            STARTED,
        );
        expectNothingWritten(report, fake, dir);
        expect(report.reasons).toEqual(["linear is not enabled"]);
    });

    it("an attempt record that does not parse is a reason, not a crash", async () => {
        const { run, fake, dir } = await arrange();
        const file = recordPath(dir);
        writeFileSync(file, "{ not json");
        const report = await run();
        expectNothingWritten(report, fake, dir);
        expect(report.reasons).toEqual([
            expect.stringContaining(`attempt record ${file} is not valid JSON`),
        ]);
    });

    it("a task that cannot be read is a reason and nothing is written", async () => {
        const error = "linear issue view DOT-121: Linear CLI is not authenticated";
        const { run, fake, dir } = await arrange({}, { failures: [{ method: "readTask", error }] });
        const report = await run();
        expect(report.reasons).toEqual([error]);
        expect(report.task).toBeNull();
        expect(fake.calls).toEqual(["readTask DOT-121"]);
        expect(existsSync(receiptPath(dir))).toBe(false);
    });
});

describe("persist: Persist report", () => {
    it("Persist JSON report: one document with the schema, the sections and the receipt's path", async () => {
        const { run, dir, id } = await arrange();
        const report = await run();
        expect(JSON.parse(renderPersistJson(report))).toEqual({
            schema: "autonomous.persist.v1",
            startedAt: STARTED.toISOString(),
            outcome: "advance",
            attempt: id,
            task: { source: "linear", id: "DOT-121", title: "Fix the login" },
            written: { description: true, comment: "posted" },
            readBack: { description: true, comment: true },
            notes: [],
            reasons: [],
            receipt: receiptPath(dir),
        });
    });

    it("the JSON report carries the notes of a re-serialised description", async () => {
        const { run, dir } = await arrangeRewrite();
        const document = JSON.parse(renderPersistJson(await run())) as { notes: string[] };
        expect(document.notes).toEqual([reserialised(join(dir, READ_FILE))]);
    });

    it("the JSON report of a refusal has a null task and receipt", async () => {
        const { run, id } = await arrange({ status: "completed" });
        expect(JSON.parse(renderPersistJson(await run()))).toEqual({
            schema: "autonomous.persist.v1",
            startedAt: STARTED.toISOString(),
            outcome: "not-evaluable",
            attempt: id,
            task: null,
            written: { description: false, comment: "none" },
            readBack: { description: false, comment: false },
            notes: [],
            reasons: [`attempt ${id} is completed, not open`],
            receipt: null,
        });
    });

    it("the text report says what was written, read back and where the receipt is", async () => {
        const { run, dir, id } = await arrange();
        expect(renderPersistText(await run())).toBe(
            [
                `autonomous persist — started ${STARTED.toISOString()}`,
                "outcome: advance",
                `attempt: ${id}`,
                'task: linear DOT-121 → "Fix the login"',
                "description: written, read back",
                "comment: posted, found",
                `receipt: ${receiptPath(dir)}`,
            ].join("\n"),
        );
    });

    it("the text report lists the reasons of a failure and marks a comment of an earlier run", async () => {
        const error = "linear issue comment add DOT-121 --body-file comment.md: boom";
        const failed = await arrange({}, { failures: [{ method: "addComment", error }] });
        expect(renderPersistText(await failed.run())).toBe(
            [
                `autonomous persist — started ${STARTED.toISOString()}`,
                "outcome: not-evaluable",
                `attempt: ${failed.id}`,
                'task: linear DOT-121 → "Fix the login"',
                "description: written, read back",
                "comment: not posted",
                "receipt: none",
                "reasons:",
                `  - ${error}`,
            ].join("\n"),
        );
        const header = headerOf("linear:DOT-121:grill-me:1");
        const rerun = await arrange({}, { comments: [header] });
        expect(renderPersistText(await rerun.run())).toContain("comment: already posted, found");
    });

    it("the text report lists the notes after the receipt", async () => {
        const { run, dir, id } = await arrangeRewrite();
        expect(renderPersistText(await run())).toBe(
            [
                `autonomous persist — started ${STARTED.toISOString()}`,
                "outcome: advance",
                `attempt: ${id}`,
                'task: linear DOT-121 → "Fix the login"',
                "description: written, read back",
                "comment: posted, found",
                `receipt: ${receiptPath(dir)}`,
                "notes:",
                `  - ${reserialised(join(dir, READ_FILE))}`,
            ].join("\n"),
        );
    });

    it("the text report puts the notes before the reasons", async () => {
        const error = "linear issue comment add DOT-121 --body-file comment.md: boom";
        const { run, dir } = await arrangeRewrite({ failures: [{ method: "addComment", error }] });
        expect(renderPersistText(await run())).toContain(
            [
                "receipt: none",
                "notes:",
                `  - ${reserialised(join(dir, READ_FILE))}`,
                "reasons:",
                `  - ${error}`,
            ].join("\n"),
        );
    });

    it("an unread task is shown as such", async () => {
        const { run } = await arrange({ summary: null });
        expect(renderPersistText(await run())).toContain("task: unread");
    });

    it("a configuration that cannot be loaded is one document with the path and the error", () => {
        const report = unconfiguredPersist(
            "linear:DOT-121:grill-me:1",
            "/home/me/config.json",
            "configuration file not found",
            STARTED,
        );
        expect(JSON.parse(renderPersistJson(report))).toEqual({
            schema: "autonomous.persist.v1",
            startedAt: STARTED.toISOString(),
            outcome: "not-evaluable",
            attempt: "linear:DOT-121:grill-me:1",
            task: null,
            written: { description: false, comment: "none" },
            readBack: { description: false, comment: false },
            notes: [],
            reasons: [],
            receipt: null,
            config: { path: "/home/me/config.json", error: "configuration file not found" },
        });
        expect(exitCodeFor(report.outcome)).toBe(3);
    });
});
