import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseArgs } from "../../args.ts";
import { launchStep } from "../../attempts/launch.ts";
import { ATTEMPT_SCHEMA, type AttemptId, type AttemptRecord } from "../../attempts/record.ts";
import {
    attemptDir,
    definitionPath,
    promptPath,
    resultPath,
    stageSummaryPath,
} from "../../attempts/state.ts";
import { fakeSessions, fakeWorkspace, tempState } from "../../attempts/test-fixtures.ts";
import type { Exec } from "../../exec.ts";
import { config, task, trackers } from "../../label-triage/test-fixtures.ts";
import type { RunContext, StepResult } from "../../runner.ts";
import { fakeReader, selectContext, workTask } from "../../select/test-fixtures.ts";
import type { SelectData, WorkTask } from "../../select/types.ts";
import type { SessionSpec, SessionTool } from "../../sessions/manager.ts";
import type { StagePromptInput } from "../stage.ts";
import { SKILLS_PLUGIN } from "./skills.ts";
import { grillMeStage } from "./stage.ts";

const GRILL_BODY = 'Call the Skill tool twice, for "grilling" and "domain-modeling".';
const HANDOFF_BODY = [
    "Write a handoff document summarising the current conversation so a fresh agent can continue the work. Save to the temporary directory of the user's OS.",
    "",
    "Redact any sensitive information.",
].join("\n");

const CONTEXT = { "grill-with-docs": GRILL_BODY, handoff: HANDOFF_BODY };

const ATTEMPT: AttemptId = "linear:DOT-121:grill-me:1";
const DIR = attemptDir("/state", ATTEMPT);

let home: string;
let state: string;
let root: string;
let worktree: string;

beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "grill-me-home-"));
    state = tempState();
    root = mkdtempSync(join(tmpdir(), "grill-me-root-"));
    mkdirSync(join(root, "dotfiles", ".git"), { recursive: true });
    worktree = mkdtempSync(join(tmpdir(), "grill-me-worktree-"));
});

afterEach(async () => {
    await Promise.all(
        [home, state, root, worktree].map((dir) => rm(dir, { recursive: true, force: true })),
    );
});

function writeFileAt(file: string, content: string): void {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
}

function skillText(name: string, body: string): string {
    return `---\nname: ${name}\ndescription: ${name} skill\ndisable-model-invocation: true\n---\n\n${body}\n`;
}

// The registry and `<install path>/skills/<category>/<name>/SKILL.md`, laid out like 1.3.2.
function install(
    skills: Record<string, string> = {
        "engineering/grill-with-docs": GRILL_BODY,
        "productivity/handoff": HANDOFF_BODY,
    },
    version = "1.3.2",
): void {
    const installPath = join(
        home,
        ".claude",
        "plugins",
        "cache",
        "mattpocock",
        SKILLS_PLUGIN,
        version,
    );
    for (const [dir, body] of Object.entries(skills)) {
        writeFileAt(
            join(installPath, "skills", dir, "SKILL.md"),
            skillText(dir.split("/").at(-1) ?? dir, body),
        );
    }
    writeRegistry({ [`${SKILLS_PLUGIN}@mattpocock`]: [{ scope: "user", installPath, version }] });
}

function writeRegistry(plugins: Record<string, unknown>): void {
    writeFileAt(
        join(home, ".claude", "plugins", "installed_plugins.json"),
        JSON.stringify({ version: 2, plugins }),
    );
}

function attempt(id: AttemptId, ref: { source: "linear" | "github" | "beads"; id: string }) {
    const record: AttemptRecord = {
        schema: ATTEMPT_SCHEMA,
        id,
        task: { ...ref, title: "Login fix" },
        stage: "grill-me",
        attempt: 1,
        state: "started",
        history: [{ state: "started", at: "2026-11-03T10:00:00Z" }],
        taken: { added: "2026-11-03T10:00:00Z", removed: null },
        workspace: {
            manager: "worktrunk",
            repository: "/home/me/WebstormProjects/repo",
            inferredFrom: "project",
            branch: "feature/DOT-121-login-fix",
            path: "/home/me/WebstormProjects/repo-worktrees/feature-DOT-121-login-fix",
        },
        session: null,
        observed: null,
        cleanup: null,
        retained: null,
    };
    return record;
}

function linearInput(): StagePromptInput {
    return {
        attempt: attempt(ATTEMPT, { source: "linear", id: "DOT-121" }),
        task: workTask("linear", "DOT-121", ["personal", "grill-me"], {
            description: "Fix the login",
        }),
        resultPath: resultPath(DIR),
        context: CONTEXT,
    };
}

