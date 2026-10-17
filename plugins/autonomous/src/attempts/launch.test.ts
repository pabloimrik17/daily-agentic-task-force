import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { RunArgs } from "../args.ts";
import type { ConfigLoad } from "../config.ts";
import type { Exec } from "../exec.ts";
import { config, trackers } from "../label-triage/test-fixtures.ts";
import { NOW } from "../quota-gate/test-fixtures.ts";
import type { RunContext, StepResult } from "../runner.ts";
import { fakeReader, selectContext, workTask } from "../select/test-fixtures.ts";
import type { SelectData, SelectedUnit, WorkTask } from "../select/types.ts";
import type { SessionManager, SessionSpec } from "../sessions/manager.ts";
import type { WorkspaceManager } from "../workspace/manager.ts";
import { launchStep } from "./launch.ts";
import { renderLaunch } from "./launch-render.ts";
import type { AttemptRecord } from "./record.ts";
import {
    attemptDir,
    promptPath,
    readRecord,
    recordPath,
    resultPath,
    writeRecord,
} from "./state.ts";
import { fakeSessions, fakeWorkspace, record, tempState } from "./test-fixtures.ts";

const SESSION = "336c83018fca4d13";

const ATTEMPT = "linear:DOT-109:test:1";

// Listed without its project, as the Linear reader lists; detail fills it.
const TASK = workTask("linear", "DOT-109", ["personal", "grill-me"], {
    title: "Stage session manager",
});

const DETAILS = { "DOT-109": { project: "Dotfiles" } };

let state: string;
let root: string;
let worktree: string;

beforeEach(() => {
    state = tempState();
    root = mkdtempSync(join(tmpdir(), "launch-root-"));
    mkdirSync(join(root, "dotfiles", ".git"), { recursive: true });
    worktree = mkdtempSync(join(tmpdir(), "launch-worktree-"));
});

afterEach(async () => {
    await Promise.all(
        [state, root, worktree].map((dir) => rm(dir, { recursive: true, force: true })),
    );
});

const ok =
    <T>(value: T) =>
    () =>
        Promise.resolve({ ok: true as const, value });

const fail = (error: string) => () => Promise.resolve({ ok: false as const, error });

// `claude -p` answering the naming schema with `title`.
function answering(title: string): Exec {
    return () =>
        Promise.resolve({
            ok: true,
            stdout: JSON.stringify({
                type: "result",
                subtype: "success",
                is_error: false,
                structured_output: { title },
            }),
        });
}

const timingOut: Exec = () =>
    Promise.resolve({ ok: false, error: "claude: timed out after 10000 ms" });

function selectResult(overrides: Partial<SelectedUnit> = {}): StepResult<SelectData> {
    const selected: SelectedUnit = {
        source: "linear",
        id: "DOT-109",
        title: "Stage session manager",
        stage: "grill-me",
        autonomy: "grill-me",
        scope: "personal",
        explanation: "The only candidate.",
        exception: null,
        ...overrides,
    };
    return {
        step: "select",
        tier: "code",
        outcome: "advance",
        reasons: [],
        data: {
            machineScope: "personal",
            selected,
            candidates: [],
            excluded: [],
            notEvaluated: [],
            comparison: null,
        },
    };
}

interface Setup {
    tasks?: WorkTask[] | string;
    details?: Record<string, Partial<WorkTask>>;
    args?: Partial<RunArgs>;
    results?: StepResult[];
    sessions?: Partial<SessionManager>;
    prepare?: WorkspaceManager["prepare"];
    naming?: Exec;
    tracker?: Parameters<typeof trackers>[2];
    config?: ConfigLoad;
}

