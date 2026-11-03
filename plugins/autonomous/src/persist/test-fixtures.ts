import { writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";

import {
    type AttemptId,
    attemptId,
    type AttemptState,
    type AttemptRecord,
} from "../attempts/record.ts";
import { attemptDir, definitionPath, stageSummaryPath, writeRecord } from "../attempts/state.ts";
import { record as startedAttempt } from "../attempts/test-fixtures.ts";
import type { Source } from "../config.ts";
import { task, trackers } from "../label-triage/test-fixtures.ts";
import type { Tracker, TrackerResult, Trackers } from "../label-triage/trackers/tracker.ts";
import type { StageId } from "../stages/stage.ts";

export const DEFINITION = "## Definition\n\n### Problem\n\nThe login loops.\n";

export const SUMMARY = "Decided: fix the redirect, not the session.\n";

export interface AttemptOptions {
    source?: Source;
    taskId?: string;
    stage?: StageId;
    status?: AttemptState;
    definition?: string | null; // null: no definition.md
    summary?: string | null; // null: no stage-summary.md
}

// An attempt record in `state` and, unless an option says null, the two files the agent writes.
export async function startAttempt(
    state: string,
    options: AttemptOptions = {},
): Promise<{ id: AttemptId; dir: string }> {
    const {
        source = "linear",
        taskId = "DOT-121",
        stage = "grill-me",
        status = "started",
    } = options;
    const ref = { source, id: taskId };
    const id = attemptId(ref, stage, 1);
    const record: AttemptRecord = startedAttempt({
        id,
        task: { ...ref, title: "Fix the login" },
        stage,
        state: status,
    });
    await writeRecord(state, record);
    const dir = attemptDir(state, id);
    const files = [
        [definitionPath(dir), options.definition === undefined ? DEFINITION : options.definition],
        [stageSummaryPath(dir), options.summary === undefined ? SUMMARY : options.summary],
    ] as const;
    for (const [file, text] of files) {
        if (text !== null) {
            await writeFile(file, text);
        }
    }
    return { id, dir };
}

export type DocumentMethod = "readTask" | "updateDescription" | "addComment" | "readComments";

export interface DocumentScript {
    description?: string | null; // what the task holds before persist runs
    comments?: string[]; // the comments it already has
    // A method that fails: its `call`-th call (counted from 1), or every call when `call` is absent.
    failures?: readonly { method: DocumentMethod; call?: number; error: string }[];
    store?: (description: string) => string; // what the tracker keeps of a description it is given
    forgetsComments?: boolean; // addComment succeeds but nothing is kept
}

export interface FakeDocuments {
    tracker: Tracker;
    calls: string[]; // "<method> <task id>", in order
    description: () => string | null;
    comments: () => readonly string[];
}

// A tracker that keeps one task's description and comments, and reads the files it is handed.
export function fakeDocuments(source: Source, script: DocumentScript = {}): FakeDocuments {
    const calls: string[] = [];
    const counts = new Map<DocumentMethod, number>();
    const stored = {
        description: script.description === undefined ? "Fix the login" : script.description,
        comments: [...(script.comments ?? [])],
    };
    const act = <T>(method: DocumentMethod, id: string, work: () => T): TrackerResult<T> => {
        calls.push(`${method} ${id}`);
        const count = (counts.get(method) ?? 0) + 1;
        counts.set(method, count);
        const failure = script.failures?.find(
            (candidate) =>
                candidate.method === method &&
                (candidate.call === undefined || candidate.call === count),
        );
        return failure === undefined
            ? { ok: true, value: work() }
            : { ok: false, error: failure.error };
    };
    const tracker: Tracker = {
        ...trackers([], {})[source],
        readTask: (id) =>
            Promise.resolve(
                act("readTask", id, () =>
                    task(source, id, ["grill-me"], {
                        title: "Fix the login",
                        description: stored.description,
                    }),
                ),
            ),
        updateDescription: (id, file) =>
            Promise.resolve(
                act("updateDescription", id, () => {
                    const given = readFileSync(file, "utf8");
                    stored.description = script.store === undefined ? given : script.store(given);
                }),
            ),
        addComment: (id, file) =>
            Promise.resolve(
                act("addComment", id, () => {
                    const body = readFileSync(file, "utf8");
                    if (script.forgetsComments !== true) {
                        stored.comments.push(body);
                    }
                }),
            ),
        readComments: (id) => Promise.resolve(act("readComments", id, () => [...stored.comments])),
    };
    return {
        tracker,
        calls,
        description: () => stored.description,
        comments: () => stored.comments,
    };
}

// Every source answers with the fake it was given and with an inert tracker otherwise.
export function trackersWith(fake: FakeDocuments): Trackers {
    return { ...trackers([], {}), [fake.tracker.source]: fake.tracker };
}
