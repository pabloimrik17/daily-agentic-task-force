// The local state directory (spec stage-sessions, "Local state directory";
// design D1): where attempt records, prompts, result markers and captures
// live, with atomic writes and a strict parser for the records.

import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

import { STAGE_IDS, type StageId } from "../stages/stage.ts";
import {
    array,
    boolean,
    type Json,
    number,
    object,
    ParseError,
    rejectUnknownKeys,
    string,
} from "../validate.ts";
import {
    ATTEMPT_SCHEMA,
    ATTEMPT_STATES,
    type AttemptId,
    type AttemptObservation,
    type AttemptRecord,
    type AttemptSession,
    type AttemptState,
    type AttemptTask,
    type AttemptWorkspace,
    attemptId,
    parseAttemptId,
    type TaskRef,
} from "./record.ts";

const RECORD_FILE = "record.json";

export function resolveStateDir(env: Record<string, string | undefined>): string {
    const override = env.AUTONOMOUS_STATE;
    if (override !== undefined && override !== "") {
        return override;
    }
    const xdg = env.XDG_STATE_HOME;
    if (xdg !== undefined && xdg !== "") {
        return join(xdg, "autonomous");
    }
    const home = env.HOME ?? homedir();
    return join(home, ".local", "state", "autonomous");
}

// `<state>/attempts/<source>/<task id>/<stage>/<n>`; a GitHub id nests one level deeper.
export function attemptDir(state: string, id: AttemptId): string {
    const parsed = parseAttemptId(id);
    if (parsed === null) {
        throw new Error(`malformed attempt id: ${id}`);
    }
    const { task, stage, attempt } = parsed;
    return join(state, "attempts", task.source, task.id, stage, String(attempt));
}

export function recordPath(dir: string): string {
    return join(dir, RECORD_FILE);
}

export function promptPath(dir: string): string {
    return join(dir, "prompt.md");
}

export function resultPath(dir: string): string {
    return join(dir, "result.json");
}

export function capturePath(dir: string): string {
    return join(dir, "capture.txt");
}

// A temporary file and a rename, so a reader never sees a partial file.
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
    await mkdir(dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
        await rename(temporary, file);
    } catch (error) {
        await rm(temporary, { force: true });
        throw error;
    }
}

export async function writeRecord(state: string, record: AttemptRecord): Promise<void> {
    await writeJsonAtomic(recordPath(attemptDir(state, record.id)), record);
}

function nullable<T>(
    parent: Json,
    key: string,
    path: string,
    read: (value: Json, path: string) => T,
): T | null {
    const value = parent[key];
    return value === null ? null : read(object(value, `${path}.${key}`), `${path}.${key}`);
}

function nullableString(parent: Json, key: string, path: string): string | null {
    return parent[key] === null ? null : string(parent, key, path);
}

function literal<T extends string>(
    parent: Json,
    key: string,
    path: string,
    allowed: readonly T[],
): T {
    const value = string(parent, key, path);
    if (!(allowed as readonly string[]).includes(value)) {
        throw new ParseError(`${path}.${key} must be one of ${allowed.join(", ")}`);
    }
    return value as T;
}

function attemptState(parent: Json, key: string, path: string): AttemptState {
    return literal(parent, key, path, ATTEMPT_STATES);
}

function parseTask(task: Json, path: string): AttemptTask {
    rejectUnknownKeys(task, ["source", "id", "title"], path);
    return {
        source: literal(task, "source", path, ["linear", "beads", "github"]),
        id: string(task, "id", path),
        title: string(task, "title", path),
    };
}

function parseWorkspace(workspace: Json, path: string): AttemptWorkspace {
    rejectUnknownKeys(workspace, ["manager", "repository", "inferredFrom", "branch", "path"], path);
    return {
        manager: literal(workspace, "manager", path, ["worktrunk"]),
        repository: string(workspace, "repository", path),
        inferredFrom: string(workspace, "inferredFrom", path),
        branch: string(workspace, "branch", path),
        path: string(workspace, "path", path),
    };
}

function parseSession(session: Json, path: string): AttemptSession {
    rejectUnknownKeys(
        session,
        ["manager", "profile", "id", "group", "title", "titleSource", "tool", "agentSessionId"],
        path,
    );
    return {
        manager: literal(session, "manager", path, ["aoe"]),
        profile: nullableString(session, "profile", path),
        id: nullableString(session, "id", path),
        group: string(session, "group", path),
        title: string(session, "title", path),
        titleSource: literal(session, "titleSource", path, ["llm", "fallback"]),
        tool: literal(session, "tool", path, ["claude", "codex"]),
        agentSessionId: nullableString(session, "agentSessionId", path),
    };
}

function parseObservation(observed: Json, path: string): AttemptObservation {
    rejectUnknownKeys(observed, ["status", "state", "needsHuman", "at"], path);
    return {
        status: string(observed, "status", path),
        state: literal(observed, "state", path, ["open", "exited", "gone"]),
        needsHuman: boolean(observed, "needsHuman", path),
        at: string(observed, "at", path),
    };
}