// `--apply --task linear:DOT-109 --stage test` by default, over a workspace
// root holding `dotfiles`. Reader, tracker and session calls share `calls`.
function setup(options: Setup = {}) {
    const calls: string[] = [];
    const tasks = options.tasks ?? [TASK];
    const sessions = fakeSessions({
        calls,
        listGroups: ok(["Dotfiles"]),
        create: ok({ id: SESSION }),
        start: ok(undefined),
        ...options.sessions,
    });
    const workspace = fakeWorkspace({
        prepare: options.prepare ?? ok({ path: worktree, created: true }),
    });
    const tracked = trackers(
        calls,
        { linear: typeof tasks === "string" ? [] : tasks },
        options.tracker,
    );
    const base = selectContext({
        calls,
        readers: [fakeReader("linear", tasks, calls, { details: options.details ?? DETAILS })],
        config: options.config ?? { ...config(), workspace: { root } },
        results: options.results ?? [],
        args: {
            apply: true,
            task: { source: "linear", id: "DOT-109" },
            stage: "test",
            ...options.args,
        },
    });
    const ctx: RunContext = {
        ...base,
        io: {
            ...base.io,
            trackers: () => tracked,
            sessions: () => sessions,
            workspace: () => workspace,
            naming: options.naming ?? answering("Stage manager"),
            state,
        },
    };
    return { ctx, calls, sessions, workspace, trackers: tracked };
}

const SELECTED_PATH = { args: { task: undefined, stage: undefined } };

// Session manager calls only: readers and trackers log to the same list.
const sessionCalls = (calls: readonly string[]) =>
    calls.filter((call) => /^(?:listGroups|create|start)\b/.test(call));

const readAttempt = (id = ATTEMPT): Promise<AttemptRecord> =>
    readRecord(recordPath(attemptDir(state, id)));

describe("launch: the unit", () => {
    it("is not evaluable when the configuration failed to load", async () => {
        const { ctx, calls } = setup({
            config: { ok: false, path: "/c.json", error: "$.sources is missing" },
        });

        expect(await launchStep.run(ctx)).toMatchObject({
            outcome: "not-evaluable",
            reasons: ["$.sources is missing"],
        });
        expect(calls).toEqual([]);
    });

    it("waits when nothing was selected and no task was supplied", async () => {
        const { ctx, calls } = setup(SELECTED_PATH);

        expect(await launchStep.run(ctx)).toMatchObject({
            outcome: "wait",
            reasons: ["nothing selected"],
            data: { task: null, input: null },
        });
        expect(calls).toEqual([]);
    });

    it("reads the selected unit from the select step's data", async () => {
        const other = workTask("linear", "DOT-120", ["personal", "grill-me"]);
        const { ctx, calls } = setup({
            ...SELECTED_PATH,
            tasks: [TASK, other],
            results: [selectResult({ id: "DOT-120" })],
        });

        const result = await launchStep.run(ctx);

        expect(result.data).toMatchObject({
            input: "selected",
            task: { source: "linear", id: "DOT-120" },
            stage: "grill-me",
        });
        expect(calls).toContain("linear:detail:DOT-120");
    });

    it("waits when the task is not an open task of its source", async () => {
        const { ctx } = setup({ tasks: [] });

        expect(await launchStep.run(ctx)).toMatchObject({
            outcome: "wait",
            reasons: ["linear:DOT-109 is not an open task"],
        });
    });

    it("is not evaluable when the source cannot be listed", async () => {
        const { ctx } = setup({ tasks: "linear issue list: unavailable" });

        expect(await launchStep.run(ctx)).toMatchObject({
            outcome: "not-evaluable",
            reasons: ["linear: linear issue list: unavailable"],
        });
    });

    it("waits with select's exclusion when a supplied task has no scope label", async () => {
        const { ctx, workspace } = setup({
            tasks: [workTask("linear", "DOT-109", ["grill-me"])],
        });

        const result = await launchStep.run(ctx);

        expect(result).toMatchObject({
            outcome: "wait",
            reasons: ["linear:DOT-109 is excluded: classification"],
            data: { input: "supplied", excluded: { id: "DOT-109", reason: "classification" } },
        });
        expect(workspace.calls).toEqual([]);
    });

    it("launches --stage test on a task whose next stage is proposal", async () => {
        const afk = { ...TASK, labels: ["personal", "AFK"] };
        const { ctx } = setup({ tasks: [afk] });

        const result = await launchStep.run(ctx);

        expect(result).toMatchObject({ outcome: "advance", data: { stage: "test" } });
        expect((await readAttempt()).state).toBe("started");
    });
});

