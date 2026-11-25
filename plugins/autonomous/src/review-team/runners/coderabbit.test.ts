import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { Exec, ExecResult } from "../../exec.ts";
import { temporaryDirectories } from "../../stages/test-fixtures.ts";
import { parseReviewerFile } from "../schema.ts";
import { PLAN_SCHEMA, type Plan, type ReviewerFile } from "../types.ts";
import { runCoderabbit } from "./coderabbit.ts";
import type { RunContext } from "./shared.ts";

const directories = temporaryDirectories("review-coderabbit");
afterEach(() => directories.removeAll());

const fixture = (name: string) =>
    readFileSync(new URL(`../fixtures/coderabbit/${name}`, import.meta.url), "utf8");
const STREAM = fixture("review.stdout.ndjson");
const VERSION = fixture("version.txt");

const MERGE_BASE = "ba801007110b7afa68112272e531e44a02caa8d5";

const PLAN: Plan = {
    schema: PLAN_SCHEMA,
    createdAt: "2026-11-22T10:00:00.000Z",
    subject: {
        repo: "throwaway",
        branch: "feature/add-save",
        base: "main",
        baseSource: "given",
        mergeBase: MERGE_BASE,
        head: "f".repeat(40),
        dirty: false,
    },
    status: "",
    fingerprint: "0".repeat(64),
    measure: { lines: 40, files: 1 },
    tier: { measured: "S", used: "S" },
    security: { triggered: false, matches: [] },
    team: [],
    skipped: [],
    guide: { available: false },
};

interface Call {
    command: string;
    timeoutMs: number;
    keepOutputOnExit?: boolean;
    args: string[];
}

// A `coderabbit` that answers `--version` with the recorded version and `review` with `review`.
function setup(review: ExecResult | (() => Promise<ExecResult>)): {
    ctx: RunContext;
    calls: Call[];
} {
    const calls: Call[] = [];
    let clock = 1_000;
    const ctx: RunContext = {
        exec:
            (command, timeoutMs, options): Exec =>
            async (args) => {
                calls.push({
                    command,
                    timeoutMs,
                    keepOutputOnExit: options?.keepOutputOnExit,
                    args,
                });
                if (args[0] === "--version") {
                    return { ok: true, stdout: VERSION };
                }
                return typeof review === "function" ? review() : review;
            },
        dir: directories.make("report"),
        plan: PLAN,
        row: {
            reviewer: "coderabbit",
            angle: "second opinion",
            kind: "cli",
            required: false,
            engine: { tool: "coderabbit", version: "0.9.5" },
            output: "reviewers/coderabbit.json",
        },
        now: () => (clock += 250),
    };
    return { ctx, calls };
}

const ok = (stdout: string): ExecResult => ({ ok: true, stdout });

function skippedReason(file: ReviewerFile): string {
    if (file.outcome !== "skipped") {
        throw new Error(`expected a skipped file, got ${JSON.stringify(file)}`);
    }
    return file.reason;
}

function line(value: object): string {
    return `${JSON.stringify(value)}\n`;
}

const FINDING = {
    type: "finding",
    severity: "minor",
    fileName: "src/a.ts",
    title: "Name the constant.",
    comment: "**Name the constant.**\n\nThe literal 7 has no name.",
    startLine: 3,
    endLine: 4,
    suggestions: [],
};
const COMPLETE = {
    type: "complete",
    status: "review_completed",
    findings: 1,
    outcome: "completed",
};

