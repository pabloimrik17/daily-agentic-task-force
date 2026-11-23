// The Codex runner and the parser of its text (spec review-team, "The finding schema", "Output is
// validated at run time" and "A reviewer that cannot run is skipped and recorded"; design D4 and
// D8). `codex exec review` ignores `--output-schema`, so its last message is text of a fixed form:
// a summary, then entries `- [P<n>] <title> — <absolute path>:<start>-<end>`, each followed by an
// indented paragraph. A line that opens an entry and does not fit the form makes the whole text
// unreadable, so no entry of a half-understood review is reported. The one exception is a path
// outside the repository: that is the model's mistake, not a format change, so that entry alone
// is dropped and recorded (design D15).

import { mkdir, readFile, rm } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";

import type { ExecResult } from "../../exec.ts";
import type { Result } from "../../result.ts";
import { hideMachinePaths } from "../report.ts";
import { SEVERITY_TABLES } from "../severity.ts";
import type { DroppedEntry, RawFinding, RawItem, ReviewerFile } from "../types.ts";
import { REVIEW_TIMEOUT_MS, type RunContext, runTimed, saveRaw, type Verdict } from "./shared.ts";

const SHORT_TIMEOUT_MS = 30_000;
const LAST_MESSAGE = "codex.last-message.txt";

const ENTRY_START = "- [";
const ENTRY = /^- \[(P\d+)\] (\S.*) — (.+):(\d+)-(\d+)\s*$/;
const PRIORITIES = Object.keys(SEVERITY_TABLES.codex);

interface Entry {
    header: string;
    body: string[];
}

function continuesParagraph(line: string, entry: Entry | undefined): boolean {
    if (entry === undefined) {
        return false;
    }
    return /^\s+\S/.test(line) || (line.trim() === "" && entry.body.length > 0);
}

// The lines before the first entry are the summary; the rest split at each line that opens an
// entry. Only indented lines, and the blank ones between them, belong to an entry's paragraph.
function splitEntries(text: string): Entry[] {
    const entries: Entry[] = [];
    for (const line of text.split("\n")) {
        if (line.startsWith(ENTRY_START)) {
            entries.push({ header: line, body: [] });
        } else if (continuesParagraph(line, entries.at(-1))) {
            entries.at(-1)?.body.push(line);
        }
    }
    return entries;
}

// The same convention as the CodeRabbit runner: the evidence is the whole paragraph text and the
// statement its first paragraph.
function paragraphOf(body: string[]): { statement: string; evidence: string } {
    const indented = body.filter((line) => line.trim() !== "");
    const indent = Math.min(...indented.map((line) => line.length - line.trimStart().length));
    const evidence = body
        .map((line) => line.slice(indent).trimEnd())
        .join("\n")
        .trim();
    return { statement: evidence.split(/\n\s*\n/)[0] ?? evidence, evidence };
}

// The path relative to the repository, or undefined when it is not inside it.
function repositoryPath(path: string, repoRoot: string): string | undefined {
    const relativePath = relative(repoRoot, path);
    if (!isAbsolute(path) || relativePath.startsWith("..") || isAbsolute(relativePath)) {
        return undefined;
    }
    return relativePath.split("\\").join("/");
}

interface Header {
    priority: string;
    title: string;
    path: string;
    start: string;
    end: string;
}

// The fields of an entry's first line, or the reason the whole text is unreadable.
function readHeader({ header, body }: Entry): Header {
    const match = ENTRY.exec(header);
    if (match === null) {
        throw new Error(`the entry line does not fit the form: "${header}"`);
    }
    const [, priority = "", title = "", path = "", start = "", end = ""] = match;
    if (!PRIORITIES.includes(priority)) {
        throw new Error(
            `unknown priority ${priority} (known: ${PRIORITIES.join(", ")}) in "${header}"`,
        );
    }
    if (body.length === 0) {
        throw new Error(`the entry has no paragraph: "${header}"`);
    }
    return { priority, title, path, start, end };
}

type Parsed = { finding: RawFinding } | { dropped: DroppedEntry };

