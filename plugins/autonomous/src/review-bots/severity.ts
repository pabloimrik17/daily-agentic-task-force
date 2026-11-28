// Severity comes from the reporter's own mark, never from a model (spec review-bots, "Severity
// comes from the reporter's own mark"; design D8).

import type { Severity } from "../review-team/types.ts";

const CODERABBIT: Readonly<Record<string, Severity>> = {
    Critical: "CRITICAL",
    Major: "WARNING",
    Minor: "SUGGESTION",
    Trivial: "SUGGESTION",
    Nitpick: "SUGGESTION",
};
const CODERABBIT_MARK = /\b(Critical|Major|Minor|Trivial|Nitpick)\b/u;
const GREPTILE_BADGE = /<img alt="P(\d+)"/u;

// The first line that is neither blank nor a hidden HTML comment: CodeRabbit opens with one.
function firstLine(body: string): string {
    return (
        body
            .split(/\r?\n/u)
            .map((line) => line.trim())
            .find((line) => line !== "" && !line.startsWith("<!--")) ?? ""
    );
}

function codeRabbit(line: string): Severity | undefined {
    const mark = CODERABBIT_MARK.exec(line)?.[1];
    return mark === undefined ? undefined : CODERABBIT[mark];
}

function greptile(line: string): Severity | undefined {
    const badge = GREPTILE_BADGE.exec(line)?.[1];
    if (badge === undefined) {
        return undefined;
    }
    const level = Number(badge);
    return level <= 1 ? "CRITICAL" : level === 2 ? "WARNING" : "SUGGESTION";
}

// Keyed by the shipped bot ids; Pullfrog leaves no mark, so it falls to the default as an
// unrecognised mark does.
const MARKS: Readonly<Record<string, (line: string) => Severity | undefined>> = {
    coderabbit: codeRabbit,
    greptile,
};

export function botSeverity(bot: string, body: string): Severity {
    return MARKS[bot]?.(firstLine(body)) ?? "WARNING";
}

const LABEL = /^\**([a-z]+)(?:\s*\(([^)]*)\))?\**\s*:/iu;

// A human reviewer's Conventional Comments label, read as the code review prompt reads it.
export function humanSeverity(body: string): Severity {
    const match = LABEL.exec(firstLine(body));
    const label = match?.[1]?.toLowerCase() ?? "";
    const decorations = (match?.[2] ?? "").split(",").map((item) => item.trim().toLowerCase());
    if (decorations.includes("blocking")) {
        return "CRITICAL";
    }
    return label === "nit" || label === "nitpick" ? "SUGGESTION" : "WARNING";
}
