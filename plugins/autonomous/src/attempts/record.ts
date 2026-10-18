// The attempt record (spec stage-sessions, "An attempt", "Attempt states";
// design D1): one launch of a managed session for one stage of one task,
// kept as a JSON file in the local state directory, never in a tracker and
// never in the workspace.

import type { Source } from "../config.ts";
import type { SessionState, SessionTool } from "../sessions/manager.ts";

export const ATTEMPT_SCHEMA = "autonomous.attempt.v1";

export const ATTEMPT_STATES = [
    "pending", // record written, no session yet
    "created", // session exists, not started
    "started",
    "completed",
    "retained", // its session exited without completing; kept for the user
    "aborted", // no session was ever created
    "discarded",
] as const;

export type AttemptState = (typeof ATTEMPT_STATES)[number];

// The states in which an attempt still holds its task (spec "The launch step").
export const OPEN_STATES: readonly AttemptState[] = ["pending", "created", "started", "retained"];

const SOURCES: readonly Source[] = ["linear", "beads", "github"];

export function isSource(value: string): value is Source {
    return (SOURCES as readonly string[]).includes(value);
}

export interface AttemptTask {
    source: Source;
    id: string;
    title: string;
}

export interface AttemptWorkspace {
    manager: "worktrunk";
    repository: string; // absolute path of the repository
    inferredFrom: string; // the signal that matched, for the report
    branch: string;
    path: string; // absolute path of the worktree
}

export interface AttemptSession {
    manager: "aoe";
    profile: string | null;
    id: string | null; // null until the creation command's output was parsed
    group: string;
    title: string;
    titleSource: "llm" | "fallback";
    tool: SessionTool;
    agentSessionId: string | null; // saved before the session is removed
}

export interface AttemptObservation {
    status: string;
    state: SessionState;
    needsHuman: boolean;
    at: string;
}

export interface AttemptRecord {
    schema: typeof ATTEMPT_SCHEMA;
    id: string; // "<source>:<task>:<stage>:<n>"
    task: AttemptTask;
    stage: string;
    attempt: number; // n, from 1
    state: AttemptState;
    history: { state: AttemptState; at: string }[];
    taken: { added: string | null; removed: string | null }; // when the label was written and removed
    workspace: AttemptWorkspace;
    session: AttemptSession | null;
    observed: AttemptObservation | null;
    cleanup: { pending: true; error: string } | null; // completed, session still to remove
    retained: { at: string; reason: string } | null;
}

// Open, or completed with a cleanup still owed (spec "Open attempts"); a stale
// cleanup on a discarded or aborted record (legacy data) never holds the task.
export function holdsTask(record: AttemptRecord): boolean {
    return (
        OPEN_STATES.includes(record.state) ||
        (record.state === "completed" && record.cleanup !== null)
    );
}

export interface TaskRef {
    source: Source;
    id: string;
}

export function attemptId(task: TaskRef, stage: string, attempt: number): string {
    return `${task.source}:${task.id}:${stage}:${attempt}`;
}

// `<source>:<id>`, split at the first `:`; task ids carry no `:`.
export function parseTaskRef(value: string): TaskRef | null {
    const colon = value.indexOf(":");
    if (colon === -1) {
        return null;
    }
    const source = value.slice(0, colon);
    const id = value.slice(colon + 1);
    if (!isSource(source) || id === "") {
        return null;
    }
    return { source, id };
}

// `<source>:<task>:<stage>:<n>`; null when the value is a task reference or malformed.
export function parseAttemptId(
    value: string,
): { task: TaskRef; stage: string; attempt: number } | null {
    const parts = value.split(":");
    if (parts.length !== 4) {
        return null;
    }
    const [source = "", id = "", stage = "", n = ""] = parts;
    if (!isSource(source) || id === "" || stage === "" || !/^[1-9]\d*$/.test(n)) {
        return null;
    }
    return { task: { source, id }, stage, attempt: Number(n) };
}