function parseTaken(taken: Json, path: string): AttemptRecord["taken"] {
    rejectUnknownKeys(taken, ["added", "removed"], path);
    return {
        added: nullableString(taken, "added", path),
        removed: nullableString(taken, "removed", path),
    };
}

function parseCleanup(cleanup: Json, path: string): { pending: true; error: string } {
    rejectUnknownKeys(cleanup, ["pending", "error"], path);
    if (!boolean(cleanup, "pending", path)) {
        throw new ParseError(`${path}.pending must be true`);
    }
    return { pending: true, error: string(cleanup, "error", path) };
}

function parseRetained(retained: Json, path: string): { at: string; reason: string } {
    rejectUnknownKeys(retained, ["at", "reason"], path);
    return { at: string(retained, "at", path), reason: string(retained, "reason", path) };
}

function parseHistory(parent: Json, path: string): AttemptRecord["history"] {
    return array(parent.history, `${path}.history`).map((entry, index) => {
        const where = `${path}.history[${index}]`;
        const item = object(entry, where);
        rejectUnknownKeys(item, ["state", "at"], where);
        return { state: attemptState(item, "state", where), at: string(item, "at", where) };
    });
}

function parseAttemptNumber(parent: Json, path: string): number {
    const attempt = number(parent, "attempt", path);
    if (!Number.isInteger(attempt) || attempt < 1) {
        throw new ParseError(`${path}.attempt must be a positive integer`);
    }
    return attempt;
}

const RECORD_KEYS = [
    "schema",
    "id",
    "task",
    "stage",
    "attempt",
    "state",
    "history",
    "taken",
    "workspace",
    "session",
    "observed",
    "cleanup",
    "retained",
];

function requireObject(parent: Json, key: string, path: string): Json {
    return object(parent[key], `${path}.${key}`);
}

// Strict: every field, no unknown key, and an `id` that matches its parts.
export function parseRecord(input: unknown): AttemptRecord {
    const root = object(input, "$");
    rejectUnknownKeys(root, RECORD_KEYS, "$");
    if (string(root, "schema", "$") !== ATTEMPT_SCHEMA) {
        throw new ParseError(`$.schema must be ${ATTEMPT_SCHEMA}`);
    }
    const task = parseTask(requireObject(root, "task", "$"), "$.task");
    const stage = literal(root, "stage", "$", STAGE_IDS);
    const attempt = parseAttemptNumber(root, "$");
    const id = string(root, "id", "$");
    const expected = attemptId(task, stage, attempt);
    if (id !== expected) {
        throw new ParseError(`$.id must equal ${expected}`);
    }
    return {
        schema: ATTEMPT_SCHEMA,
        id: expected,
        task,
        stage,
        attempt,
        state: attemptState(root, "state", "$"),
        history: parseHistory(root, "$"),
        taken: parseTaken(requireObject(root, "taken", "$"), "$.taken"),
        workspace: parseWorkspace(requireObject(root, "workspace", "$"), "$.workspace"),
        session: nullable(root, "session", "$", parseSession),
        observed: nullable(root, "observed", "$", parseObservation),
        cleanup: nullable(root, "cleanup", "$", parseCleanup),
        retained: nullable(root, "retained", "$", parseRetained),
    };
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

// An Error whose message names the file, for unreadable, non-JSON or non-matching content.
export async function readRecord(file: string): Promise<AttemptRecord> {
    let text: string;
    try {
        text = await readFile(file, "utf8");
    } catch (error) {
        throw new Error(`cannot read attempt record ${file}: ${messageOf(error)}`, {
            cause: error,
        });
    }
    let json: unknown;
    try {
        json = JSON.parse(text);
    } catch (error) {
        throw new Error(`attempt record ${file} is not valid JSON: ${messageOf(error)}`, {
            cause: error,
        });
    }
    try {
        return parseRecord(json);
    } catch (error) {
        throw new Error(
            `attempt record ${file} does not match ${ATTEMPT_SCHEMA}: ${messageOf(error)}`,
            { cause: error },
        );
    }
}

async function recordFiles(root: string): Promise<string[]> {
    try {
        const entries = await readdir(root, { recursive: true });
        return entries.filter((entry) => basename(entry) === RECORD_FILE).map((e) => join(root, e));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return [];
        }
        throw error;
    }
}

// Every record under `<state>/attempts`, sorted by id; a malformed one propagates.
export async function listRecords(state: string): Promise<AttemptRecord[]> {
    const files = await recordFiles(join(state, "attempts"));
    const records = await Promise.all(files.map(readRecord));
    return records.sort((a, b) => Number(a.id > b.id) - Number(a.id < b.id));
}

export function nextAttempt(
    records: readonly AttemptRecord[],
    task: TaskRef,
    stage: StageId,
): number {
    const numbers = records
        .filter(
            (record) =>
                record.task.source === task.source &&
                record.task.id === task.id &&
                record.stage === stage,
        )
        .map((record) => record.attempt);
    return Math.max(0, ...numbers) + 1;
}