function githubInput(): StagePromptInput {
    const id: AttemptId = "github:owner/repo#7:grill-me:1";
    return {
        attempt: attempt(id, { source: "github", id: "owner/repo#7" }),
        task: workTask("github", "owner/repo#7", ["personal", "grill-me"]),
        resultPath: resultPath(attemptDir("/state", id)),
        context: CONTEXT,
    };
}

function beadsInput(): StagePromptInput {
    const id: AttemptId = "beads:agentic-task-x1:grill-me:1";
    return {
        attempt: attempt(id, { source: "beads", id: "agentic-task-x1" }),
        task: workTask("beads", "agentic-task-x1", ["personal", "grill-me"]),
        resultPath: resultPath(attemptDir("/state", id)),
        context: CONTEXT,
    };
}

const positions = (text: string, needles: readonly string[]) =>
    needles.map((needle) => text.indexOf(needle));

const ascending = (values: readonly number[]) =>
    values.every((value, index) => value >= 0 && (index === 0 || value > (values[index - 1] ?? 0)));

describe("the grill-me stage", () => {
    it("has its id and emoji", () => {
        expect(grillMeStage.id).toBe("grill-me");
        expect(grillMeStage.emoji).toBe("🔥");
    });

    it("passes opus at high effort to claude and no flag to codex", () => {
        expect(grillMeStage.agentArgs("claude")).toEqual(["--model", "opus", "--effort", "high"]);
        expect(grillMeStage.agentArgs("codex")).toEqual([]);
    });

    it("is accepted by --stage", () => {
        expect(parseArgs(["--apply", "--task", "beads:x1", "--stage", "grill-me"])).toMatchObject({
            ok: true,
            args: { apply: true, task: { source: "beads", id: "x1" }, stage: "grill-me" },
        });
    });
});

describe("grill-me prerequisites", () => {
    it("refuses codex, naming the configured tool, before any skill is read", async () => {
        install();

        expect(await grillMeStage.prerequisites({ tool: "codex", home })).toEqual({
            ok: false,
            reason: "grill-me runs only with claude; sessions.tool is codex",
        });
    });

    it("holds for claude with both skill bodies, without their frontmatter, as the context", async () => {
        install();

        const ready = await grillMeStage.prerequisites({ tool: "claude", home });

        expect(ready.ok).toBe(true);
        const context = ready.ok ? ready.context : {};
        expect(Object.keys(context).sort()).toEqual(["grill-with-docs", "handoff"]);
        expect(context["grill-with-docs"]?.trim()).toBe(GRILL_BODY);
        expect(context.handoff?.trim()).toBe(HANDOFF_BODY);
    });

    it("names the plugin when it is not installed", async () => {
        writeRegistry({ "other@market": [{ scope: "user", installPath: "/elsewhere" }] });

        const ready = await grillMeStage.prerequisites({ tool: "claude", home });

        expect(ready).toMatchObject({ ok: false });
        expect(ready.ok ? "" : ready.reason).toContain(
            `the plugin ${SKILLS_PLUGIN} is not installed`,
        );
    });

    it("names handoff when that skill is missing", async () => {
        install({ "engineering/grill-with-docs": GRILL_BODY });

        const ready = await grillMeStage.prerequisites({ tool: "claude", home });

        expect(ready.ok ? "" : ready.reason).toContain("the skill handoff is not found");
    });

    it("finds the skills of a new plugin version under other category directories", async () => {
        install({ "core/grill-with-docs": GRILL_BODY, "writing/handoff": HANDOFF_BODY }, "1.4.0");

        expect((await grillMeStage.prerequisites({ tool: "claude", home })).ok).toBe(true);
    });
});

