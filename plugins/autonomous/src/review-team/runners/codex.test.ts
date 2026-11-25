import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
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

// What `codex exec review` does in a fake: write `message` where `-o` points, and answer `review`.
interface Fake {
    review?: ExecResult;
    message?: string;
    // Makes the last-message path a directory, which reads as EISDIR, not as a missing file.
    unreadable?: boolean;
    engine?: Engine;
}

function setup({
    review = { ok: true, stdout: "" },
    message,
    unreadable = false,
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
                if (unreadable && output !== undefined) {
                    await mkdir(output);
                } else if (message !== undefined && output !== undefined) {
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

    it("names the cause when the last message exists but cannot be read", async () => {
        const { ctx } = setup({ unreadable: true });

        const reason = skippedReason(await runCodex(ctx));

        expect(reason).toMatch(/^codex runner failed: .*EISDIR/);
        expect(reason).not.toContain("wrote no last message");
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

    it("Codex entry outside the repository: the other entry is reported, this one is dropped", async () => {
        const outside = "/home/someone/else/src/a.ts";
        const message = `Summary.\n\n${entry(`${ROOT}/src/b.ts`)}\n\n${entry(outside)}`;
        const { ctx } = setup({ message });

        const file = await runCodex(ctx);

        expect(parseReviewerFile(file)).toEqual({ ok: true, value: file });
        expect(file).toMatchObject({ outcome: "reported" });
        expect(file.outcome === "reported" && file.items).toHaveLength(1);
        expect(file.outcome === "reported" && file.dropped).toEqual([
            {
                entry: `- [P1] Await the write — ${outside}:13-13`,
                reason: `${outside} is not inside the repository`,
            },
        ]);
    });

    it.skipIf(process.platform === "win32")(
        "reports the other entry when one path holds a backslash",
        async () => {
            const message = `${entry(`${ROOT}/src/a.ts`)}\n\n${entry(`${ROOT}/src/we\\ird.ts`)}`;
            const { ctx } = setup({ message });

            const file = await runCodex(ctx);

            expect(parseReviewerFile(file)).toEqual({ ok: true, value: file });
            expect(file).toMatchObject({ outcome: "reported" });
            expect(
                file.outcome === "reported" &&
                    file.items.map((item) => item.location.scope === "line" && item.location.file),
            ).toEqual(["src/a.ts"]);
            expect(file.outcome === "reported" && file.dropped).toEqual([
                {
                    entry: "- [P1] Await the write — $TMPDIR/throwaway/src/we\\ird.ts:13-13",
                    reason: "src/we\\ird.ts holds a backslash, which a finding's path cannot",
                },
            ]);
        },
    );

    it("writes no dropped list when no entry was dropped", async () => {
        const { ctx } = setup({ message: MESSAGE });

        const file = await runCodex(ctx);

        expect(file).not.toHaveProperty("dropped");
    });

    it("quotes a dropped entry's path with the home directory as ~", async () => {
        const { ctx } = setup({ message: entry(join(homedir(), "elsewhere", "a.ts")) });

        const file = await runCodex(ctx);

        expect(file.outcome === "reported" && file.dropped).toEqual([
            {
                entry: "- [P1] Await the write — ~/elsewhere/a.ts:13-13",
                reason: "~/elsewhere/a.ts is not inside the repository",
            },
        ]);
    });

    it("quotes a dropped entry's path under the temp directory with $TMPDIR", async () => {
        const paths = [
            join(tmpdir(), "scratchpad", "wt", "pr-94", "a.ts"),
            "/private/tmp/claude-501/-Users-someone-project/wt/pr-94/a.ts",
            "/home/someone/tmp/a.ts",
        ];
        const { ctx } = setup({ message: paths.map((path) => entry(path)).join("\n\n") });

        const file = await runCodex(ctx);

        expect(file.outcome === "reported" && file.dropped?.map((entry) => entry.reason)).toEqual([
            "$TMPDIR/scratchpad/wt/pr-94/a.ts is not inside the repository",
            "$TMPDIR/claude-501/-Users-someone-project/wt/pr-94/a.ts is not inside the repository",
            "/home/someone/tmp/a.ts is not inside the repository",
        ]);
    });

    it("still skips Codex when an entry that does not fit the form sits beside a dropped one", async () => {
        const message = `${entry("/home/someone/else/a.ts")}\n\n- [P1] no location here\n  Text.`;
        const { ctx } = setup({ message });

        const reason = skippedReason(await runCodex(ctx));

        expect(reason).toMatch(/^codex output could not be read/);
        expect(reason).toContain('"- [P1] no location here"');
    });

    it("still skips Codex for an entry outside the repository that has no paragraph", async () => {
        const { ctx } = setup({ message: "- [P1] T — /home/someone/else/a.ts:1-1\n" });

        expect(skippedReason(await runCodex(ctx))).toContain("the entry has no paragraph");
    });
});

describe("parseCodexReview", () => {
    const parse = (text: string) => parseCodexReview(text, ROOT);

    it("labels P0 to P2 as issues and P3 as a suggestion", () => {
        const text = ["P0", "P1", "P2", "P3"]
            .map((priority) => `- [${priority}] T — ${ROOT}/a.ts:1-2\n  Text.`)
            .join("\n\n");

        const result = parse(text);

        expect(result.ok && result.value.items.map((item) => item.label)).toEqual([
            "issue",
            "issue",
            "issue",
            "suggestion",
        ]);
    });

    it("keeps an em dash inside the title and splits at the last one", () => {
        const result = parse(`- [P2] Slow — and wrong — ${ROOT}/src/a.ts:4-9\n  Text.`);

        expect(result.ok && result.value.items[0]?.title).toBe("Slow — and wrong");
    });

    it("keeps a path that holds an em dash whole", () => {
        const result = parse(`- [P1] T — ${ROOT}/src/a — b.ts:1-1\n  Text.`);

        expect(result.ok && result.value.items[0]).toMatchObject({
            title: "T",
            location: { file: "src/a — b.ts" },
        });
    });

    it("keeps an em dash in the title when the path holds one too", () => {
        const result = parse(`- [P1] Slow — wrong — ${ROOT}/src/a — b.ts:1-1\n  Text.`);

        expect(result.ok && result.value.items[0]).toMatchObject({
            title: "Slow — wrong",
            location: { file: "src/a — b.ts" },
        });
    });

    it.skipIf(process.platform === "win32")(
        "drops an entry whose POSIX name holds a backslash",
        () => {
            const header = `- [P1] T — ${ROOT}/src/we\\ird.ts:1-1`;
            const result = parse(`${header}\n  Text.`);

            expect(result).toEqual({
                ok: true,
                value: {
                    items: [],
                    dropped: [
                        {
                            entry: header.replace(ROOT, "$TMPDIR/throwaway"),
                            reason: "src/we\\ird.ts holds a backslash, which a finding's path cannot",
                        },
                    ],
                },
            });
        },
    );

    it("keeps a directory whose name starts with two dots and drops a parent climb", () => {
        const kept = parse(`- [P1] T — ${ROOT}/..fixtures/a.ts:1-1\n  Text.`);
        const climbed = parse(`- [P1] T — ${ROOT}/../a.ts:1-1\n  Text.`);

        expect(kept.ok && kept.value.items[0]).toMatchObject({
            location: { file: "..fixtures/a.ts" },
        });
        expect(climbed.ok && climbed.value.items).toEqual([]);
        expect(climbed.ok && climbed.value.dropped).toHaveLength(1);
    });

    it("takes the first paragraph as the statement and all of them as the evidence", () => {
        const result = parse(`- [P2] T — ${ROOT}/a.ts:1-1\n  One.\n  Two.\n\n  Three.`);

        const item = result.ok ? result.value.items[0] : undefined;
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

    it("drops an entry whose path is relative or climbs out of the repository", () => {
        for (const [path, shown] of [
            ["src/a.ts", "src/a.ts"],
            [`${ROOT}/../other/a.ts`, "$TMPDIR/throwaway/../other/a.ts"],
            ["/srv/throwaway-other/a.ts", "/srv/throwaway-other/a.ts"],
        ] as const) {
            const result = parse(`- [P1] T — ${path}:1-1\n  Text.`);

            expect(result).toEqual({
                ok: true,
                value: {
                    items: [],
                    dropped: [
                        {
                            entry: `- [P1] T — ${shown}:1-1`,
                            reason: `${shown} is not inside the repository`,
                        },
                    ],
                },
            });
        }
    });

    it("keeps the entries inside the repository and lists the dropped ones apart", () => {
        const result = parse(
            [`${ROOT}/a.ts`, "/elsewhere/b.ts", `${ROOT}/c.ts`]
                .map((path) => `- [P2] T — ${path}:1-1\n  Text.`)
                .join("\n\n"),
        );

        expect(result.ok && result.value.items.map((item) => item.location)).toEqual([
            { scope: "line", file: "a.ts", startLine: 1, endLine: 1, side: "new" },
            { scope: "line", file: "c.ts", startLine: 1, endLine: 1, side: "new" },
        ]);
        expect(result.ok && result.value.dropped).toHaveLength(1);
    });
});
