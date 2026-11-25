import { mkdirSync, readFileSync, realpathSync, utimesSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Exec } from "../exec.ts";
import { gitSync, isolatedGit, temporaryDirectories } from "../stages/test-fixtures.ts";
import { collect } from "./collect.ts";
import { REGISTRY } from "./registry.ts";
import { parseReport } from "./schema.ts";
import { gitStatus, treeFingerprint } from "./subject.ts";
import type { Location, Plan, PlannedReviewer, Report, ReviewerId } from "./types.ts";

type Obj = Record<string, unknown>;

const directories = temporaryDirectories("review-collect");
const CREATED_AT = "2026-11-22T10:00:00.000Z";
let repo: string;
let dir: string;
let mergeBase: string;
let head: string;
let fingerprint: string;
let calls: string[];

const git: Exec = (args, input) => isolatedGit(["-C", repo, ...args], input);

function run(...args: string[]): void {
    gitSync(["-C", repo, ...args]);
}

function commit(file: string, content: string): void {
    writeFileSync(join(repo, file), content);
    run("add", file);
    run("commit", "-q", "-m", file);
}

function valueOf<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
    if (!result.ok) {
        throw new Error(result.error);
    }
    return result.value;
}

async function revParse(ref: string): Promise<string> {
    const result = await git(["rev-parse", ref]);
    if (!result.ok) {
        throw new Error(result.error);
    }
    return result.stdout.trim();
}

// A `plannotator` that accepts every guide, logging each call.
const plannotator: Exec = (args) => {
    calls.push(`plannotator ${args.slice(0, 2).join(" ")}`);
    return Promise.resolve({ ok: true, stdout: "Exported\n" });
};

const deps = () => ({ git, plannotator });

function row(reviewer: ReviewerId, engine: Obj = {}): PlannedReviewer {
    const entry = REGISTRY[reviewer];
    return {
        reviewer,
        angle: entry.angle,
        kind: entry.kind,
        required: entry.required,
        engine: { tool: entry.tool, version: "1.2.3", ...engine },
        output: `reviewers/${reviewer}.json`,
    };
}

