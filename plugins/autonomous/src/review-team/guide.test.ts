import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Exec, ExecResult } from "../exec.ts";
import { gitSync, isolatedGit, temporaryDirectories } from "../stages/test-fixtures.ts";
import { validateGuide } from "./guide.ts";
import type { Plan, ReviewerId } from "./types.ts";

const directories = temporaryDirectories("review-guide");
let repo: string;
let dir: string;
let plan: Plan;
let calls: string[][];

const git: Exec = (args) => isolatedGit(["-C", repo, ...args]);

async function revParse(ref: string): Promise<string> {
    const result = await git(["rev-parse", ref]);
    if (!result.ok) {
        throw new Error(result.error);
    }
    return result.stdout.trim();
}

// A `plannotator` that answers `result`, logging each call and, on success, writing the page.
function fakePlannotator(result: ExecResult = { ok: true, stdout: "Exported\n" }): Exec {
    return (args) => {
        calls.push(args);
        const out = args[args.indexOf("--out") + 1];
        if (result.ok && out !== undefined) {
            writeFileSync(out, "<html></html>\n");
        }
        return Promise.resolve(result);
    };
}

function writeGuide(sections: Record<string, string[]>, unplacedFiles: string[] = []): void {
    const guide = {
        title: "Two new files",
        intent: "Adds a and b.",
        sections: Object.entries(sections).map(([title, files]) => ({
            title,
            overview: "What changed.",
            diffs: files.map((file) => ({ file, summary: "Adds it." })),
        })),
        unplacedFiles,
    };
    writeFileSync(join(dir, "walkthrough.json"), JSON.stringify(guide));
}

function planWith(team: ReviewerId[], guide: Plan["guide"] = { available: true }): Plan {
    return {
        ...plan,
        team: team.map((reviewer) => ({
            reviewer,
            angle: "comprehension",
            kind: "teammate",
            required: true,
            engine: { tool: "claude-code", version: "1.0.0" },
            output: `reviewers/${reviewer}.json`,
        })),
        guide,
    };
}

const validate = (subject: Plan = planWith(["walkthrough"]), plannotator = fakePlannotator()) =>
    validateGuide(dir, subject, { git, plannotator });

// A repository whose `feature/work` adds `src/a.ts` and `src/b.ts` to `main`.
beforeEach(async () => {
    calls = [];
    repo = directories.make("repo");
    gitSync(["-C", repo, "init", "-q", "-b", "main"]);
    writeFileSync(join(repo, "README.md"), "base\n");
    gitSync(["-C", repo, "add", "README.md"]);
    gitSync(["-C", repo, "commit", "-q", "-m", "base"]);
    gitSync(["-C", repo, "checkout", "-q", "-b", "feature/work"]);
    mkdirSync(join(repo, "src"));
    for (const name of ["a", "b"]) {
        writeFileSync(join(repo, "src", `${name}.ts`), `export const ${name} = 1;\n`);
    }
    gitSync(["-C", repo, "add", "src"]);
    gitSync(["-C", repo, "commit", "-q", "-m", "work"]);
    plan = {
        schema: "autonomous.review-plan.v1",
        createdAt: "2026-11-22T10:00:00.000Z",
        subject: {
            repo: "repo",
            branch: "feature/work",
            base: "main",
            baseSource: "given",
            mergeBase: await revParse("main"),
            head: await revParse("HEAD"),
            dirty: false,
        },
        status: "",
        measure: { lines: 2, files: 2 },
        tier: { measured: "S", used: "S" },
        security: { triggered: false, matches: [] },
        team: [],
        skipped: [],
        guide: { available: true },
    };
    dir = directories.make("report");
});

afterEach(async () => {
    await directories.removeAll();
});

