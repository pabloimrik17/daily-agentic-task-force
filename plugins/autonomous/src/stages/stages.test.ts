import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { launchStep } from "../attempts/launch.ts";
import { ATTEMPT_SCHEMA, type AttemptRecord } from "../attempts/record.ts";
import { tempState } from "../attempts/test-fixtures.ts";
import { workTask } from "../select/test-fixtures.ts";
import type { SessionSpec } from "../sessions/manager.ts";
import { codeReviewStage } from "./code-review/stage.ts";
import { grillMeStage } from "./grill-me/stage.ts";
import { implementStage } from "./implement/stage.ts";
import { proposalStage } from "./proposal/stage.ts";
import { expectedMarker } from "./prompt.ts";
import { STAGES, stageFor } from "./registry.ts";
import type { StagePromptInput } from "./stage.ts";
import { selectedLaunch, stageEnv } from "./test-fixtures.ts";
import { testStage } from "./test.ts";
import { verifyStage } from "./verify/stage.ts";

const ID = "linear:DOT-109:test:1";
const RESULT_PATH = "/state/attempts/linear/DOT-109/test/1/result.json";

function attempt(): AttemptRecord {
    return {
        schema: ATTEMPT_SCHEMA,
        id: ID,
        task: { source: "linear", id: "DOT-109", title: "Stage sessions" },
        stage: "test",
        attempt: 1,
        state: "started",
        history: [{ state: "started", at: "2026-10-17T10:00:00Z" }],
        taken: { added: "2026-10-17T10:00:00Z", removed: null },
        workspace: {
            manager: "worktrunk",
            repository: "/home/me/WebstormProjects/repo",
            inferredFrom: "project",
            branch: "feature/DOT-109-stage-sessions",
            path: "/home/me/WebstormProjects/repo-worktrees/feature-DOT-109-stage-sessions",
        },
        session: null,
        observed: null,
        cleanup: null,
        retained: null,
        agentArgs: null,
    };
}

function input(description: string | null = "Do the thing."): StagePromptInput {
    return {
        attempt: attempt(),
        task: { ...workTask("linear", "DOT-109"), description },
        resultPath: RESULT_PATH,
        context: {},
    };
}

describe("the stage registry", () => {
    it("holds the test, grill-me, proposal, implement, verify and code-review stages", () => {
        expect([...STAGES.keys()]).toEqual([
            "test",
            "grill-me",
            "proposal",
            "implement",
            "verify",
            "code-review",
        ]);
        expect(stageFor("test")).toBe(testStage);
        expect(stageFor("grill-me")).toBe(grillMeStage);
        expect(stageFor("proposal")).toBe(proposalStage);
        expect(stageFor("implement")).toBe(implementStage);
        expect(stageFor("verify")).toBe(verifyStage);
        expect(stageFor("code-review")).toBe(codeReviewStage);
    });
});

describe("expectedMarker", () => {
    it("parses as a marker for the attempt", () => {
        expect(JSON.parse(expectedMarker(ID))).toMatchObject({
            schema: "autonomous.result.v1",
            attempt: ID,
            outcome: "completed",
        });
    });
});

describe("the test stage", () => {
    it("has its id and emoji", () => {
        expect(testStage.id).toBe("test");
        expect(testStage.emoji).toBe("🧪");
    });

    it("names the marker path, the attempt id and the expected marker in its prompt", () => {
        const prompt = testStage.prompt(input());
        expect(prompt).toContain(RESULT_PATH);
        expect(prompt).toContain(ID);
        expect(prompt).toContain(expectedMarker(ID));
    });

    it("carries the task and its description verbatim", () => {
        const prompt = testStage.prompt(input("Line one.\n\nLine two."));
        expect(prompt).toContain("linear");
        expect(prompt).toContain("DOT-109");
        expect(prompt).toContain("Line one.\n\nLine two.");
    });

    it("says so when the task has no description", () => {
        expect(testStage.prompt(input(null))).toContain("(no description)");
    });

    it("asks only for the marker and no change to the repository", () => {
        const prompt = testStage.prompt(input());
        expect(prompt).toContain("Do not change any file of the repository");
        expect(prompt).toContain("then stop");
    });

    it.each(["claude", "codex"] as const)(
        "holds its prerequisites without any check for %s",
        async (tool) => {
            expect(await testStage.prerequisites(stageEnv({ tool }))).toEqual({
                ok: true,
                context: {},
            });
        },
    );

    it("always completes", () => {
        expect(testStage.completed(workTask())).toBe(true);
    });

    it("passes the model and effort for claude and the effort alone for codex", () => {
        expect(testStage.agentArgs("claude")).toEqual(["--model", "haiku", "--effort", "low"]);
        expect(testStage.agentArgs("codex")).toEqual(["-c", "model_reasoning_effort=low"]);
    });
});

