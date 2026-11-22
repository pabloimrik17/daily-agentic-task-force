import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { Exec, ExecResult } from "../../exec.ts";
import { temporaryDirectories } from "../../stages/test-fixtures.ts";
import { parseReviewerFile } from "../schema.ts";
import { type Engine, PLAN_SCHEMA, type Plan, type ReviewerFile } from "../types.ts";
import { parseCodexReview, runCodex } from "./codex.ts";
import type { RunContext } from "./shared.ts";

const directories = temporaryDirectories("review-codex");
afterEach(() => directories.removeAll());

const fixture = (name: string) =>
    readFileSync(new URL(`../fixtures/codex/${name}`, import.meta.url), "utf8");
const MESSAGE = fixture("review.last-message.txt");
const VERSION = fixture("version.txt");
const UNSUPPORTED_MODEL_STDERR = fixture("unsupported-model.stderr.txt");

const ROOT = "/tmp/throwaway";
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

// What `codex exec review` does in a fake: write `message` where `-o` points, and answer `review`.
interface Fake {
    review?: ExecResult;
    message?: string;
    engine?: Engine;
}

function setup({
    review = { ok: true, stdout: "" },
    message,
    engine = { tool: "codex", version: "0.169.0" },
}: Fake = {}): { ctx: RunContext; calls: Call[] } {
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
                if (command === "git") {
                    return { ok: true, stdout: `${ROOT}\n` };
                }
                if (args[0] === "--version") {
                    return { ok: true, stdout: VERSION };
                }
                const output = args[args.indexOf("-o") + 1];
                if (message !== undefined && output !== undefined) {
                    await writeFile(output, message);
                }
                return review;
            },
        dir: directories.make("report"),
        plan: PLAN,
        row: {
            reviewer: "codex",
            angle: "second opinion",
            kind: "cli",
            required: false,
            engine,
            output: "reviewers/codex.json",
        },
        now: () => (clock += 250),
    };
    return { ctx, calls };
}

function skippedReason(file: ReviewerFile): string {
    if (file.outcome !== "skipped") {
        throw new Error(`expected a skipped file, got ${JSON.stringify(file)}`);
    }
    return file.reason;
}

const entry = (path: string, paragraph = "  It breaks.") =>
    `- [P1] Await the write — ${path}:13-13\n${paragraph}`;

describe("the recorded run", () => {
    it("reports its three P1 findings in a file the schema accepts", async () => {
        const { ctx } = setup({ message: MESSAGE });

        const file = await runCodex(ctx);

        expect(parseReviewerFile(file)).toEqual({ ok: true, value: file });
        expect(file).toMatchObject({ reviewer: "codex", outcome: "reported", durationMs: 250 });
        const items = file.outcome === "reported" ? file.items : [];
        expect(
            items.map((item) => [
                item.kind === "finding" && item.nativeSeverity,
                item.location.scope === "line" && [item.location.file, item.location.startLine],
            ]),
        ).toEqual([
            ["P1", ["src/store.ts", 13]],
            ["P1", ["src/store.ts", 20]],
            ["P1", ["src/store.ts", 29]],
        ]);
    });

    it("gives a finding the line shape, the issue label and the paragraph as its text", async () => {
        const { ctx } = setup({ message: MESSAGE });

        const file = await runCodex(ctx);

        const [first] = file.outcome === "reported" ? file.items : [];
        expect(first?.statement).toMatch(/^`writeFile` returns a promise/);
        expect(first?.evidence).toMatch(/stale data\.$/);
        expect(first).toEqual({
            kind: "finding",
            title: "Await the file write so save failures are handled",
            statement: expect.any(String) as string,
            evidence: expect.any(String) as string,
            location: {
                scope: "line",
                file: "src/store.ts",
                startLine: 13,
                endLine: 13,
                side: "new",
            },
            label: "issue",
            nativeSeverity: "P1",
        });
    });

    it("saves the version, stdout, stderr and the last message under raw/", async () => {
        const { ctx } = setup({ message: MESSAGE });

        await runCodex(ctx);

        const raw = (name: string) => readFile(join(ctx.dir, "raw", name), "utf8");
        expect(await raw("codex.version.txt")).toBe(VERSION);
        expect(await raw("codex.stdout.txt")).toBe("");
        expect(await raw("codex.stderr.txt")).toBe("");
        expect(await raw("codex.last-message.txt")).toBe(MESSAGE);
    });
});