describe("launch: preconditions", () => {
    it("waits naming a stage without implementation, before any workspace", async () => {
        const { ctx, workspace, sessions } = setup({
            ...SELECTED_PATH,
            results: [selectResult()],
        });

        expect(await launchStep.run(ctx)).toMatchObject({
            step: "launch",
            tier: "code",
            outcome: "wait",
            reasons: ["stage grill-me has no implementation"],
            data: { stage: "grill-me", repository: null },
        });
        expect(workspace.calls).toEqual([]);
        expect(sessionCalls(sessions.calls)).toEqual([]);
    });

    it("waits when the task read again carries taken, and launches nothing", async () => {
        const taken = { ...TASK, labels: [...TASK.labels, "taken"] };
        const { ctx, workspace, sessions } = setup({
            ...SELECTED_PATH,
            tasks: [taken],
            results: [selectResult()],
        });

        expect(await launchStep.run(ctx)).toMatchObject({
            outcome: "wait",
            reasons: ["linear:DOT-109 is excluded: taken"],
            data: { excluded: { reason: "taken" } },
        });
        expect(workspace.calls).toEqual([]);
        expect(sessionCalls(sessions.calls)).toEqual([]);
        expect(await readdir(state)).toEqual([]);
    });

    it.each([
        [record({ stage: "grill-me", id: "linear:DOT-109:grill-me:1" }), "started"],
        [record({ state: "pending", session: null }), "pending"],
        [record({ state: "retained" }), "retained"],
        [
            record({ state: "completed", cleanup: { pending: true, error: "aoe remove: busy" } }),
            "completed with a pending cleanup",
        ],
    ])("waits while an attempt of the task is open: %#", async (open, described) => {
        await writeRecord(state, open);
        const { ctx, workspace } = setup();

        expect(await launchStep.run(ctx)).toMatchObject({
            outcome: "wait",
            reasons: [`attempt ${open.id} is ${described}`],
        });
        expect(workspace.calls).toEqual([]);
    });

    it("waits with the inference's reason when no repository matches", async () => {
        const { ctx, workspace } = setup({ details: {} });

        expect(await launchStep.run(ctx)).toMatchObject({
            outcome: "wait",
            reasons: ["no repository under the workspace root matches linear signals [none]"],
        });
        expect(workspace.calls).toEqual([]);
    });

    it("is not evaluable naming the command when the groups cannot be listed", async () => {
        const { ctx, workspace } = setup({
            sessions: { listGroups: fail("aoe group list --json: exit 1") },
        });

        expect(await launchStep.run(ctx)).toMatchObject({
            outcome: "not-evaluable",
            reasons: ["aoe group list --json: exit 1"],
        });
        expect(workspace.calls).toEqual([]);
    });
});

describe("launch: dry run", () => {
    it("reports the repository, branch and title, writes nothing and advances", async () => {
        const { ctx, calls, workspace } = setup({ args: { apply: false } });

        const result = await launchStep.run(ctx);

        expect(result).toEqual({
            step: "launch",
            tier: "llm",
            outcome: "advance",
            reasons: [
                `would launch test for linear:DOT-109 in ${join(root, "dotfiles")} on feature/DOT-109-stage-session-manager as "auto 🧪 Stage manager (DOT-109)"`,
                "name inferred by the LLM",
            ],
            data: {
                task: { source: "linear", id: "DOT-109", title: "Stage session manager" },
                stage: "test",
                input: "supplied",
                excluded: null,
                repository: { path: join(root, "dotfiles"), inferredFrom: "Dotfiles" },
                branch: "feature/DOT-109-stage-session-manager",
                group: "Dotfiles",
                title: { value: "auto 🧪 Stage manager (DOT-109)", source: "llm", error: null },
                workspace: null,
                attempt: null,
            },
        });
        expect(await readdir(state)).toEqual([]);
        expect(workspace.calls).toEqual([]);
        expect(calls.filter((call) => /addLabel|create|start/.test(call))).toEqual([]);
    });
});