describe("the recorded run", () => {
    it("reports its two major findings in a file the schema accepts", async () => {
        const { ctx, calls } = setup(ok(STREAM));

        const file = await runCoderabbit(ctx);

        expect(parseReviewerFile(file)).toEqual({ ok: true, value: file });
        expect(file).toMatchObject({
            reviewer: "coderabbit",
            outcome: "reported",
            durationMs: 250,
        });
        const items = file.outcome === "reported" ? file.items : [];
        expect(
            items.map((item) => [
                item.kind === "finding" && item.nativeSeverity,
                item.location.scope === "line" && [item.location.file, item.location.startLine],
            ]),
        ).toEqual([
            ["major", ["src/store.ts", 22]],
            ["major", ["src/store.ts", 31]],
        ]);
        expect(calls.map(({ args }) => args)).toEqual([
            ["--version"],
            ["review", "--agent", "--committed", "--base-commit", MERGE_BASE],
        ]);
    });

    it("maps a finding's fields without rewording them", async () => {
        const { ctx } = setup(ok(STREAM));

        const file = await runCoderabbit(ctx);

        const [first, second] = file.outcome === "reported" ? file.items : [];
        expect(first).toEqual({
            kind: "finding",
            title: "Stop the loop before `items.length`.",
            statement:
                "The loop reaches `items[items.length]`, which is `undefined`. Reading `.quantity` then throws. This also fails for an empty array.",
            location: {
                scope: "line",
                file: "src/store.ts",
                startLine: 22,
                endLine: 22,
                side: "new",
            },
            evidence:
                "The loop reaches `items[items.length]`, which is `undefined`. Reading `.quantity` then throws. This also fails for an empty array.\n\nChange `<=` to `<`. Empty arrays will return `0`, and nonempty arrays will visit only valid elements.",
            label: "issue",
            nativeSeverity: "major",
        });
        // The second comment ends in an empty suggested-fix block: no fix, and the block is not evidence.
        expect(second).not.toHaveProperty("suggestedFix");
        const evidence = second?.kind === "finding" ? second.evidence : "";
        expect(evidence.startsWith("`removeItem` calls `save(path, next)`")).toBe(true);
        expect(evidence.endsWith("settles:")).toBe(true);
        expect(second?.title.startsWith("Await `save`")).toBe(true);
    });

    it("saves the raw files under raw/ and gives the run the review timeout", async () => {
        const { ctx, calls } = setup(ok(STREAM));

        await runCoderabbit(ctx);

        const raw = (name: string) => readFile(join(ctx.dir, "raw", name), "utf8");
        expect(await raw("coderabbit.stdout.ndjson")).toBe(STREAM);
        expect(await raw("coderabbit.version.txt")).toBe(VERSION);
        expect(await raw("coderabbit.stderr.txt")).toBe("");
        expect(calls[1]).toMatchObject({
            command: "coderabbit",
            timeoutMs: 15 * 60 * 1000,
            keepOutputOnExit: true,
        });
    });
});

describe("what the stream holds", () => {
    it("ignores line types it does not know", async () => {
        const { ctx } = setup(
            ok(line({ type: "novel", anything: 1 }) + line(FINDING) + line(COMPLETE)),
        );

        const file = await runCoderabbit(ctx);

        expect(file).toMatchObject({ outcome: "reported" });
        expect(file.outcome === "reported" && file.items).toHaveLength(1);
    });

    it("labels anything below major a suggestion", async () => {
        const { ctx } = setup(ok(line(FINDING) + line(COMPLETE)));

        const file = await runCoderabbit(ctx);

        expect(file.outcome === "reported" && file.items[0]).toMatchObject({
            label: "suggestion",
            nativeSeverity: "minor",
        });
    });

    it("keeps a usable suggestion from its block, then from the suggestions array", async () => {
        const withBlock = {
            ...FINDING,
            comment: `${FINDING.comment}\n\n<details>\n<summary>Suggested fix</summary>\n\nuse NAMED\n\n</details>`,
        };
        const withArray = { ...FINDING, suggestions: ["use ARRAY", 7, "  "] };
        const { ctx } = setup(ok(line(withBlock) + line(withArray) + line(COMPLETE)));

        const file = await runCoderabbit(ctx);

        const items = file.outcome === "reported" ? file.items : [];
        expect(items.map((item) => item.kind === "finding" && item.suggestedFix)).toEqual([
            "use NAMED",
            "use ARRAY",
        ]);
        expect(items[0]).toMatchObject({ evidence: FINDING.comment.split("\n\n")[1] });
    });
});