// Spec stage-sessions, "Prerequisites that cannot be read", through the grill-me stage.
describe("prerequisites that cannot be read", () => {
    let state: string;
    let root: string;
    let home: string;

    beforeEach(() => {
        state = tempState();
        root = mkdtempSync(join(tmpdir(), "stages-root-"));
        home = mkdtempSync(join(tmpdir(), "stages-home-"));
        mkdirSync(join(root, "dotfiles", ".git"), { recursive: true });
    });

    afterEach(async () => {
        await Promise.all(
            [state, root, home].map((dir) => rm(dir, { recursive: true, force: true })),
        );
    });

    const registry = () => join(home, ".claude", "plugins", "installed_plugins.json");

    it("Plugin registry cannot be read: unreadable with the read error, and launch waits with that reason", async () => {
        const ready = await grillMeStage.prerequisites(stageEnv({ tool: "claude", home }));
        const calls: string[] = [];
        const ctx = selectedLaunch({
            calls,
            task: workTask("linear", "DOT-122", ["personal", "HITL", "grill-me"]),
            stage: "grill-me",
            autonomy: "HITL",
            root,
            state,
            home,
            worktree: "/unused/worktree",
            readers: stageEnv().readers,
            specs: [],
        });

        const run = await launchStep.run(ctx);

        expect(ready).toMatchObject({
            ok: false,
            reason: expect.stringContaining(
                `cannot read the plugin registry ${registry()}`,
            ) as string,
            unreadable: true,
        });
        expect(run).toMatchObject({
            outcome: "wait",
            reasons: [ready.ok ? "unreachable" : ready.reason],
            data: { workspace: null, attempt: null },
        });
        expect(readdirSync(state)).toEqual([]);
    });

    it("Skill missing from a readable registry: fails, not as unreadable", async () => {
        mkdirSync(join(home, ".claude", "plugins"), { recursive: true });
        writeFileSync(registry(), JSON.stringify({ version: 2, plugins: {} }));

        const ready = await grillMeStage.prerequisites(stageEnv({ tool: "claude", home }));

        expect(ready).toMatchObject({
            ok: false,
            reason: expect.stringContaining("not installed") as string,
        });
        expect(ready).not.toHaveProperty("unreadable");
    });
});

describe("repository prerequisites of a stage", () => {
    it.each([
        ["test", testStage],
        ["grill-me", grillMeStage],
    ] as const)("Stage with no repository prerequisites: %s declares none", (_, stage) => {
        expect("repositoryPrerequisites" in stage).toBe(false);
    });

    describe("Supplied task in a repository that fails them", () => {
        let state: string;
        let root: string;

        beforeEach(() => {
            state = tempState();
            root = mkdtempSync(join(tmpdir(), "stages-root-"));
            mkdirSync(join(root, "dotfiles", ".git"), { recursive: true });
        });

        afterEach(async () => {
            await Promise.all(
                [state, root].map((dir) => rm(dir, { recursive: true, force: true })),
            );
        });

        it("launch waits with the repository prerequisites' reason, and nothing is written", async () => {
            const calls: string[] = [];
            const specs: SessionSpec[] = [];
            const task = workTask("linear", "DOT-121", ["personal", "AFK", "proposal"]);
            const ctx = selectedLaunch({
                calls,
                task,
                stage: "proposal",
                autonomy: "AFK",
                root,
                state,
                home: "/unused/home",
                worktree: "/unused/worktree",
                readers: stageEnv().readers,
                specs,
            });
            const repository = join(root, "dotfiles");
            const failed = await proposalStage.repositoryPrerequisites?.(repository);

            const run = await launchStep.run({
                ...ctx,
                args: { ...ctx.args, task: { source: "linear", id: "DOT-121" }, stage: "proposal" },
            });

            expect(failed).toMatchObject({ ok: false });
            expect(run).toMatchObject({
                outcome: "wait",
                reasons: [failed?.ok === false ? failed.reason : "unreachable"],
                data: { input: "supplied", workspace: null, attempt: null },
            });
            expect(readdirSync(state)).toEqual([]);
            expect(readdirSync(repository)).toEqual([".git"]);
            expect(calls.filter((call) => /addLabel/.test(call))).toEqual([]);
            expect(specs).toEqual([]);
        });
    });
});