describe("launch: the sequence", () => {
    it("launches: taken on the task, the record started with the session id", async () => {
        const { ctx, calls, workspace, trackers: tracked } = setup();

        const result = await launchStep.run(ctx);

        expect(result).toMatchObject({
            outcome: "advance",
            reasons: [`launched ${ATTEMPT} as "auto 🧪 Stage manager (DOT-109)" in ${worktree}`],
            data: {
                workspace: { path: worktree, created: true },
                attempt: { id: ATTEMPT, state: "started", session: SESSION },
            },
        });
        const read = await tracked.linear.readTask("DOT-109");
        expect(read.ok && read.value.labels).toContain("taken");
        const launched = await readAttempt();
        expect(launched).toMatchObject({
            state: "started",
            history: [
                { state: "pending", at: NOW.toISOString() },
                { state: "created", at: NOW.toISOString() },
                { state: "started", at: NOW.toISOString() },
            ],
            taken: { added: NOW.toISOString(), removed: null },
            workspace: {
                manager: "worktrunk",
                repository: join(root, "dotfiles"),
                inferredFrom: "Dotfiles",
                branch: "feature/DOT-109-stage-session-manager",
                path: worktree,
            },
            session: { manager: "aoe", profile: null, id: SESSION, tool: "claude" },
        });
        expect(workspace.calls).toEqual([
            `prepare ${join(root, "dotfiles")} feature/DOT-109-stage-session-manager`,
        ]);
        const order = calls.filter((call) => /addLabel|^create|^start/.test(call));
        expect(order.map((call) => call.split(" ")[0])).toEqual([
            "linear:addLabel:DOT-109:taken",
            "create",
            "start",
        ]);
    });

    it("writes no file of the attempt under the worktree", async () => {
        const { ctx } = setup();

        await launchStep.run(ctx);

        expect(await readdir(worktree)).toEqual([]);
    });

    it("is not evaluable naming the workspace command, before any record or taken", async () => {
        const { ctx, calls } = setup({
            prepare: fail("wt switch: timed out after 120000 ms"),
        });

        expect(await launchStep.run(ctx)).toMatchObject({
            outcome: "not-evaluable",
            reasons: ["wt switch: timed out after 120000 ms"],
            data: { workspace: null, attempt: null },
        });
        expect(await readdir(state)).toEqual([]);
        expect(calls.some((call) => call.includes("addLabel"))).toBe(false);
    });

    it("creates no session and stays pending when taken cannot be written", async () => {
        const { ctx, sessions } = setup({
            tracker: { linear: { addLabelError: "linear issue update DOT-109: 503" } },
        });

        expect(await launchStep.run(ctx)).toMatchObject({
            outcome: "not-evaluable",
            reasons: ["taken: linear issue update DOT-109: 503"],
            data: { attempt: { id: ATTEMPT, state: "pending", session: null } },
        });
        expect(sessions.calls.some((call) => call.startsWith("create"))).toBe(false);
        expect(await readAttempt()).toMatchObject({
            state: "pending",
            taken: { added: null },
            session: { id: null },
        });
    });

    it("stays pending when creating the session fails after taken was added", async () => {
        const { ctx, sessions } = setup({ sessions: { create: fail("aoe add: exit 1") } });

        expect(await launchStep.run(ctx)).toMatchObject({
            outcome: "not-evaluable",
            reasons: ["aoe add: exit 1"],
            data: { attempt: { state: "pending", session: null } },
        });
        expect(await readAttempt()).toMatchObject({
            state: "pending",
            taken: { added: NOW.toISOString() },
        });
        expect(sessions.calls.some((call) => call.startsWith("start"))).toBe(false);
    });

    it("stays created with the session id when starting fails", async () => {
        const { ctx } = setup({
            sessions: { start: fail(`aoe session start ${SESSION}: exit 1`) },
        });

        expect(await launchStep.run(ctx)).toMatchObject({
            outcome: "not-evaluable",
            reasons: [`aoe session start ${SESSION}: exit 1`],
            data: { attempt: { state: "created", session: SESSION } },
        });
        expect(await readAttempt()).toMatchObject({ state: "created", session: { id: SESSION } });
    });

    it("numbers the attempt after a discarded attempt 1", async () => {
        await writeRecord(state, record({ state: "discarded" }));
        const { ctx } = setup();

        expect(await launchStep.run(ctx)).toMatchObject({
            outcome: "advance",
            data: { attempt: { id: "linear:DOT-109:test:2", state: "started" } },
        });
        expect((await readAttempt("linear:DOT-109:test:2")).attempt).toBe(2);
    });

    it.each(["discarded", "aborted"] as const)(
        "is not blocked by a %s attempt still carrying a legacy cleanup",
        async (stale) => {
            const cleanup = { pending: true as const, error: "aoe remove: busy" };
            await writeRecord(state, record({ state: stale, cleanup }));
            const { ctx } = setup();

            expect(await launchStep.run(ctx)).toMatchObject({
                outcome: "advance",
                data: { attempt: { id: "linear:DOT-109:test:2", state: "started" } },
            });
        },
    );
});