describe("the grill-me prompt", () => {
    it("holds the shared frame: the task, its description and the result marker path", () => {
        const prompt = grillMeStage.prompt(linearInput());

        expect(prompt).toContain(`# Attempt ${ATTEMPT}`);
        expect(prompt).toContain("Fix the login");
        expect(prompt).toContain(resultPath(DIR));
    });

    it("inlines both skill bodies and says where the grill's skills come from", () => {
        const prompt = grillMeStage.prompt(linearInput());

        expect(prompt).toContain(GRILL_BODY);
        expect(prompt).toContain(HANDOFF_BODY);
        expect(prompt).toContain(`\`${SKILLS_PLUGIN}:<name>\``);
    });

    it("names the absolute stage-summary.md path for the handoff document", () => {
        const prompt = grillMeStage.prompt(linearInput());

        expect(stageSummaryPath(DIR)).toMatch(/^\/state\/attempts\/.+\/stage-summary\.md$/);
        expect(prompt).toContain(
            `write this handoff document at step 3 of the closing, to \`${stageSummaryPath(DIR)}\`, not to the temporary directory`,
        );
    });

    it("names the absolute definition.md path", () => {
        expect(grillMeStage.prompt(linearInput())).toContain(
            `Write the definition to \`${definitionPath(DIR)}\`, following the template below.`,
        );
    });

    it("names the persist and transition commands of the attempt", () => {
        const prompt = grillMeStage.prompt(linearInput());

        expect(prompt).toContain("`/autonomous:run --apply --persist linear:DOT-121:grill-me:1`");
        expect(prompt).toContain("`/autonomous:run --apply --transition linear:DOT-121`");
        expect(prompt).toContain("Only once the transition is applied, write the result marker.");
    });

    it("orders the seven closing steps", () => {
        const prompt = grillMeStage.prompt(linearInput());

        const steps = positions(prompt, [
            "1. Confirm the definition with the human, and whether to split",
            "2. Only if the grill changed glossary or ADR files, commit and push them",
            `3. Write the definition to \`${definitionPath(DIR)}\``,
            "4. Run `/autonomous:run --apply --persist",
            "5. Show the human the task's URL, or its id when the task has no URL.",
            "6. Run `/autonomous:run --apply --transition",
            "7. Only once the transition is applied, write the result marker.",
        ]);
        expect(steps, String(steps)).toSatisfy(ascending);
    });

    it("skips persist and the transition and writes the marker when the human closes the task", () => {
        const prompt = grillMeStage.prompt(linearInput());

        const exception = prompt.split("\n").find((line) => line.startsWith("The one exception:"));
        expect(exception).toContain("the human closes it in its tracker, or tells you to");
        expect(exception).toContain(
            "skip steps 2 to 6 (no docs commit, no definition, no persist, no transition), write the result marker with a summary saying the task was closed, and stop",
        );
        expect(positions(prompt, ["7. Only once the transition", exception ?? ""])).toSatisfy(
            ascending,
        );
        expect(positions(prompt, [exception ?? "", "Definition template."])).toSatisfy(ascending);
    });

    it("leaves the marker unwritten and the session open on a Later answer", () => {
        expect(grillMeStage.prompt(linearInput())).toContain(
            'When the human answers "Later", or the answer is not applied, do not write the marker, and leave this session open.',
        );
    });

    it("forbids the transition when persist exits non-zero", () => {
        expect(grillMeStage.prompt(linearInput())).toContain(
            "If it exits non-zero, tell the human what it reported, and do not run the transition.",
        );
    });

    it("gives the definition template, starting with the definition heading", () => {
        const prompt = grillMeStage.prompt(linearInput());

        expect(prompt).toContain("```markdown\n## Definition\n\n### Problem\n");
        const headings = positions(prompt, [
            "### Problem",
            "### Solution",
            "### Acceptance criteria",
            "### Non-goals",
            "### Decisions",
            "### Proposed autonomy",
            "### Artifacts",
        ]);
        expect(headings, String(headings)).toSatisfy(ascending);
        expect(prompt).toContain("<AFK or HITL, as the grill proposes it>: <the reason>");
        expect(prompt).not.toContain("### Autonomy");
    });

    it("says the autonomy label decides, so a different answer is not persisted again", () => {
        const prompt = grillMeStage.prompt(linearInput());

        const rule =
            "The task's autonomy label, set by the transition in step 6, is the decision: if the human answers another autonomy, leave the definition as it is and do not run persist again.";
        expect(prompt).toContain(rule);
        expect(positions(prompt, ["### Artifacts", rule, "### 3. Stage summary"])).toSatisfy(
            ascending,
        );
    });

    it("puts the four sections after the frame's instructions heading, in order", () => {
        const prompt = grillMeStage.prompt(linearInput());

        const sections = positions(prompt, [
            "## Instructions",
            "### 1. Grill",
            "### 2. Closing",
            "### 3. Stage summary",
            "### 4. Constraints",
            "## Result marker",
        ]);
        expect(sections, String(sections)).toSatisfy(ascending);
    });

    it("forbids a proposal in the session", () => {
        expect(grillMeStage.prompt(linearInput())).toContain(
            "Do not prepare a proposal for this task in this session.",
        );
    });

    it("lets the agent commit and push only changed glossary and ADR files, and nothing otherwise", () => {
        const prompt = grillMeStage.prompt(linearInput());

        expect(prompt).toContain(
            "Commit and push only the glossary and ADR files the grill changed, on this workspace's current branch.",
        );
        expect(prompt).toContain(
            "Open no pull request, never force a push and never pass `--no-verify`.",
        );
        expect(prompt).toContain("When the grill changed no such file, commit and push nothing.");
    });

    it("hands a failed push to the human", () => {
        expect(grillMeStage.prompt(linearInput())).toContain(
            "If a push fails, tell the human why, and continue only as the human decides.",
        );
    });

    it("creates a split's subtasks through labelling-new-tasks, the parent still persisted and transitioned", () => {
        const prompt = grillMeStage.prompt(beadsInput());

        expect(prompt).toContain(
            "create each subtask with the `autonomous:labelling-new-tasks` skill, as a native subtask of this task in the same tracker, through that tracker's parent option.",
        );
        expect(prompt).toContain("Each subtask's description holds its own definition");
        expect(prompt).toContain("each subtask gets its own autonomy");
        expect(prompt).toContain(
            "This task keeps the overall definition and still goes through its own persist and transition (steps 4 to 6).",
        );
        expect(prompt).toContain(
            "`/autonomous:run --apply --persist beads:agentic-task-x1:grill-me:1`",
        );
        expect(prompt).toContain("`/autonomous:run --apply --transition beads:agentic-task-x1`");
    });

    it("asks to count the Linear issues of a Linear split", () => {
        expect(grillMeStage.prompt(linearInput())).toContain(
            "Before a Linear split, tell the human how many Linear issues it creates",
        );
    });

    it("forbids absolute paths and machine details in a GitHub task's definition and stage summary", () => {
        const prompt = grillMeStage.prompt(githubInput());

        const rules = prompt.split("\n").filter((line) => line.includes("The issue may be public"));
        expect(rules).toHaveLength(1);
        expect(rules[0]).toContain(
            "write no absolute path and no other detail of this machine (user name, home directory, host name) in the definition or in the stage summary",
        );
        expect(positions(prompt, ["### 4. Constraints", rules[0] ?? ""])).toSatisfy(ascending);
        expect(prompt).toContain("`/autonomous:run --apply --transition github:owner/repo#7`");
    });

    it.each([
        ["linear", linearInput],
        ["beads", beadsInput],
    ])("carries no such restriction for a %s task", (_source, input) => {
        const prompt = grillMeStage.prompt(input());

        expect(prompt).not.toContain("The issue may be public");
        expect(prompt).not.toContain("no absolute path");
    });
});