describe("a reviewer that cannot be read is skipped with none of its lines", () => {
    it("skips on a line that is not JSON, quoting the error", async () => {
        const { ctx } = setup(ok(line(FINDING) + "{ not json\n" + line(COMPLETE)));

        const file = await runCoderabbit(ctx);

        expect(file.outcome).toBe("skipped");
        expect(skippedReason(file)).toMatch(
            /^coderabbit output could not be read: line 2 is not JSON: /,
        );
        expect(file).not.toHaveProperty("items");
    });

    it("skips on a finding line it cannot read", async () => {
        const broken = { ...FINDING, startLine: "three" };
        const { ctx } = setup(ok(line(FINDING) + line(broken) + line(COMPLETE)));

        const file = await runCoderabbit(ctx);

        expect(skippedReason(file)).toContain('finding on line 2 has no integer "startLine"');
    });

    it("skips on a finding the schema refuses", async () => {
        const backwards = { ...FINDING, startLine: 9, endLine: 2 };
        const { ctx } = setup(ok(line(backwards) + line(COMPLETE)));

        const file = await runCoderabbit(ctx);

        expect(skippedReason(file)).toContain(
            "coderabbit output is invalid: $.items[0].location.endLine",
        );
    });

    it("skips on an unknown severity, naming it", async () => {
        const { ctx } = setup(ok(line({ ...FINDING, severity: "catastrophic" }) + line(COMPLETE)));

        const file = await runCoderabbit(ctx);

        expect(skippedReason(file)).toContain('unknown severity "catastrophic"');
    });

    it("skips when the stream has no complete line", async () => {
        const { ctx } = setup(ok(line(FINDING)));

        const file = await runCoderabbit(ctx);

        expect(skippedReason(file)).toMatch(/without a complete line/);
    });

    it("skips on an error line, with CodeRabbit's own message", async () => {
        const message = "Rate limit exceeded. Try again in 12 minutes.";
        const { ctx } = setup(ok(line(FINDING) + line({ type: "error", message })));

        const file = await runCoderabbit(ctx);

        expect(skippedReason(file)).toBe(`coderabbit reported an error: ${message}`);
    });
});

describe("a run that fails", () => {
    it("skips on a timeout with the Exec's error", async () => {
        const { ctx } = setup({ ok: false, error: "coderabbit timed out after 900 s" });

        const file = await runCoderabbit(ctx);

        expect(skippedReason(file)).toBe("coderabbit timed out after 900 s");
        expect(file).toMatchObject({ durationMs: 250 });
    });

    it("skips when the binary is missing", async () => {
        const { ctx } = setup({ ok: false, error: "coderabbit CLI not found on PATH" });

        const file = await runCoderabbit(ctx);

        expect(skippedReason(file)).toBe("coderabbit CLI not found on PATH");
    });

    it("skips on a non-zero exit, with the error line its stdout kept", async () => {
        const stdout = line({ type: "error", message: "You are rate limited." });
        const { ctx } = setup({
            ok: false,
            error: "coderabbit failed: boom",
            exit: { code: 1, stdout },
        });

        const file = await runCoderabbit(ctx);

        expect(skippedReason(file)).toBe("coderabbit exited with code 1: You are rate limited.");
        expect(await readFile(join(ctx.dir, "raw", "coderabbit.stdout.ndjson"), "utf8")).toBe(
            stdout,
        );
        expect(await readFile(join(ctx.dir, "raw", "coderabbit.stderr.txt"), "utf8")).toBe(
            "coderabbit failed: boom",
        );
    });

    it("skips on a non-zero exit with no error line, quoting the Exec's error", async () => {
        const { ctx } = setup({
            ok: false,
            error: "coderabbit failed: not authenticated",
            exit: { code: 2, stdout: "plain text\n" },
        });

        const file = await runCoderabbit(ctx);

        expect(skippedReason(file)).toBe(
            "coderabbit exited with code 2: coderabbit failed: not authenticated",
        );
    });

    it("still resolves, as a skip, when the Exec itself throws", async () => {
        const { ctx } = setup(() => Promise.reject(new Error("spawn exploded")));

        const file = await runCoderabbit(ctx);

        expect(skippedReason(file)).toBe("coderabbit runner failed: spawn exploded");
    });
});
