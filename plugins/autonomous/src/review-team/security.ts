// The security trigger (spec review-team, "The security trigger"): the
// configured path patterns against every changed path, case-insensitively,
// and the line patterns against every added line, each match named with its
// file and new-side line. Lockfiles and OpenSpec changes are not left out.

import type { Exec } from "../exec.ts";
import type { Result } from "../result.ts";
import type { ReviewConfig, SecurityMatch } from "./types.ts";

interface AddedLine {
    file: string;
    line: number;
    text: string;
}

interface DiffState {
    file: string;
    line: number;
    inHunk: boolean;
}

const ESCAPES: Record<string, number> = {
    a: 7,
    b: 8,
    t: 9,
    n: 10,
    v: 11,
    f: 12,
    r: 13,
    '"': 34,
    "\\": 92,
};

const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

// git quotes and C-escapes a path that holds `"`, `\` or a control character, even with
// core.quotePath=false; any other path is returned as it is. The escaped bytes are decoded as
// UTF-8, so an octal-escaped multibyte character comes out whole.
function unquoted(path: string): string {
    if (path.length < 2 || !path.startsWith('"') || !path.endsWith('"')) {
        return path;
    }
    const parts = path.slice(1, -1).matchAll(/\\([0-7]{3})|\\(.)|([^\\]+)/gs);
    const bytes = Array.from(parts, ([, octal, escaped, plain]) => {
        if (octal !== undefined) {
            return Buffer.of(Number.parseInt(octal, 8));
        }
        const code = escaped === undefined ? undefined : ESCAPES[escaped];
        return code === undefined ? Buffer.from(escaped ?? plain ?? "") : Buffer.of(code);
    });
    return Buffer.concat(bytes).toString("utf8");
}

// A header line (`diff --git`, `+++ <path>`) is read only before a file's first hunk, so an
// added line whose text starts with `++` is never taken for one.
function readHeader(text: string, state: DiffState): void {
    if (text.startsWith("+++ ")) {
        // git ends a path that holds a space with a tab.
        state.file = unquoted(text.slice(4).replace(/\t$/, ""));
        return;
    }
    const hunk = HUNK.exec(text);
    if (hunk !== null) {
        state.line = Number(hunk[1]);
        state.inHunk = true;
    }
}

function readHunk(text: string, state: DiffState, added: AddedLine[]): void {
    if (text.startsWith("+")) {
        added.push({ file: state.file, line: state.line, text: text.slice(1) });
        state.line += 1;
        return;
    }
    state.inHunk = !text.startsWith("diff --git ");
    readHeader(text, state);
}

function addedLines(diff: string): AddedLine[] {
    const state: DiffState = { file: "", line: 0, inHunk: false };
    const added: AddedLine[] = [];
    for (const text of diff.split("\n")) {
        if (state.inHunk) {
            readHunk(text, state, added);
        } else {
            readHeader(text, state);
        }
    }
    return added;
}

function pathMatches(paths: string[], patterns: string[]): SecurityMatch[] {
    return patterns.flatMap((pattern) => {
        const regex = new RegExp(pattern, "i");
        return paths
            .filter((file) => regex.test(file))
            .map((file) => ({ kind: "path" as const, pattern, file }));
    });
}

function lineMatches(added: AddedLine[], patterns: string[]): SecurityMatch[] {
    const compiled = patterns.map((pattern) => ({ pattern, regex: new RegExp(pattern) }));
    return added.flatMap(({ file, line, text }) =>
        compiled
            .filter(({ regex }) => regex.test(text))
            .map(({ pattern }) => ({ kind: "line" as const, pattern, file, line })),
    );
}

export async function securityMatches(
    git: Exec,
    mergeBase: string,
    head: string,
    patterns: ReviewConfig["security"],
): Promise<Result<SecurityMatch[]>> {
    // Without rename detection, a rename lists both of its paths.
    const names = await git(["diff", "--name-only", "-z", "--no-renames", mergeBase, head, "--"]);
    if (!names.ok) {
        return { ok: false, error: `listing the changed paths: ${names.error}` };
    }
    // Unquoted paths keep a non-ASCII name as the path list gives it.
    const diff = await git([
        "-c",
        "core.quotePath=false",
        "diff",
        "-U0",
        // A diff.interHunkContext setting would join two close changes with a context line.
        "--inter-hunk-context=0",
        "--no-color",
        "--no-ext-diff",
        "--no-prefix",
        mergeBase,
        head,
        "--",
    ]);
    if (!diff.ok) {
        return { ok: false, error: `reading the added lines: ${diff.error}` };
    }
    const paths = names.stdout.split("\0").filter((path) => path !== "");
    return {
        ok: true,
        value: [
            ...pathMatches(paths, patterns.pathPatterns),
            ...lineMatches(addedLines(diff.stdout), patterns.linePatterns),
        ],
    };
}
