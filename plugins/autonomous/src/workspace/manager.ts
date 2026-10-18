// The workspace manager contract (spec stage-sessions, "Workspace
// preparation"; design D4): a worktree per task branch, prepared before a
// session is created and released only on `--discard --release-workspace`.
// worktrunk is the one implementation.

import type { AutonomousConfig } from "../config.ts";
import type { Result } from "../result.ts";

export interface WorkspaceManager {
    prepare(
        repository: string,
        branch: string,
    ): Promise<Result<{ path: string; created: boolean }>>;
    release(repository: string, branch: string): Promise<Result<void>>; // removes the worktree, keeps the branch
}

export type WorkspaceManagerFactory = (config: AutonomousConfig) => WorkspaceManager; // real: wt over execs; tests: fakes
