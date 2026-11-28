// The CodeRabbit runner (spec review-team, "Output is validated at run time", "A reviewer that
// cannot run is skipped and recorded" and "Severity comes from fixed tables"; design D7 and D8).
// `coderabbit review --agent` prints one JSON object per line; each `finding` line becomes a
// finding verbatim, and anything the parser cannot read skips the reviewer with the error as its
// reason, so no line of a half-understood run is reported.

import type { ExecResult } from "../../exec.ts";
import { SEVERITY_TABLES } from "../severity.ts";
import type { RawFinding, ReviewerFile } from "../types.ts";
import { REVIEW_TIMEOUT_MS, type RunContext, runTimed, saveRaw, type Verdict } from "./shared.ts";

const VERSION_TIMEOUT_MS = 30_000;

// The line types seen in the recorded `--agent` stream are `review_context`,
// `status`, `heartbeat`, `finding` and `complete`. How a rate limit is worded is unknown, so any
// `error` line is a skip, quoting its message.
type Line = Record<string, unknown>;
interface Numbered {
    number: number;
    line: Line;
}

const SEVERITIES = Object.keys(SEVERITY_TABLES.coderabbit);
const ISSUE_SEVERITIES = new Set(["critical", "major"]);
const SUGGESTED_FIX = /<details>\s*<summary>\s*Suggested fix\s*<\/summary>([\s\S]*?)<\/details>/i;

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function readLines(stdout: string): Numbered[] {
    return stdout.split("\n").flatMap((text, index) => {
        if (text.trim() === "") {
            return [];
        }
        const number = index + 1;
        let value: unknown;
        try {
            value = JSON.parse(text);
        } catch (error) {
            throw new Error(`line ${number} is not JSON: ${messageOf(error)}`, { cause: error });
        }
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
            throw new Error(`line ${number} is not a JSON object`);
        }
        return [{ number, line: value as Line }];
    });
}

function requiredString(entry: Numbered, key: string): string {
    const value = entry.line[key];
    if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`finding on line ${entry.number} has no "${key}" string`);
    }
    return value;
}

function requiredLine(entry: Numbered, key: string): number {
    const value = entry.line[key];
    if (typeof value !== "number" || !Number.isInteger(value)) {
        throw new Error(`finding on line ${entry.number} has no integer "${key}"`);
    }
    return value;
}

// The comment opens with its own title as a bold line; it is dropped as the repeat it is. The
// statement is the first paragraph, the evidence is everything CodeRabbit wrote after the title,
// and the suggested-fix block moves to `suggestedFix`.
function splitComment(title: string, comment: string): { statement: string; evidence: string } {
    const [first = "", ...rest] = comment.trim().split("\n");
    const body = (first.trim() === `**${title}**` ? rest.join("\n") : comment).trim();
    const evidence = body === "" ? title : body;
    return { statement: evidence.split(/\n\s*\n/)[0]?.trim() ?? evidence, evidence };
}

function suggestionStrings(line: Line): string[] {
    const suggestions = Array.isArray(line.suggestions) ? line.suggestions : [];
    return suggestions.filter((entry): entry is string => typeof entry === "string");
}

function suggestedFix(comment: string, line: Line): string | undefined {
    const fromBlock = SUGGESTED_FIX.exec(comment)?.[1]?.trim() ?? "";
    const text = fromBlock === "" ? suggestionStrings(line).join("\n\n").trim() : fromBlock;
    return text === "" ? undefined : text;
}

function toFinding(entry: Numbered): RawFinding {
    const severity = requiredString(entry, "severity");
    if (!SEVERITIES.includes(severity)) {
        throw new Error(
            `finding on line ${entry.number} has unknown severity ${JSON.stringify(severity)} (known: ${SEVERITIES.join(", ")})`,
        );
    }
    const title = requiredString(entry, "title");
    const comment = requiredString(entry, "comment");
    const { statement, evidence } = splitComment(title, comment.replace(SUGGESTED_FIX, ""));
    const fix = suggestedFix(comment, entry.line);
    return {
        kind: "finding",
        title,
        statement,
        location: {
            scope: "line",
            file: requiredString(entry, "fileName"),
            startLine: requiredLine(entry, "startLine"),
            endLine: requiredLine(entry, "endLine"),
            side: "new",
        },
        evidence,
        label: ISSUE_SEVERITIES.has(severity) ? "issue" : "suggestion",
        nativeSeverity: severity,
        ...(fix === undefined ? {} : { suggestedFix: fix }),
    };
}

function lineMessage(line: Line): string {
    for (const key of ["message", "error"]) {
        const value = line[key];
        if (typeof value === "string" && value.trim() !== "") {
            return value.trim();
        }
    }
    return JSON.stringify(line);
}

function readStream(stdout: string): Verdict {
    const lines = readLines(stdout);
    const failed = lines.find(({ line }) => line.type === "error");
    if (failed !== undefined) {
        return { skip: `coderabbit reported an error: ${lineMessage(failed.line)}` };
    }
    if (!lines.some(({ line }) => line.type === "complete")) {
        return { skip: "coderabbit ended without a complete line, so its output is partial" };
    }
    return {
        items: lines.filter(({ line }) => line.type === "finding").map(toFinding),
    };
}

function verdictOfOutput(stdout: string): Verdict {
    try {
        return readStream(stdout);
    } catch (error) {
        return { skip: `coderabbit output could not be read: ${messageOf(error)}` };
    }
}

// The message of a failed run's last `error` line, when its stdout was kept and has one.
function lastErrorMessage(stdout: string): string | undefined {
    const messages = stdout.split("\n").flatMap((text) => {
        try {
            const line = JSON.parse(text) as Line | null;
            return line?.type === "error" ? [lineMessage(line)] : [];
        } catch {
            return [];
        }
    });
    return messages.at(-1);
}

function verdictOfFailure(result: Extract<ExecResult, { ok: false }>): Verdict {
    if (result.exit === undefined) {
        return { skip: result.error };
    }
    const detail = lastErrorMessage(result.exit.stdout) ?? result.error;
    return { skip: `coderabbit exited with code ${result.exit.code}: ${detail}` };
}

async function saveVersion(ctx: RunContext): Promise<void> {
    const version = await ctx.exec("coderabbit", VERSION_TIMEOUT_MS)(["--version"]);
    await saveRaw(ctx.dir, "coderabbit.version.txt", version.ok ? version.stdout : version.error);
}

async function review(ctx: RunContext): Promise<Verdict> {
    await saveVersion(ctx);
    const result = await ctx.exec("coderabbit", REVIEW_TIMEOUT_MS, { keepOutputOnExit: true })([
        "review",
        "--agent",
        "--committed",
        "--base-commit",
        ctx.plan.subject.mergeBase,
    ]);
    const stdout = result.ok ? result.stdout : (result.exit?.stdout ?? "");
    // An Exec reports stderr only inside a failure's error, so a clean run leaves it empty.
    await saveRaw(ctx.dir, "coderabbit.stdout.ndjson", stdout);
    await saveRaw(ctx.dir, "coderabbit.stderr.txt", result.ok ? "" : result.error);
    return result.ok ? verdictOfOutput(result.stdout) : verdictOfFailure(result);
}

export function runCoderabbit(ctx: RunContext): Promise<ReviewerFile> {
    return runTimed(ctx, "coderabbit", () => review(ctx));
}