describe("grill-me completion", () => {
    const tracked = (labels: string[], closed = false) =>
        task("linear", "DOT-121", labels, { closed });

    it.each([["AFK"], ["HITL"]])("holds once the transition applied %s", (autonomy) => {
        expect(grillMeStage.completed(tracked(["personal", autonomy, "proposal"]))).toBe(true);
    });

    it.each([
        [["personal", "grill-me"]],
        [["personal", "AFK", "grill-me"]],
        [["personal", "AFK", "grill-me", "proposal"]],
    ])("does not hold while the task still carries grill-me: %j", (labels) => {
        expect(grillMeStage.completed(tracked(labels))).toBe(false);
    });

    it("does not hold without an autonomy", () => {
        expect(grillMeStage.completed(tracked(["personal", "proposal"]))).toBe(false);
    });

    it("holds when the human closed the task, whatever its labels", () => {
        const canceled = { ...tracked(["personal", "grill-me"], true), status: "Canceled" };

        expect(grillMeStage.completed(canceled)).toBe(true);
    });
});

describe("launch: a grill-me unit", () => {
    const SESSION = "5f0c1d2e3a4b5c6d";

    // Listed without its project, as the Linear reader lists; detail fills it.
    const TASK: WorkTask = workTask("linear", "DOT-121", ["personal", "grill-me"], {
        title: "Login fix",
    });

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

    const selected: StepResult<SelectData> = {
        step: "select",
        tier: "code",
        outcome: "advance",
        reasons: [],
        data: {
            machineScope: "personal",
            selected: {
                source: "linear",
                id: "DOT-121",
                title: "Login fix",
                stage: "grill-me",
                autonomy: null,
                scope: "personal",
                explanation: "The only candidate.",
                exception: null,
            },
            candidates: [],
            excluded: [],
            notEvaluated: [],
            comparison: null,
        },
    };

    // DOT-121 under `--apply`, over a workspace root holding `dotfiles`: the selected unit, or
    // with `supplied` the unit `--task linear:DOT-121 --stage grill-me` names, select not run.
    function setup(tool: SessionTool, supplied = false) {
        const calls: string[] = [];
        const specs: SessionSpec[] = [];
        const sessions = fakeSessions({
            calls,
            listGroups: () => Promise.resolve({ ok: true, value: ["Dotfiles"] }),
            create: (spec) => {
                specs.push(spec);
                return Promise.resolve({ ok: true, value: { id: SESSION } });
            },
            start: () => Promise.resolve({ ok: true, value: undefined }),
        });
        const workspace = fakeWorkspace({
            prepare: () => Promise.resolve({ ok: true, value: { path: worktree, created: true } }),
        });
        const tracked = trackers(calls, { linear: [TASK] });
        const base = selectContext({
            calls,
            readers: [
                fakeReader("linear", [TASK], calls, {
                    details: { "DOT-121": { project: "Dotfiles" } },
                }),
            ],
            config: {
                ...config(),
                workspace: { root },
                sessions: { tool, profile: null, binary: null },
            },
            results: supplied ? [] : [selected],
            args: supplied
                ? { apply: true, task: { source: "linear", id: "DOT-121" }, stage: "grill-me" }
                : { apply: true },
        });
        const ctx: RunContext = {
            ...base,
            io: {
                ...base.io,
                trackers: () => tracked,
                sessions: () => sessions,
                workspace: () => workspace,
                naming: answering("Login fix"),
                state,
                home,
            },
        };
        return { ctx, calls, specs, sessions, workspace };
    }

    it("waits when codex is configured, and writes nothing", async () => {
        install();
        const { ctx, calls, sessions, workspace } = setup("codex");

        expect(await launchStep.run(ctx)).toMatchObject({
            outcome: "wait",
            reasons: ["grill-me runs only with claude; sessions.tool is codex"],
            data: { stage: "grill-me", repository: null, workspace: null, attempt: null },
        });
        expect(await readdir(state)).toEqual([]);
        expect(calls.filter((call) => /addLabel/.test(call))).toEqual([]);
        expect(
            sessions.calls.filter((call) => /^(?:listGroups|create|start)\b/.test(call)),
        ).toEqual([]);
        expect(workspace.calls).toEqual([]);
    });

    it("launches the selected unit with opus at high effort, the skill bodies in its prompt file", async () => {
        install();
        const { ctx, specs } = setup("claude");

        expect(await launchStep.run(ctx)).toMatchObject({
            outcome: "advance",
            data: { stage: "grill-me", attempt: { id: "linear:DOT-121:grill-me:1" } },
        });
        expect(specs).toMatchObject([
            {
                title: "auto 🔥 Login fix (DOT-121)",
                tool: "claude",
                args: ["--model", "opus", "--effort", "high"],
            },
        ]);
        const dir = attemptDir(state, "linear:DOT-121:grill-me:1");
        const prompt = readFileSync(promptPath(dir), "utf8");
        expect(prompt).toContain(GRILL_BODY);
        expect(prompt).toContain(HANDOFF_BODY);
        expect(prompt).not.toContain("disable-model-invocation");
        expect(prompt).not.toContain("name: grill-with-docs");
        expect(prompt).not.toContain("description: handoff skill");
        expect(prompt).toContain(stageSummaryPath(dir));
    });

    it("launches a supplied unit at --stage grill-me the same way", async () => {
        install();
        const { ctx, specs } = setup("claude", true);

        expect(await launchStep.run(ctx)).toMatchObject({
            outcome: "advance",
            data: {
                input: "supplied",
                stage: "grill-me",
                attempt: { id: "linear:DOT-121:grill-me:1" },
            },
        });
        expect(specs).toMatchObject([
            { tool: "claude", args: ["--model", "opus", "--effort", "high"] },
        ]);
        const prompt = readFileSync(
            promptPath(attemptDir(state, "linear:DOT-121:grill-me:1")),
            "utf8",
        );
        expect(prompt).toContain(GRILL_BODY);
        expect(prompt).toContain(HANDOFF_BODY);
    });
});