describe("launch: the branch of a task", () => {
    const EARLIER = "feature/DOT-109-an-earlier-title";
    const earlier = () =>
        record({
            state: "discarded",
            workspace: { ...record().workspace, branch: EARLIER },
        });

    it("reuses the branch of an earlier attempt in the dry run", async () => {
        await writeRecord(state, earlier());
        const { ctx } = setup({ args: { apply: false } });

        const result = await launchStep.run(ctx);

        expect(result.reasons[0]).toContain(`on ${EARLIER} as`);
        expect(result.data.branch).toBe(EARLIER);
    });

    it("prepares the branch of an earlier attempt, not one derived from the new title", async () => {
        await writeRecord(state, earlier());
        const { ctx, workspace } = setup();

        await launchStep.run(ctx);

        expect(workspace.calls).toEqual([`prepare ${join(root, "dotfiles")} ${EARLIER}`]);
        expect((await readAttempt("linear:DOT-109:test:2")).workspace.branch).toBe(EARLIER);
    });

    it("takes the branch from the highest attempt number of the task, at any stage", async () => {
        await writeRecord(state, earlier());
        await writeRecord(
            state,
            record({
                id: "linear:DOT-109:proposal:2",
                stage: "proposal",
                attempt: 2,
                state: "discarded",
                workspace: { ...record().workspace, branch: "feature/DOT-109-latest" },
            }),
        );
        const { ctx, workspace } = setup();

        await launchStep.run(ctx);

        expect(workspace.calls).toEqual([
            `prepare ${join(root, "dotfiles")} feature/DOT-109-latest`,
        ]);
    });
});

describe("launch: session identity", () => {
    it("records the id the session manager reported and starts that session", async () => {
        const { ctx, sessions } = setup();

        await launchStep.run(ctx);

        expect((await readAttempt()).session?.id).toBe(SESSION);
        expect(sessions.calls).toContain(`start ${SESSION}`);
    });

    it("stays pending when the creation output carries no id", async () => {
        const { ctx } = setup({ sessions: { create: fail("aoe add: no ID line in output") } });

        expect(await launchStep.run(ctx)).toMatchObject({
            outcome: "not-evaluable",
            reasons: ["aoe add: no ID line in output"],
        });
        expect(await readAttempt()).toMatchObject({ state: "pending", session: { id: null } });
    });
});

