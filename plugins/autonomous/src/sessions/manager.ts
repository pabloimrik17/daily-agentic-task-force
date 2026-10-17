// The session manager contract (spec stage-sessions, "Session identity",
// "Observed session state", "Session removal"; design D2, D3): what the
// attempt steps need from a session tool, with Agent of Empires as the one
// implementation. Nothing outside `sessions/` sees the tool's own vocabulary.

import type { AutonomousConfig } from "../config.ts";
import type { Result } from "../result.ts";

export type SessionTool = "claude" | "codex";

// What the integration reduces a session to (design D3).
export type SessionState = "open" | "exited" | "gone";

export interface SessionSpec {
    path: string; // the workspace the agent runs in
    title: string;
    group: string;
    tool: SessionTool;
    binary: string | null; // the agent binary or wrapper, or null for the tool's own
    args: string[]; // the stage's agent arguments, in front of the instruction
    instruction: string; // one sentence naming the prompt file; never task text
}

export interface Observed {
    state: SessionState;
    status: string; // the manager's own status word, for the report
    busy: boolean; // the agent is working: never finalise it (design D3)
    needsHuman: boolean; // open and waiting for a person
    agentSessionId: string | null; // the agent's own conversation id, when known
}

export interface SessionManager {
    create(spec: SessionSpec): Promise<Result<{ id: string }>>; // created, not started
    start(id: string): Promise<Result<void>>;
    observe(id: string): Promise<Result<Observed>>; // a missing session is `gone`, not an error
    findByPath(path: string): Promise<Result<string[]>>; // ids whose workspace is `path`; recovery only
    listGroups(): Promise<Result<string[]>>; // group paths, for the group derivation (design D5)
    capture(id: string, lines: number): Promise<Result<string>>;
    remove(id: string): Promise<Result<void>>; // permanent, workspace kept
}

export type SessionManagerFactory = (config: AutonomousConfig) => SessionManager; // real: aoe over execs; tests: fakes