describe("validateGuide (design D9)", () => {
    it("Guide written: the directory holds the guide, its patch and its page", async () => {
        writeGuide({ "The values": ["src/a.ts"] }, ["src/b.ts"]);

        const guide = await validate();

        expect(guide).toEqual({
            guide: "walkthrough.json",
            patch: "walkthrough.patch",
            html: "walkthrough.html",
        });
        expect(calls).toEqual([
            [
                "guide",
                "export",
                "--guide",
                join(dir, "walkthrough.json"),
                "--patch",
                join(dir, "walkthrough.patch"),
                "--out",
                join(dir, "walkthrough.html"),
            ],
        ]);
        const patch = readFileSync(join(dir, "walkthrough.patch"), "utf8");
        expect(patch).toMatch(/^diff --git a\/src\/a\.ts b\/src\/a\.ts$/m);
        expect(patch).toMatch(/^\+export const b = 1;$/m);
        expect(existsSync(join(dir, "walkthrough.html"))).toBe(true);
    });

    it("Plannotator missing: no guide, because Plannotator is not available", async () => {
        writeGuide({ "The values": ["src/a.ts", "src/b.ts"] });

        const guide = await validate(
            planWith(["walkthrough"], {
                available: false,
                reason: "plannotator CLI not found on PATH",
            }),
        );

        expect(guide).toEqual({
            guide: null,
            reason: "Plannotator is not available (plannotator CLI not found on PATH)",
        });
        expect(calls).toEqual([]);
    });

    it("records a guide that places a file twice as invalid", async () => {
        writeGuide({ First: ["src/a.ts", "src/b.ts"], Second: ["src/a.ts"] });

        const guide = await validate();

        expect(guide).toEqual({
            guide: null,
            patch: "walkthrough.patch",
            reason: "walkthrough.json is not valid: src/a.ts is placed twice",
        });
        expect(calls).toEqual([]);
    });

    it("records a guide that leaves a changed file out as invalid", async () => {
        writeGuide({ "The values": ["src/a.ts"] });

        const guide = await validate();

        expect(guide.reason).toBe(
            "walkthrough.json is not valid: src/b.ts is placed nowhere (neither in a section nor unplaced)",
        );
        expect(calls).toEqual([]);
    });

    it("records a guide naming a file the patch does not change as invalid", async () => {
        writeGuide({ "The values": ["src/a.ts", "src/b.ts", "src/c.ts"] });

        expect((await validate()).reason).toBe(
            "walkthrough.json is not valid: src/c.ts is not in the patch",
        );
    });

    it("records a file that is not a guide", async () => {
        writeFileSync(
            join(dir, "walkthrough.json"),
            JSON.stringify({ sections: [{ diffs: [{}] }] }),
        );

        expect((await validate()).reason).toBe(
            "walkthrough.json is not a guide: $.sections[0].diffs[0].file must be a string",
        );
    });

    it("records a failed export with Plannotator's message, and keeps no page", async () => {
        writeGuide({ "The values": ["src/a.ts", "src/b.ts"] });
        writeFileSync(join(dir, "walkthrough.html"), "stale\n");
        const rejecting = fakePlannotator({
            ok: false,
            error: "plannotator failed: Guide is not valid:\n- missing intent",
        });

        const guide = await validate(planWith(["walkthrough"]), rejecting);

        expect(guide).toEqual({
            guide: null,
            patch: "walkthrough.patch",
            reason: "plannotator guide export: plannotator failed: Guide is not valid:\n- missing intent",
        });
        expect(existsSync(join(dir, "walkthrough.html"))).toBe(false);
    });

    it("has no guide when the walkthrough wrote none, or is not in the team", async () => {
        expect(await validate()).toEqual({
            guide: null,
            reason: "the walkthrough wrote no walkthrough.json",
        });
        writeGuide({ "The values": ["src/a.ts", "src/b.ts"] });
        expect(await validate(planWith(["codex"]))).toEqual({
            guide: null,
            reason: "the walkthrough is not in the team",
        });
        expect(calls).toEqual([]);
    });
});
