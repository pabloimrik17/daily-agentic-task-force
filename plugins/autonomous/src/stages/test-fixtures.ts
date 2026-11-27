import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { expect } from "vitest";

import { fakeSessions, fakeWorkspace } from "../attempts/test-fixtures.ts";
import { emptyContext } from "../context/shared.ts";
import type { ContextReader } from "../context/types.ts";
import { type Exec, toExecResult } from "../exec.ts";
import type { AutonomyLabel } from "../label-contract/contract.ts";
import { config, trackers } from "../label-triage/test-fixtures.ts";
import type { PullRequest, PullRequests, ReviewThread } from "../pull-request/port.ts";
import type { Result } from "../result.ts";
import type { RunContext } from "../runner.ts";
import { fakeReader, selectContext, workTask } from "../select/test-fixtures.ts";
import type { StageName, WorkTask } from "../select/types.ts";
import type { SessionSpec } from "../sessions/manager.ts";
import { SKILLS_PLUGIN } from "./grill-me/prompt.ts";
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

export function gitSync(args: readonly string[], cwd?: string): void {
    execFileSync("git", [...args], { cwd, env: isolatedGitEnv, stdio: "pipe" });
}

// The git `Exec` a test hands to code under test, which would otherwise inherit process.env.
export const isolatedGit: Exec = (args, input) =>
    new Promise((resolve) => {
        const child = execFile(
            "git",
            args,
            { env: isolatedGitEnv, timeout: GIT_TIMEOUT_MS },
            (error, stdout, stderr) => {
                resolve(toExecResult("git", GIT_TIMEOUT_MS, error, stdout, stderr));
            },
        );
        if (input !== undefined) {
            // As execCommand: an exit before the input is drained is reported by the callback.
            child.stdin?.on("error", () => {});
            child.stdin?.end(input);
        }
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

// The temporary directories a test makes, all removed by `removeAll` after it.
export interface TemporaryDirectories {
    make(name: string): string;
    track(directory: string): string;
    removeAll(): Promise<void>;
}

export function temporaryDirectories(prefix: string): TemporaryDirectories {
    let made: string[] = [];
    const track = (directory: string) => {
        made.push(directory);
        return directory;
    };
    return {
        make: (name) => track(mkdtempSync(join(tmpdir(), `${prefix}-${name}-`))),
        track,
        removeAll: async () => {
            await Promise.all(made.map((dir) => rm(dir, { recursive: true, force: true })));
            made = [];
        },
    };
}

function put(file: string, content = "x\n"): void {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
}

function git(directory: string, ...args: string[]): void {
    gitSync(["-C", directory, ...args]);
}

// A repository whose origin's `main` holds an OpenSpec root, checked out on `branch`, which adds
// `files` in one commit: what proposal preparation leaves behind.
export function repositoryAdding(
    { directory, origin, branch }: { directory: string; origin: string; branch: string },
    files: readonly string[],
): string {
    git(origin, "init", "--bare", "-b", "main");
    git(directory, "init", "-b", "main");
    git(directory, "remote", "add", "origin", origin);
    put(join(directory, "openspec", "specs", "base", "spec.md"));
    git(directory, "add", "openspec");
    git(directory, "commit", "-m", "base");
    git(directory, "push", "-u", "origin", "main");
    git(directory, "checkout", "-b", branch);
    for (const file of files) {
        put(join(directory, file));
        git(directory, "add", file);
    }
    git(directory, "commit", "-m", "propose");
    return directory;
}

export const changeFiles = (name: string): string[] => [
    `openspec/changes/${name}/proposal.md`,
    `openspec/changes/${name}/tasks.md`,
];

export type WorkflowForm = "skill" | "linked skill" | "command";

// How the repository provides one workflow, by its skill and its command without `/opsx:`;
// OpenSpec 2.0 links the skill from `.agents/skills/`.
export function provideWorkflow(
    repository: string,
    { skill, command }: { skill: string; command: string },
    form: WorkflowForm,
): void {
    if (form === "command") {
        put(join(repository, ".claude", "commands", "opsx", `${command}.md`));
        return;
    }
    if (form === "skill") {
        put(join(repository, ".claude", "skills", skill, "SKILL.md"));
        return;
    }
    put(join(repository, ".agents", "skills", skill, "SKILL.md"));
    mkdirSync(join(repository, ".claude", "skills"), { recursive: true });
    symlinkSync(
        join("..", "..", ".agents", "skills", skill),
        join(repository, ".claude", "skills", skill),
    );
}

// The handoff skill, with `body`, where the run finds it: the plugin registry and the install
// path it names.
export function installHandoff(home: string, body: string): string {
    const plugins = join(home, ".claude", "plugins");
    const installPath = join(plugins, "cache", "mattpocock", SKILLS_PLUGIN, "1");
    put(
        join(installPath, "skills", "productivity", "handoff", "SKILL.md"),
        `---\nname: handoff\ndescription: handoff skill\n---\n\n${body}\n`,
    );
    put(
        join(plugins, "installed_plugins.json"),
        JSON.stringify({
            version: 2,
            plugins: { [`${SKILLS_PLUGIN}@mattpocock`]: [{ scope: "user", installPath }] },
        }),
    );
    return home;
}

// Readers that log each call to `calls`; git runs for real, the others answer as told: no
// context, `pullRequest` for the branch, `main` as the default branch, and `threads` for the pull
// request's review threads.
export function loggingReaders(
    calls: string[],
    pullRequest: PullRequest | null,
    threads: Result<ReviewThread[]> = { ok: true, value: [] },
): StageEnv["readers"] {
    const context: ContextReader = {
        source: "linear",
        read: ({ id }) => {
            calls.push(`context:${id}`);
            return Promise.resolve({ ok: true, value: emptyContext() });
        },
    };
    const pullRequests: Partial<PullRequests> = {
        find: (branch) => {
            calls.push(`find:${branch}`);
            return Promise.resolve({ ok: true, value: pullRequest });
        },
        defaultBranch: () => {
            calls.push("defaultBranch");
            return Promise.resolve({ ok: true, value: "main" });
        },
        threads: (number) => {
            calls.push(`threads:${number}`);
            return Promise.resolve(threads);
        },
    };
    return {
        context,
        pullRequests: pullRequests as PullRequests,
        openspec: (args) => {
            calls.push(`openspec ${args.join(" ")}`);
            return Promise.resolve({ ok: true, stdout: "2.0.0\n" });
        },
        git: (args) => {
            calls.push(`git ${args.slice(2, 3).join(" ")}`);
            return isolatedGit(args);
        },
    };
}

export interface SelectedLaunch {
    calls: string[];
    task: WorkTask; // a Linear task in the project Dotfiles
    stage: StageName;
    autonomy: AutonomyLabel;
    root: string; // the workspace root, holding the repository `dotfiles`
    state: string;
    home: string;
    worktree: string; // the path the workspace manager prepares
    readers: StageEnv["readers"];
    specs: SessionSpec[]; // every session the launch creates
}

function selected({ task, stage, autonomy }: SelectedLaunch) {
    return {
        source: task.source,
        id: task.id,
        title: task.title,
        stage,
        autonomy,
        scope: "personal",
        explanation: "The only candidate.",
        exception: null,
    };
}

// A run context whose select step chose the task alone, for launch to start its attempt.
export function selectedLaunch(setup: SelectedLaunch): RunContext {
    const { calls, task, root, state, home, worktree, readers, specs } = setup;
    const base = selectContext({
        calls,
        readers: [
            fakeReader("linear", [task], calls, {
                details: { [task.id]: { project: "Dotfiles" } },
            }),
        ],
        config: { ...config(), workspace: { root } },
        results: [
            {
                step: "select",
                tier: "code",
                outcome: "advance",
                reasons: [],
                data: {
                    machineScope: "personal",
                    selected: selected(setup),
                    candidates: [],
                    setAside: [],
                    excluded: [],
                    readyToClose: [],
                    notEvaluated: [],
                    comparison: null,
                },
            },
        ],
        args: { apply: true },
    });
    return {
        ...base,
        io: {
            ...base.io,
            trackers: () => trackers(calls, { linear: [task] }),
            sessions: () =>
                fakeSessions({
                    calls,
                    listGroups: () => Promise.resolve({ ok: true, value: ["Dotfiles"] }),
                    create: (spec) => {
                        specs.push(spec);
                        return Promise.resolve({ ok: true, value: { id: "5f0c1d2e3a4b5c6d" } });
                    },
                    start: () => Promise.resolve({ ok: true, value: undefined }),
                }),
            workspace: () =>
                fakeWorkspace({
                    prepare: () =>
                        Promise.resolve({ ok: true, value: { path: worktree, created: true } }),
                }),
            naming: () => Promise.resolve({ ok: false, error: "no naming in this test" }),
            context: () => ({
                beads: readers.context,
                github: readers.context,
                linear: readers.context,
            }),
            pullRequests: () => readers.pullRequests,
            openspec: readers.openspec,
            git: readers.git,
            state,
            home,
        },
    };
}

// The text of one numbered prompt section, up to the next one or the result marker.
export function promptSection(text: string, title: string): string {
    const start = text.search(new RegExp(`^### \\d+\\. ${title}$`, "m"));
    expect(start, title).toBeGreaterThanOrEqual(0);
    const rest = text.slice(start + 1);
    return rest.slice(0, rest.search(/^(?:### \d+\. |## Result marker)/m));
}

// Whether every needle is found, each after the one before it.
export function inOrder(text: string, needles: readonly string[]): boolean {
    let from = 0;
    for (const needle of needles) {
        const at = text.indexOf(needle, from);
        if (at < 0) {
            return false;
        }
        from = at + needle.length;
    }
    return true;
}