describe("the command", () => {
    const reviewCall = (calls: Call[]) => calls.find((call) => call.args[0] === "exec");

    it("names the merge base, the output file and --ephemeral, with a model and an effort", async () => {
        const { ctx, calls } = setup({
            message: MESSAGE,
            engine: { tool: "codex", version: "0.169.0", model: "gpt-6-luna", effort: "medium" },
        });

        await runCodex(ctx);

        expect(reviewCall(calls)).toEqual({
            command: "codex",
            timeoutMs: 15 * 60 * 1000,
            keepOutputOnExit: true,
            args: [
                "exec",
                "review",
                "--base",
                MERGE_BASE,
                "-m",
                "gpt-6-luna",
                "-c",
                "model_reasoning_effort=medium",
                "-o",
                join(ctx.dir, "raw", "codex.last-message.txt"),
                "--ephemeral",
            ],
        });
    });

    it("leaves out -m and -c when the engine names neither", async () => {
        const { ctx, calls } = setup({ message: MESSAGE });

        await runCodex(ctx);

        expect(reviewCall(calls)?.args).toEqual([
            "exec",
            "review",
            "--base",
            MERGE_BASE,
            "-o",
            join(ctx.dir, "raw", "codex.last-message.txt"),
            "--ephemeral",
        ]);
    });

    it("adds -c alone for an effort and -m alone for a model", async () => {
        const effort = setup({
            message: MESSAGE,
            engine: { tool: "codex", version: "1", effort: "high" },
        });
        const model = setup({
            message: MESSAGE,
            engine: { tool: "codex", version: "1", model: "m" },
        });

        await runCodex(effort.ctx);
        await runCodex(model.ctx);

        expect(reviewCall(effort.calls)?.args).toContain("model_reasoning_effort=high");
        expect(reviewCall(effort.calls)?.args).not.toContain("-m");
        expect(reviewCall(model.calls)?.args).toContain("-m");
        expect(reviewCall(model.calls)?.args).not.toContain("-c");
    });
});

describe("a review with no entry", () => {
    it("is reported with no items", async () => {
        const { ctx } = setup({ message: "The change looks correct; I found nothing to fix.\n" });

        const file = await runCodex(ctx);

        expect(file).toMatchObject({ outcome: "reported", items: [] });
    });
});

