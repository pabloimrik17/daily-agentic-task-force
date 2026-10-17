import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Result } from "../result.ts";
import type { SessionManager } from "../sessions/manager.ts";
import type { WorkspaceManager } from "../workspace/manager.ts";
import { ATTEMPT_SCHEMA, type AttemptRecord } from "./record.ts";

// A fresh state directory; the caller removes it.
export function tempState(): string {
    return mkdtempSync(join(tmpdir(), "autonomous-state-"));
}

// A `started` attempt of `linear:DOT-109` at stage `test`.
export function record(overrides: Partial<AttemptRecord> = {}): AttemptRecord {
    return {
        schema: ATTEMPT_SCHEMA,
        id: "linear:DOT-109:test:1",
        task: { source: "linear", id: "DOT-109", title: "Stage session manager" },
        stage: "test",
        attempt: 1,
        state: "started",
        history: [
            { state: "pending", at: "2026-10-17T12:00:00.000Z" },
            { state: "created", at: "2026-10-17T12:00:05.000Z" },
            { state: "started", at: "2026-10-17T12:00:06.000Z" },
        ],
        taken: { added: "2026-10-17T12:00:00.000Z", removed: null },
        workspace: {
            manager: "worktrunk",
            repository: "/w/dotfiles",
            inferredFrom: "project Dotfiles",
            branch: "feature/DOT-109-stage-session-manager",
            path: "/w/dotfiles-worktrees/feature-DOT-109-stage-session-manager",
        },
        session: {
            manager: "aoe",
            profile: null,
            id: "ef3fde3ca69c4b8b",
            group: "Dotfiles",
            title: "auto 🧪 Stage session manager (DOT-109)",
            titleSource: "fallback",
            tool: "claude",
            agentSessionId: null,
        },
        observed: null,
        cleanup: null,
        retained: null,
        ...overrides,
    };
}

function show(argument: unknown): string {
    return typeof argument === "string" ? argument : JSON.stringify(argument);
}

// Logs "<method> <args joined by space>" (objects as JSON), then delegates to
// the scripted method or fails with "<method> was not expected".
function invoke<A extends unknown[], T>(
    calls: string[],
    method: string,
    args: A,
    scripted: ((...args: A) => Promise<Result<T>>) | undefined,
): Promise<Result<T>> {
    calls.push([method, ...args.map(show)].join(" "));
    return scripted === undefined
        ? Promise.resolve({ ok: false, error: `${method} was not expected` })
        : scripted(...args);
}

export function fakeSessions(
    script: Partial<SessionManager> & { calls?: string[] },
): SessionManager & { calls: string[] } {
    const calls = script.calls ?? [];
    return {
        calls,
        create: (spec) => invoke(calls, "create", [spec], script.create),
        start: (id) => invoke(calls, "start", [id], script.start),
        observe: (id) => invoke(calls, "observe", [id], script.observe),
        findByPath: (path) => invoke(calls, "findByPath", [path], script.findByPath),
        listGroups: () => invoke(calls, "listGroups", [], script.listGroups),
        capture: (id, lines) => invoke(calls, "capture", [id, lines], script.capture),
        remove: (id) => invoke(calls, "remove", [id], script.remove),
    };
}

export function fakeWorkspace(
    script: Partial<WorkspaceManager>,
): WorkspaceManager & { calls: string[] } {
    const calls: string[] = [];
    return {
        calls,
        prepare: (repository, branch) =>
            invoke(calls, "prepare", [repository, branch], script.prepare),
        release: (repository, branch) =>
            invoke(calls, "release", [repository, branch], script.release),
    };
}