function toFinding(entry: Entry, repoRoot: string): Parsed {
    const { priority, title, path, start, end } = readHeader(entry);
    const file = repositoryPath(path, repoRoot);
    if (file === undefined) {
        // Codex's text names the machine's user through home and temp paths: hide those.
        return {
            dropped: {
                entry: hideMachinePaths(entry.header),
                reason: `${hideMachinePaths(path)} is not inside the repository`,
            },
        };
    }
    return {
        finding: {
            kind: "finding",
            title: title.trim(),
            ...paragraphOf(entry.body),
            location: {
                scope: "line",
                file,
                startLine: Number(start),
                endLine: Number(end),
                side: "new",
            },
            label: priority === "P3" ? "suggestion" : "issue",
            nativeSeverity: priority,
        },
    };
}

export interface CodexReview {
    items: RawItem[];
    dropped: DroppedEntry[];
}

// Codex's review reports no doubts. A message with no entry line is a review with no findings.
export function parseCodexReview(text: string, repoRoot: string): Result<CodexReview> {
    try {
        const parsed = splitEntries(text).map((entry) => toFinding(entry, repoRoot));
        return {
            ok: true,
            value: {
                items: parsed.flatMap((entry) => ("finding" in entry ? [entry.finding] : [])),
                dropped: parsed.flatMap((entry) => ("dropped" in entry ? [entry.dropped] : [])),
            },
        };
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return { ok: false, error: detail };
    }
}

// An Exec reports stderr only inside a failure's error, prefixed by "codex failed: ".
function lastErrorLine(error: string): string | undefined {
    const lines = error.replace(/^codex failed: /, "").split("\n");
    return lines.reverse().find((line) => line.startsWith("ERROR: "));
}

function verdictOfFailure(result: Extract<ExecResult, { ok: false }>): Verdict {
    const line = lastErrorLine(result.error);
    return { skip: line === undefined ? result.error : `codex: ${line.slice("ERROR: ".length)}` };
}

function codexArguments(ctx: RunContext, lastMessage: string): string[] {
    const { model, effort } = ctx.row.engine;
    return [
        "exec",
        "review",
        "--base",
        ctx.plan.subject.mergeBase,
        ...(model === undefined ? [] : ["-m", model]),
        ...(effort === undefined ? [] : ["-c", `model_reasoning_effort=${effort}`]),
        "-o",
        lastMessage,
        "--ephemeral",
    ];
}

async function readLastMessage(path: string): Promise<string> {
    try {
        return await readFile(path, "utf8");
    } catch {
        return "";
    }
}

async function repositoryRoot(ctx: RunContext): Promise<Result<string>> {
    const result = await ctx.exec("git", SHORT_TIMEOUT_MS)(["rev-parse", "--show-toplevel"]);
    return result.ok ? { ok: true, value: result.stdout.trim() } : result;
}

async function verdictOfMessage(ctx: RunContext, text: string): Promise<Verdict> {
    if (text.trim() === "") {
        return { skip: `codex wrote no last message to raw/${LAST_MESSAGE}` };
    }
    const root = await repositoryRoot(ctx);
    if (!root.ok) {
        return { skip: root.error };
    }
    const parsed = parseCodexReview(text, root.value);
    return parsed.ok
        ? { items: parsed.value.items, dropped: parsed.value.dropped }
        : { skip: `codex output could not be read: ${parsed.error}` };
}

async function saveVersion(ctx: RunContext): Promise<void> {
    const version = await ctx.exec("codex", SHORT_TIMEOUT_MS)(["--version"]);
    await saveRaw(ctx.dir, "codex.version.txt", version.ok ? version.stdout : version.error);
}

async function review(ctx: RunContext): Promise<Verdict> {
    await mkdir(join(ctx.dir, "raw"), { recursive: true });
    await saveVersion(ctx);
    // A message left by an earlier run must not pass for this one's.
    const lastMessage = join(ctx.dir, "raw", LAST_MESSAGE);
    await rm(lastMessage, { force: true });
    const result = await ctx.exec("codex", REVIEW_TIMEOUT_MS, { keepOutputOnExit: true })(
        codexArguments(ctx, lastMessage),
    );
    const stdout = result.ok ? result.stdout : (result.exit?.stdout ?? "");
    await saveRaw(ctx.dir, "codex.stdout.txt", stdout);
    await saveRaw(ctx.dir, "codex.stderr.txt", result.ok ? "" : result.error);
    return result.ok
        ? verdictOfMessage(ctx, await readLastMessage(lastMessage))
        : verdictOfFailure(result);
}

export function runCodex(ctx: RunContext): Promise<ReviewerFile> {
    return runTimed(ctx, "codex", () => review(ctx));
}
