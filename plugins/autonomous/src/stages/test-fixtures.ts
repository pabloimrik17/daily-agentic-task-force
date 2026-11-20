import { execFile, execFileSync } from "node:child_process";

import { type Exec, toExecResult } from "../exec.ts";
import { workTask } from "../select/test-fixtures.ts";
import type { StageEnv } from "./stage.ts";

const GIT_TIMEOUT_MS = 120_000;

// The environment of every git process a test starts. A git hook (the pre-push that runs these
// tests) hands its children GIT_DIR and friends, and they would send the test's git calls to the
// real repository instead of the temporary one; so every GIT_ variable is dropped, and only the
// settings below, which also keep the machine's git configuration (signing, hooks) out, are set.
const isolatedGitEnv: NodeJS.ProcessEnv = {
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.com",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.com",
};

// Runs git to completion in the isolated environment; a failure throws.
export function gitSync(args: readonly string[], cwd?: string): void {
    execFileSync("git", [...args], { cwd, env: isolatedGitEnv, stdio: "pipe" });
}

// The git `Exec` a test hands to code under test, which would otherwise inherit process.env.
export const isolatedGit: Exec = (args) =>
    new Promise((resolve) => {
        execFile(
            "git",
            args,
            { env: isolatedGitEnv, timeout: GIT_TIMEOUT_MS },
            (error, stdout, stderr) => {
                resolve(toExecResult("git", GIT_TIMEOUT_MS, error, stdout, stderr));
            },
        );
    });

// A stage environment whose readers reject: a stage that ignores them never notices, and a test
// of one that reads replaces the reader it needs.
export function stageEnv(overrides: Partial<StageEnv> = {}): StageEnv {
    const unused = () => Promise.reject(new Error("this stage environment reads nothing"));
    return {
        tool: "claude",
        home: "/unused/home",
        task: workTask(),
        repository: "/unused/repository",
        branch: "feature/DOT-109-stage-sessions",
        readers: {
            context: { source: "linear", read: unused },
            pullRequests: new Proxy({} as StageEnv["readers"]["pullRequests"], {
                get: () => unused,
            }),
            openspec: unused,
            git: unused,
        },
        ...overrides,
    };
}