describe("launch: session title and group", () => {
    it("titles the session with the inferred name and runs at the llm tier", async () => {
        const { ctx } = setup();

        const result = await launchStep.run(ctx);

        expect(result).toMatchObject({
            tier: "llm",
            data: { title: { value: "auto 🧪 Stage manager (DOT-109)", source: "llm" } },
        });
        expect((await readAttempt()).session).toMatchObject({
            title: "auto 🧪 Stage manager (DOT-109)",
            titleSource: "llm",
        });
        expect(renderLaunch(result)).toContain("title       auto 🧪 Stage manager (DOT-109) (llm)");
    });

    it("falls back to the title's words when the inference times out, at the code tier", async () => {
        const { ctx } = setup({ naming: timingOut });

        const result = await launchStep.run(ctx);

        expect(result).toMatchObject({
            tier: "code",
            outcome: "advance",
            data: {
                title: {
                    value: "auto 🧪 Stage session manager (DOT-109)",
                    source: "fallback",
                    error: "claude: timed out after 10000 ms",
                },
            },
        });
        expect((await readAttempt()).session?.titleSource).toBe("fallback");
        expect(renderLaunch(result)).toContain("(fallback: claude: timed out after 10000 ms)");
    });

    it("reports the fallback in a dry run's reasons", async () => {
        const { ctx } = setup({ naming: timingOut, args: { apply: false } });

        expect((await launchStep.run(ctx)).reasons[1]).toBe(
            "name from the fallback: claude: timed out after 10000 ms",
        );
    });

    it.each([
        [["Personal/Dotfiles", "Monolab"], "Personal/Dotfiles"],
        [["Monolab"], "Dotfiles"],
    ])("derives the group from %j", async (groups, group) => {
        const { ctx } = setup({ sessions: { listGroups: ok(groups) } });

        expect((await launchStep.run(ctx)).data.group).toBe(group);
        expect((await readAttempt()).session?.group).toBe(group);
    });
});

describe("launch: session creation arguments", () => {
    it("writes the prompt file before creating the session and names it in the instruction", async () => {
        const dir = attemptDir(state, ATTEMPT);
        const specs: SessionSpec[] = [];
        let promptBeforeCreate = "";
        const { ctx } = setup({
            sessions: {
                create: (spec) => {
                    specs.push(spec);
                    promptBeforeCreate = existsSync(promptPath(dir))
                        ? readFileSync(promptPath(dir), "utf8")
                        : "";
                    return Promise.resolve({ ok: true, value: { id: SESSION } });
                },
            },
        });

        await launchStep.run(ctx);

        expect(promptBeforeCreate).toContain(ATTEMPT);
        expect(promptBeforeCreate).toContain(resultPath(dir));
        expect(specs).toEqual([
            {
                path: worktree,
                title: "auto 🧪 Stage manager (DOT-109)",
                group: "Dotfiles",
                tool: "claude",
                binary: null,
                args: ["--model", "haiku", "--effort", "low"],
                instruction: `Read ${promptPath(dir)} and follow it.`,
            },
        ]);
    });

    it("passes the configured tool and binary", async () => {
        const specs: SessionSpec[] = [];
        const { ctx } = setup({
            config: {
                ok: true,
                path: "/c.json",
                defaulted: [],
                config: {
                    ...config(),
                    workspace: { root },
                    sessions: { tool: "codex", profile: "work", binary: "/usr/local/bin/cx" },
                },
            },
            sessions: {
                create: (spec) => {
                    specs.push(spec);
                    return Promise.resolve({ ok: true, value: { id: SESSION } });
                },
            },
        });

        await launchStep.run(ctx);

        expect(specs[0]).toMatchObject({
            tool: "codex",
            binary: "/usr/local/bin/cx",
            args: ["-c", "model_reasoning_effort=low"],
        });
        expect((await readAttempt()).session).toMatchObject({ tool: "codex", profile: "work" });
    });
});

describe("renderLaunch", () => {
    it("renders a launched attempt", async () => {
        const { ctx } = setup();

        expect(renderLaunch(await launchStep.run(ctx))).toBe(
            [
                "[launch] advance (llm)",
                "  task        linear → DOT-109 → Stage session manager",
                "  stage       test",
                "  input       supplied",
                `  repository  ${join(root, "dotfiles")} (from Dotfiles)`,
                "  branch      feature/DOT-109-stage-session-manager",
                "  group       Dotfiles",
                "  title       auto 🧪 Stage manager (DOT-109) (llm)",
                `  workspace   ${worktree} (created)`,
                `  attempt     ${ATTEMPT} started, session ${SESSION}`,
                "  reasons:",
                `    - launched ${ATTEMPT} as "auto 🧪 Stage manager (DOT-109)" in ${worktree}`,
            ].join("\n"),
        );
    });

    it("names an exclusion as select does", async () => {
        const { ctx } = setup({ tasks: [{ ...TASK, labels: ["personal", "grill-me", "taken"] }] });

        expect(renderLaunch(await launchStep.run(ctx))).toContain("  excluded    taken");
    });
});