function writePlan(team: PlannedReviewer[], extra: Partial<Plan> = {}): void {
    const plan: Plan = {
        schema: "autonomous.review-plan.v1",
        createdAt: CREATED_AT,
        subject: {
            repo: "my-repo",
            branch: "feature/work",
            base: "main",
            baseSource: "given",
            mergeBase,
            head,
            dirty: false,
        },
        status: "",
        fingerprint,
        measure: { lines: 4, files: 2 },
        tier: { measured: "S", used: "S" },
        security: { triggered: false, matches: [] },
        team,
        skipped: [],
        guide: { available: true },
        ...extra,
    };
    writeFileSync(join(dir, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
}

function writeReviewer(reviewer: ReviewerId, content: unknown): string {
    const path = join(dir, "reviewers", `${reviewer}.json`);
    writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
    return path;
}

const reported = (reviewer: ReviewerId, items: Obj[], extra: Obj = {}): Obj => ({
    schema: "autonomous.finding.v1",
    reviewer,
    outcome: "reported",
    items,
    ...extra,
});

const at = (startLine: number, endLine = startLine, file = "src/a.ts"): Location => ({
    scope: "line",
    file,
    startLine,
    endLine,
    side: "new",
});

const finding = (title: string, nativeSeverity: string, location: Location = at(40)): Obj => ({
    kind: "finding",
    title,
    statement: "The save is not awaited, so the caller goes on before it ends.",
    location,
    evidence: "`save(record)` on line 40 has no await.",
    label: "issue",
    nativeSeverity,
});

const doubt = (title: string, location: Location = at(7)): Obj => ({
    kind: "doubt",
    title,
    statement: "The flag is removed with no replacement.",
    location,
    label: "question",
});

async function collected(): Promise<Report> {
    const result = await collect(dir, deps());
    if (!result.ok) {
        throw new Error(result.error);
    }
    return result.value;
}

const outcomeOf = (report: Report, reviewer: ReviewerId) =>
    report.reviewers.find((entry) => entry.reviewer === reviewer);

// A repository on `feature/work`, one commit ahead of `main`, and an empty report directory.
beforeEach(async () => {
    calls = [];
    repo = join(directories.make("repo"), "my-repo");
    mkdirSync(repo);
    run("init", "-q", "-b", "main");
    commit("README.md", "base\n");
    mergeBase = await revParse("HEAD");
    run("checkout", "-q", "-b", "feature/work");
    mkdirSync(join(repo, "src"));
    commit("src/a.ts", "export const a = 1;\n");
    head = await revParse("HEAD");
    fingerprint = valueOf(await treeFingerprint(git));
    dir = directories.make("report");
    mkdirSync(join(dir, "reviewers"));
});

afterEach(async () => {
    await directories.removeAll();
});

describe("collect: grouping (design D10)", () => {
    it("Two reviewers, same finding: one entry naming both reviewers", async () => {
        writePlan([row("code-review", { level: "medium" }), row("codex", { effort: "medium" })]);
        writeReviewer(
            "code-review",
            reported("code-review", [finding("Missing await on save", "important")]),
        );
        writeReviewer("codex", reported("codex", [finding("missing  AWAIT on save ", "P2")]));

        const report = await collected();

        expect(report.findings).toHaveLength(1);
        expect(report.findings[0]).toMatchObject({
            id: "code-review-1",
            title: "Missing await on save",
            severity: "CRITICAL",
            engine: { tool: "claude-code", version: "1.2.3", level: "medium" },
            reporters: [
                { reviewer: "code-review", id: "code-review-1" },
                { reviewer: "codex", id: "codex-1" },
            ],
        });
    });

    it("Same place, different claim: two entries", async () => {
        writePlan([row("code-review"), row("codex")]);
        writeReviewer(
            "code-review",
            reported("code-review", [finding("Missing await on save", "important")]),
        );
        writeReviewer("codex", reported("codex", [finding("Save result is ignored", "P1")]));

        const report = await collected();

        expect(report.findings.map((entry) => entry.id)).toEqual(["code-review-1", "codex-1"]);
        expect(report.findings.map((entry) => entry.reporters.length)).toEqual([1, 1]);
    });

    it("keeps apart a different line range, file-scope findings and doubts", async () => {
        writePlan([row("code-review"), row("codex")]);
        const file: Location = { scope: "file", file: "src/a.ts" };
        writeReviewer(
            "code-review",
            reported("code-review", [
                finding("Missing await on save", "important", at(40, 41)),
                finding("No tests", "nit", file),
                doubt("Was the flag removed on purpose?"),
            ]),
        );
        writeReviewer(
            "codex",
            reported("codex", [
                finding("Missing await on save", "P1", at(40)),
                finding("No tests", "P3", file),
                doubt("Was the flag removed on purpose?"),
            ]),
        );

        const report = await collected();

        expect(report.findings).toHaveLength(4);
        expect(report.doubts.map((entry) => entry.id)).toEqual(["code-review-3", "codex-3"]);
    });

    it("keeps apart the old side and the new side of the same range, and groups the same side", async () => {
        writePlan([row("code-review"), row("codex"), row("coderabbit")]);
        const old: Location = {
            scope: "line",
            file: "src/a.ts",
            startLine: 40,
            endLine: 40,
            side: "old",
        };
        writeReviewer(
            "code-review",
            reported("code-review", [finding("Missing await on save", "important", old)]),
        );
        writeReviewer("codex", reported("codex", [finding("Missing await on save", "P1")]));
        writeReviewer(
            "coderabbit",
            reported("coderabbit", [finding("Missing await on save", "major", old)]),
        );

        const report = await collected();

        expect(
            report.findings.map((entry) => [
                entry.id,
                entry.location,
                entry.reporters.map((reporter) => reporter.id),
            ]),
        ).toEqual([
            ["code-review-1", old, ["code-review-1", "coderabbit-1"]],
            ["codex-1", at(40), ["codex-1"]],
        ]);
    });
});

describe("collect: each reviewer's output", () => {
    it("numbers findings and doubts together, in the reviewer's order", async () => {
        writePlan([row("walkthrough")]);
        writeFileSync(join(dir, "walkthrough.json"), "{}");
        writeReviewer(
            "walkthrough",
            reported("walkthrough", [
                finding("Comment says five retries", "WARNING"),
                doubt("Why was the check removed?"),
                finding("Name says the opposite", "SUGGESTION", at(3)),
            ]),
        );

        const report = await collected();

        expect(report.findings.map((entry) => entry.id)).toEqual([
            "walkthrough-1",
            "walkthrough-3",
        ]);
        expect(report.doubts).toMatchObject([
            { id: "walkthrough-2", reviewer: "walkthrough", kind: "doubt", label: "question" },
        ]);
        expect(report.doubts[0]).not.toHaveProperty("severity");
    });

    it("derives each severity from the reviewer's table", async () => {
        writePlan([row("code-review"), row("coderabbit"), row("fallow-review")]);
        writeReviewer(
            "code-review",
            reported("code-review", [finding("A", "pre_existing", at(1))]),
        );
        writeReviewer(
            "coderabbit",
            reported("coderabbit", [finding("B", "major", at(2)), finding("C", "trivial", at(3))]),
        );
        writeReviewer("fallow-review", reported("fallow-review", [finding("D", "block", at(4))]));

        const report = await collected();

        expect(report.findings.map((entry) => [entry.nativeSeverity, entry.severity])).toEqual([
            ["pre_existing", "WARNING"],
            ["major", "WARNING"],
            ["trivial", "SUGGESTION"],
            ["block", "CRITICAL"],
        ]);
    });

    it("skips a non-required reviewer whose file fails validation, quoting the error and reporting none of its items", async () => {
        writePlan([row("codex")]);
        writeReviewer(
            "codex",
            reported("codex", [finding("Real defect", "P1"), finding("Odd", "P9", at(2))]),
        );

        const report = await collected();

        expect(outcomeOf(report, "codex")).toMatchObject({ outcome: "skipped", required: false });
        expect(outcomeOf(report, "codex")?.reason).toContain(
            '$.items[1].nativeSeverity "P9" is not listed in the codex severity table',
        );
        expect(report.findings).toEqual([]);
        expect(report.errors).toEqual([]);
    });

    it("skips a file written for another reviewer, and one that is not JSON", async () => {
        writePlan([row("codex"), row("coderabbit")]);
        writeReviewer("codex", reported("coderabbit", [finding("A", "major")]));
        writeReviewer("coderabbit", "{ not json");

        const report = await collected();

        expect(outcomeOf(report, "codex")?.reason).toBe(
            'wrote reviewers/codex.json as reviewer "coderabbit" instead of "codex"',
        );
        expect(outcomeOf(report, "coderabbit")?.reason).toMatch(
            /^wrote reviewers\/coderabbit\.json, which is not JSON: /,
        );
        expect(report.findings).toEqual([]);
    });

    it("carries a skipped file's reason", async () => {
        writePlan([row("coderabbit")]);
        writeReviewer("coderabbit", {
            schema: "autonomous.finding.v1",
            reviewer: "coderabbit",
            outcome: "skipped",
            reason: "rate limited",
        });

        const report = await collected();

        expect(outcomeOf(report, "coderabbit")).toMatchObject({
            outcome: "skipped",
            reason: "rate limited",
        });
        expect(report.errors).toEqual([]);
    });

    it("skips a non-required reviewer that wrote nothing, with no error", async () => {
        writePlan([row("code-review")]);

        const report = await collected();

        expect(outcomeOf(report, "code-review")).toEqual({
            reviewer: "code-review",
            outcome: "skipped",
            reason: "ended without writing its output (reviewers/code-review.json)",
            required: false,
            engine: { tool: "claude-code", version: "1.2.3" },
        });
        expect(report.errors).toEqual([]);
    });

    it("takes the file's duration, else the time from the plan to the file's last write", async () => {
        writePlan([row("codex"), row("coderabbit")]);
        writeReviewer("codex", reported("codex", [], { durationMs: 1234 }));
        const path = writeReviewer("coderabbit", reported("coderabbit", []));
        const written = new Date(Date.parse(CREATED_AT) + 5000);
        utimesSync(path, written, written);

        const report = await collected();

        expect(outcomeOf(report, "codex")?.durationMs).toBe(1234);
        expect(outcomeOf(report, "coderabbit")?.durationMs).toBe(5000);
    });

    it("carries the plan's skipped reviewers over, with their reasons and no engine", async () => {
        writePlan([row("code-review")], {
            skipped: [{ reviewer: "codex", reason: "not logged in" }],
        });
        writeReviewer("code-review", reported("code-review", []));

        const report = await collected();

        expect(report.reviewers).toEqual([
            expect.objectContaining({ reviewer: "code-review", outcome: "reported" }),
            { reviewer: "codex", outcome: "skipped", reason: "not logged in", required: false },
        ]);
    });
});

describe("collect: required reviewers (spec, The plugin's own reviewers are required)", () => {
    it("Required reviewer fails: the walkthrough wrote nothing", async () => {
        writePlan([row("walkthrough"), row("code-review")]);
        writeReviewer(
            "code-review",
            reported("code-review", [finding("Missing await on save", "important")]),
        );

        const report = await collected();

        expect(outcomeOf(report, "walkthrough")).toMatchObject({
            outcome: "failed",
            required: true,
            reason: "ended without writing its output (reviewers/walkthrough.json)",
        });
        expect(report.errors).toEqual([
            "the required reviewer walkthrough failed: ended without writing its output (reviewers/walkthrough.json)",
        ]);
        expect(report.findings).toHaveLength(1);
    });

    it("fails a required reviewer whose file is invalid or skipped", async () => {
        writePlan([row("walkthrough"), row("tests-lens")]);
        writeReviewer("walkthrough", reported("walkthrough", [finding("A", "important")]));
        writeReviewer("tests-lens", {
            schema: "autonomous.finding.v1",
            reviewer: "tests-lens",
            outcome: "skipped",
            reason: "gave up",
        });

        const report = await collected();

        expect(report.reviewers.map((entry) => entry.outcome)).toEqual(["failed", "failed"]);
        expect(report.errors).toEqual([
            expect.stringMatching(
                /^the required reviewer walkthrough failed: wrote reviewers\/walkthrough\.json, which failed validation: .*nativeSeverity "important"/,
            ),
            "the required reviewer tests-lens failed: gave up",
        ]);
    });
});

describe("collect: the tree and HEAD (spec, The review team only reports)", () => {
    beforeEach(() => {
        writePlan([row("codex")]);
        writeReviewer("codex", reported("codex", []));
    });

    it("A review ends: tree and HEAD unchanged, no error", async () => {
        expect((await collected()).errors).toEqual([]);
    });

    it("reports a changed working tree, saying which lines changed", async () => {
        writeFileSync(join(repo, "src/a.ts"), "export const a = 2;\n");

        const report = await collected();

        expect(report.errors).toEqual([
            'the working tree changed since the plan (git status --porcelain: now " M src/a.ts")',
        ]);
    });

    it("reports a file created after the plan when the configuration hides untracked files", async () => {
        run("config", "status.showUntrackedFiles", "no");
        writeFileSync(join(repo, "src/new.ts"), "export const fresh = 1;\n");

        const report = await collected();

        expect(report.errors).toEqual([
            'the working tree changed since the plan (git status --porcelain: now "?? src/new.ts")',
        ]);
    });

    describe("with the report directory inside the repository", () => {
        // git names the repository by its real path, so the directory is made under that.
        beforeEach(() => {
            dir = join(realpathSync(repo), "review-out");
            mkdirSync(join(dir, "reviewers"), { recursive: true });
            writePlan([row("codex")]);
            writeReviewer("codex", reported("codex", []));
        });

        it("does not count the directory, nor what the collection writes in it, as a change", async () => {
            const report = await collected();

            expect(report.errors).toEqual([]);
            expect(readFileSync(join(dir, "report.json"), "utf8")).toContain(
                "autonomous.review-report",
            );
        });

        it("still reports a change outside it", async () => {
            writeFileSync(join(repo, "src/a.ts"), "export const a = 2;\n");

            const report = await collected();

            expect(report.errors).toEqual([
                'the working tree changed since the plan (git status --porcelain: now " M src/a.ts")',
            ]);
        });
    });

    describe("with a tree already dirty at plan time", () => {
        // The plan records the tree as it is now, as `plan` does.
        beforeEach(async () => {
            writeFileSync(join(repo, "src/a.ts"), "export const a = 2;\n");
            writeFileSync(join(repo, "src/new.ts"), "export const fresh = 1;\n");
            writePlan([row("codex")], {
                status: valueOf(await gitStatus(git)),
                fingerprint: valueOf(await treeFingerprint(git)),
            });
        });

        it("reports nothing when the tree is left as it was", async () => {
            expect((await collected()).errors).toEqual([]);
        });

        it("reports a re-edit of a file already modified, which git status does not show", async () => {
            writeFileSync(join(repo, "src/a.ts"), "export const a = 3;\n");

            const report = await collected();

            expect(report.errors).toEqual([
                "the contents of the working tree changed since the plan",
            ]);
        });

        it("reports a re-edit of an untracked file that existed at plan time", async () => {
            writeFileSync(join(repo, "src/new.ts"), "export const fresh = 2;\n");

            const report = await collected();

            expect(report.errors).toEqual([
                "the contents of the working tree changed since the plan",
            ]);
        });

        it("reports a change the status shows once, by its status lines", async () => {
            writeFileSync(join(repo, "src/other.ts"), "export const other = 1;\n");

            const report = await collected();

            expect(report.errors).toEqual([
                'the working tree changed since the plan (git status --porcelain: now "?? src/other.ts")',
            ]);
        });
    });

    it("reports a moved HEAD, naming both commits", async () => {
        commit("src/b.ts", "export const b = 1;\n");
        const moved = await revParse("HEAD");

        const report = await collected();

        expect(report.errors).toEqual([`HEAD moved since the plan, from ${head} to ${moved}`]);
    });
});

describe("collect: the report files", () => {
    it("writes a report.json that parses as a review report, and report.md", async () => {
        writePlan([row("walkthrough"), row("codex")], {
            skipped: [{ reviewer: "coderabbit", reason: "not logged in" }],
        });
        writeFileSync(
            join(dir, "walkthrough.json"),
            JSON.stringify({ title: "T", intent: "I.", sections: [], unplacedFiles: ["src/a.ts"] }),
        );
        writeReviewer("walkthrough", reported("walkthrough", [doubt("Why?")]));
        writeReviewer("codex", reported("codex", [finding("Missing await on save", "P1")]));

        const report = await collected();

        const written: unknown = JSON.parse(readFileSync(join(dir, "report.json"), "utf8"));
        expect(parseReport(written)).toEqual({ ok: true, value: report });
        expect(readFileSync(join(dir, "report.md"), "utf8")).toContain("Missing await on save");
        expect(report.walkthrough).toEqual({
            guide: "walkthrough.json",
            patch: "walkthrough.patch",
            html: "walkthrough.html",
        });
        expect(calls).toEqual(["plannotator guide export"]);
    });

    it("names no absolute path and not the home directory", async () => {
        writePlan([row("walkthrough"), row("codex")]);
        writeReviewer("codex", {
            schema: "autonomous.finding.v1",
            reviewer: "codex",
            outcome: "skipped",
            reason: `exit 1, see ${join(dir, "raw", "codex.stderr.txt")} and ${join(homedir(), ".codex")}`,
        });
        writeReviewer("walkthrough", "{");

        const report = await collected();

        expect(outcomeOf(report, "codex")?.reason).toBe(
            "exit 1, see raw/codex.stderr.txt and ~/.codex",
        );

        for (const name of ["report.json", "report.md"]) {
            const text = readFileSync(join(dir, name), "utf8");
            for (const absolute of [dir, repo, tmpdir(), homedir()]) {
                expect(text, name).not.toContain(absolute);
            }
        }
    });

    it("carries a reviewer's dropped entries into report.json and report.md", async () => {
        writePlan([row("walkthrough"), row("codex")]);
        const dropped = [
            {
                entry: "- [P1] Await the write — /home/someone/else/src/a.ts:13-13",
                reason: "/home/someone/else/src/a.ts is not inside the repository",
            },
        ];
        writeReviewer(
            "codex",
            reported("codex", [finding("Missing await on save", "P1")], { dropped }),
        );

        const report = await collected();

        expect(outcomeOf(report, "codex")).toMatchObject({ outcome: "reported", dropped });
        expect(report.findings.map((entry) => entry.id)).toEqual(["codex-1"]);
        const written = JSON.parse(readFileSync(join(dir, "report.json"), "utf8")) as Report;
        expect(outcomeOf(written, "codex")?.dropped).toEqual(dropped);
        expect(parseReport(written)).toEqual({ ok: true, value: report });
        expect(readFileSync(join(dir, "report.md"), "utf8")).toContain(
            `  - dropped "${dropped[0]?.entry}": ${dropped[0]?.reason}`,
        );
    });

    it("leaves dropped off the outcome of a reviewer that dropped nothing", async () => {
        writePlan([row("walkthrough"), row("codex")]);
        writeReviewer("codex", reported("codex", [finding("Missing await on save", "P1")]));

        const report = await collected();

        expect(outcomeOf(report, "codex")).not.toHaveProperty("dropped");
    });

    it("Doubt without a label: the report lists the doubt with label question", async () => {
        writePlan([row("walkthrough")]);
        const { label: _label, ...unlabelled } = doubt("Why?");
        writeFileSync(join(dir, "walkthrough.json"), "{}");
        writeReviewer("walkthrough", reported("walkthrough", [unlabelled]));

        const report = await collected();

        expect(report.doubts).toMatchObject([{ id: "walkthrough-1", label: "question" }]);
        expect(readFileSync(join(dir, "report.md"), "utf8")).toContain("Why?");
    });

    it("Plannotator missing: no guide, and the walkthrough's findings still count", async () => {
        writePlan([row("walkthrough")], {
            guide: { available: false, reason: "plannotator CLI not found on PATH" },
        });
        writeFileSync(join(dir, "walkthrough.json"), "{}");
        writeReviewer(
            "walkthrough",
            reported("walkthrough", [finding("Comment says five retries", "WARNING")]),
        );

        const report = await collected();

        expect(report.walkthrough).toEqual({
            guide: null,
            reason: "Plannotator is not available (plannotator CLI not found on PATH)",
        });
        expect(report.findings.map((entry) => entry.id)).toEqual(["walkthrough-1"]);
        expect(calls).toEqual([]);
    });

    it("returns an error, and writes nothing, when the plan cannot be read", async () => {
        const result = await collect(dir, deps());

        expect(result.ok ? "" : result.error).toMatch(/^reading plan\.json: /);
    });

    it("returns an error for a plan that fails validation", async () => {
        writeFileSync(
            join(dir, "plan.json"),
            JSON.stringify({ schema: "autonomous.review-plan.v1" }),
        );

        const result = await collect(dir, deps());

        expect(result).toEqual({
            ok: false,
            error: "plan.json is not valid: $.createdAt must be a string",
        });
    });
});
