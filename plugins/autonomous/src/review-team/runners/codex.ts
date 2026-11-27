// The Codex runner and the parser of its text (spec review-team, "The finding schema", "Output is
// validated at run time" and "A reviewer that cannot run is skipped and recorded"; design D4 and
// D8). `codex exec review` ignores `--output-schema`, so its last message is text of a fixed form:
// a summary, then entries `- [P<n>] <title> — <absolute path>:<start>-<end>`, each followed by an
// indented paragraph. A line that opens an entry and does not fit the form makes the whole text
// unreadable, so no entry of a half-understood review is reported. The one exception is a path
// outside the repository: that is the model's mistake, not a format change, so that entry alone
// is dropped and recorded (design D15).

import { mkdir, readFile, rm } from "node:fs/promises";
import { isAbsolute, join, sep } from "node:path";

import type { ExecResult } from "../../exec.ts";
import type { Result } from "../../result.ts";
import { hideMachinePaths } from "../report.ts";
import { SEVERITY_TABLES } from "../severity.ts";
import { insideRepository } from "../subject.ts";
import type { DroppedEntry, RawFinding, RawItem, ReviewerFile } from "../types.ts";
import {
    messageOf,
    REVIEW_TIMEOUT_MS,
    type RunContext,
    runTimed,
    saveOutput,
    saveVersion,
    type Verdict,
    withStatement,
} from "./shared.ts";

const LAST_MESSAGE = "codex.last-message.txt";

const ENTRY_START = "- [";
// An absolute path may hold " — ", which the greedy ENTRY would split at. This one ends the title
// at the first " — " that an absolute path (POSIX, or a Windows drive) follows, so the path stays
// whole. ENTRY is the fallback, which a relative path still reaches and is then dropped alone.
const ABSOLUTE_ENTRY = /^- \[(P\d+)\] (\S.*?) — ((?:\/|[A-Za-z]:[\\/]).+):(\d+)-(\d+)\s*$/;
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

function paragraphOf(body: string[]): { statement: string; evidence: string } {
    const indented = body.filter((line) => line.trim() !== "");
    const indent = Math.min(...indented.map((line) => line.length - line.trimStart().length));
    return withStatement(
        body
            .map((line) => line.slice(indent).trimEnd())
            .join("\n")
            .trim(),
    );
}

// The path relative to the repository, or undefined when it is not inside it.
function repositoryPath(path: string, repoRoot: string): string | undefined {
    const inside = isAbsolute(path) ? insideRepository(repoRoot, path) : undefined;
    // Only Windows separates with `\`; on POSIX it is part of a file name.
    return inside?.split(sep).join("/");
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
    const match = ABSOLUTE_ENTRY.exec(header) ?? ENTRY.exec(header);
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
    // The finding schema takes forward slashes only, so a POSIX name holding `\` cannot be named:
    // this entry alone is dropped (D15).
    if (file.includes("\\")) {
        return {
            dropped: {
                entry: hideMachinePaths(entry.header),
                reason: `${file} holds a backslash, which a finding's path cannot`,
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
        return { ok: false, error: messageOf(error) };
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
    } catch (error) {
        // Only a missing file is no message; runTimed records any other cause.
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return "";
        }
        throw error;
    }
}

function verdictOfMessage(ctx: RunContext, text: string): Verdict {
    if (text.trim() === "") {
        return { skip: `codex wrote no last message to raw/${LAST_MESSAGE}` };
    }
    const parsed = parseCodexReview(text, ctx.repoRoot);
    return parsed.ok
        ? { items: parsed.value.items, dropped: parsed.value.dropped }
        : { skip: `codex output could not be read: ${parsed.error}` };
}

async function review(ctx: RunContext): Promise<Verdict> {
    await mkdir(join(ctx.dir, "raw"), { recursive: true });
    await saveVersion(ctx, "codex");
    // A message left by an earlier run must not pass for this one's.
    const lastMessage = join(ctx.dir, "raw", LAST_MESSAGE);
    await rm(lastMessage, { force: true });
    const result = await ctx.exec("codex", REVIEW_TIMEOUT_MS, { keepOutputOnExit: true })(
        codexArguments(ctx, lastMessage),
    );
    await saveOutput(ctx.dir, "codex", "codex.stdout.txt", result);
    return result.ok
        ? verdictOfMessage(ctx, await readLastMessage(lastMessage))
        : verdictOfFailure(result);
}

export function runCodex(ctx: RunContext): Promise<ReviewerFile> {
    return runTimed(ctx, "codex", () => review(ctx));
}