describe("a skipped reviewer", () => {
    it("quotes the last ERROR line of a non-zero exit", async () => {
        const { ctx } = setup({
            review: {
                ok: false,
                error: `codex failed: ${UNSUPPORTED_MODEL_STDERR.trim()}`,
                exit: { code: 1, stdout: "" },
            },
        });

        const file = await runCodex(ctx);

        expect(skippedReason(file)).toBe(
            "codex: The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.",
        );
        expect(await readFile(join(ctx.dir, "raw", "codex.stderr.txt"), "utf8")).toContain(
            "model is not supported",
        );
    });

    it("quotes the Exec's error when a non-zero exit left no ERROR line", async () => {
        const { ctx } = setup({ review: { ok: false, error: "codex failed: boom" } });

        expect(skippedReason(await runCodex(ctx))).toBe("codex failed: boom");
    });

    it("quotes the Exec's error for a timeout", async () => {
        const { ctx } = setup({ review: { ok: false, error: "codex timed out after 900 s" } });

        expect(skippedReason(await runCodex(ctx))).toBe("codex timed out after 900 s");
    });

    it("quotes the Exec's error for a missing binary", async () => {
        const { ctx } = setup({ review: { ok: false, error: "codex CLI not found on PATH" } });

        expect(skippedReason(await runCodex(ctx))).toBe("codex CLI not found on PATH");
    });

    it("says so when exit 0 left no last message", async () => {
        const { ctx } = setup();

        expect(skippedReason(await runCodex(ctx))).toBe(
            "codex wrote no last message to raw/codex.last-message.txt",
        );
    });

    it("says so when the last message is empty", async () => {
        const { ctx } = setup({ message: " \n" });

        expect(skippedReason(await runCodex(ctx))).toContain("no last message");
    });

    it("does not take a message left by an earlier run for this one's", async () => {
        const { ctx } = setup();
        await mkdir(join(ctx.dir, "raw"), { recursive: true });
        await writeFile(join(ctx.dir, "raw", "codex.last-message.txt"), MESSAGE);

        expect(skippedReason(await runCodex(ctx))).toContain("no last message");
    });

    it("quotes the offending line of a malformed entry and reports none of the others", async () => {
        const message = `Summary.\n\n${MESSAGE.split("\n\n")[1]}\n- [P1] no location here\n  Text.`;
        const { ctx } = setup({ message });

        const reason = skippedReason(await runCodex(ctx));

        expect(reason).toContain('"- [P1] no location here"');
        expect(reason).toMatch(/^codex output could not be read/);
    });

    it("names the path of an entry outside the repository", async () => {
        const { ctx } = setup({ message: entry("/home/someone/else/src/a.ts") });

        const reason = skippedReason(await runCodex(ctx));

        expect(reason).toContain("/home/someone/else/src/a.ts is not inside the repository");
    });
});

describe("parseCodexReview", () => {
    const parse = (text: string) => parseCodexReview(text, ROOT);

    it("labels P0 to P2 as issues and P3 as a suggestion", () => {
        const text = ["P0", "P1", "P2", "P3"]
            .map((priority) => `- [${priority}] T — ${ROOT}/a.ts:1-2\n  Text.`)
            .join("\n\n");

        const result = parse(text);

        expect(result.ok && result.value.map((item) => item.label)).toEqual([
            "issue",
            "issue",
            "issue",
            "suggestion",
        ]);
    });

    it("keeps an em dash inside the title and splits at the last one", () => {
        const result = parse(`- [P2] Slow — and wrong — ${ROOT}/src/a.ts:4-9\n  Text.`);

        expect(result.ok && result.value[0]?.title).toBe("Slow — and wrong");
    });

    it("takes the first paragraph as the statement and all of them as the evidence", () => {
        const result = parse(`- [P2] T — ${ROOT}/a.ts:1-1\n  One.\n  Two.\n\n  Three.`);

        const item = result.ok ? result.value[0] : undefined;
        expect(item).toMatchObject({ statement: "One.\nTwo.", evidence: "One.\nTwo.\n\nThree." });
    });

    it("refuses an entry with no paragraph", () => {
        expect(parse(`- [P1] T — ${ROOT}/a.ts:1-1\n`)).toEqual({
            ok: false,
            error: `the entry has no paragraph: "- [P1] T — ${ROOT}/a.ts:1-1"`,
        });
    });

    it("refuses an unknown priority", () => {
        const result = parse(`- [P9] T — ${ROOT}/a.ts:1-1\n  Text.`);

        expect(result.ok === false && result.error).toContain("unknown priority P9");
    });

    it("refuses a relative path and a path that climbs out of the repository", () => {
        for (const path of ["src/a.ts", `${ROOT}/../other/a.ts`, "/tmp/throwaway-other/a.ts"]) {
            const result = parse(`- [P1] T — ${path}:1-1\n  Text.`);

            expect(result.ok === false && result.error).toContain("is not inside the repository");
        }
    });
});
