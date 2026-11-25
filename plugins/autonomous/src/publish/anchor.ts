// Where a thread is anchored on the final diff (spec finding-threads, "Where a comment is
// anchored"; design D9): the finding's line when one hunk holds it on that side, else its file at
// file level when the diff changes it, else the change's proposal at file level, else nowhere,
// which leaves it to the review's body. The diff is `git diff --src-prefix=a/ --dst-prefix=b/`.

import type { ThreadAnchor } from "../pull-request/port.ts";
import { unquoted } from "../review-team/security.ts";
import type { Location } from "../review-team/types.ts";

export interface DiffHunk {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
}

export interface DiffFile {
    path: string; // the new path; the old one for a deleted file
    oldPath: string; // the old path; the new one for an added file
    status: "added" | "deleted" | "renamed" | "modified";
    binary: boolean;
    hunks: DiffHunk[];
}

type Side = Extract<Location, { scope: "line" }>["side"];

interface Parsing {
    files: DiffFile[];
    file: DiffFile | null;
    old: number; // lines of the current hunk still to read, per side
    new: number;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u;
const QUOTED_PAIR = /^("(?:[^"\\]|\\.)*") ("(?:[^"\\]|\\.)*")$/u;

function withoutPrefix(path: string, prefix: string): string {
    return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

// `diff --git a/<path> b/<path>`: read when no other line names the paths (a binary file, a
// mode change, a pure rename). A rename's own lines replace what this guesses.
function headerPaths(rest: string): [string, string] {
    const quoted = QUOTED_PAIR.exec(rest);
    if (quoted !== null) {
        return [unquoted(quoted[1] ?? ""), unquoted(quoted[2] ?? "")];
    }
    const half = (rest.length - 1) / 2;
    return [rest.slice(0, half), rest.slice(half + 1)];
}

function startFile(state: Parsing, rest: string): void {
    const [left, right] = headerPaths(rest);
    const file: DiffFile = {
        path: withoutPrefix(right, "b/"),
        oldPath: withoutPrefix(left, "a/"),
        status: "modified",
        binary: false,
        hunks: [],
    };
    state.files.push(file);
    state.file = file;
}

// git ends a path that holds a space with a tab.
function sidePath(rest: string, prefix: string): string | null {
    const path = rest.replace(/\t$/u, "");
    return path === "/dev/null" ? null : withoutPrefix(unquoted(path), prefix);
}

function startHunk(state: Parsing, line: string): void {
    const match = HUNK.exec(line);
    if (match === null || state.file === null) {
        return;
    }
    const hunk: DiffHunk = {
        oldStart: Number(match[1]),
        oldLines: Number(match[2] ?? 1),
        newStart: Number(match[3]),
        newLines: Number(match[4] ?? 1),
    };
    state.file.hunks.push(hunk);
    state.old = hunk.oldLines;
    state.new = hunk.newLines;
}

type HeaderReader = (file: DiffFile, rest: string) => void;

const HEADERS: readonly [string, HeaderReader][] = [
    [
        "--- ",
        (file, rest) => {
            file.oldPath = sidePath(rest, "a/") ?? file.oldPath;
        },
    ],
    [
        "+++ ",
        (file, rest) => {
            file.path = sidePath(rest, "b/") ?? file.path;
        },
    ],
    [
        "rename from ",
        (file, rest) => {
            file.oldPath = unquoted(rest);
            file.status = "renamed";
        },
    ],
    [
        "rename to ",
        (file, rest) => {
            file.path = unquoted(rest);
        },
    ],
    [
        "new file mode ",
        (file) => {
            file.status = "added";
        },
    ],
    [
        "deleted file mode ",
        (file) => {
            file.status = "deleted";
        },
    ],
    [
        "Binary files ",
        (file) => {
            file.binary = true;
        },
    ],
    [
        "GIT binary patch",
        (file) => {
            file.binary = true;
        },
    ],
];

// A header line is read only between hunks, so a removed line `-- x` is never taken for `--- `.
function readHeader(state: Parsing, line: string): void {
    if (line.startsWith("diff --git ")) {
        startFile(state, line.slice("diff --git ".length));
        return;
    }
    if (line.startsWith("@@ ")) {
        startHunk(state, line);
        return;
    }
    const header = HEADERS.find(([prefix]) => line.startsWith(prefix));
    if (header !== undefined && state.file !== null) {
        header[1](state.file, line.slice(header[0].length));
    }
}

// `\ No newline at end of file` belongs to neither side.
function readHunkLine(state: Parsing, line: string): void {
    const mark = line.charAt(0);
    if (mark === "\\") {
        return;
    }
    if (mark !== "+") {
        state.old -= 1;
    }
    if (mark !== "-") {
        state.new -= 1;
    }
}

export function parseDiff(diff: string): DiffFile[] {
    const state: Parsing = { files: [], file: null, old: 0, new: 0 };
    for (const line of diff.split("\n")) {
        if (state.old > 0 || state.new > 0) {
            readHunkLine(state, line);
        } else {
            readHeader(state, line);
        }
    }
    return state.files;
}

function fileOf(files: readonly DiffFile[], path: string): DiffFile | undefined {
    return files.find((file) => file.path === path || file.oldPath === path);
}

function holds(hunk: DiffHunk, startLine: number, endLine: number, side: Side): boolean {
    const [start, count] =
        side === "new" ? [hunk.newStart, hunk.newLines] : [hunk.oldStart, hunk.oldLines];
    return count > 0 && start <= startLine && endLine <= start + count - 1;
}

export function hunkHolding(
    files: readonly DiffFile[],
    path: string,
    startLine: number,
    endLine: number,
    side: Side,
): DiffHunk | null {
    const file = fileOf(files, path);
    return file?.hunks.find((hunk) => holds(hunk, startLine, endLine, side)) ?? null;
}

function lineAnchor(location: Extract<Location, { scope: "line" }>, path: string): ThreadAnchor {
    const side = location.side === "new" ? "RIGHT" : "LEFT";
    return location.startLine === location.endLine
        ? { kind: "line", path, line: location.endLine, side }
        : { kind: "line", path, line: location.endLine, startLine: location.startLine, side };
}

export function proposalPath(change: string): string {
    return `openspec/changes/${change}/proposal.md`;
}

// Null when no thread can hold the finding: it goes in the review's body.
export function anchorFor(
    location: Location,
    files: readonly DiffFile[],
    change: string,
): ThreadAnchor | null {
    const file = location.scope === "change" ? undefined : fileOf(files, location.file);
    if (file !== undefined && location.scope === "line") {
        const { file: path, startLine, endLine, side } = location;
        if (hunkHolding(files, path, startLine, endLine, side) !== null) {
            return lineAnchor(location, file.path);
        }
    }
    if (file !== undefined) {
        return { kind: "file", path: file.path };
    }
    const proposal = fileOf(files, proposalPath(change));
    return proposal === undefined ? null : { kind: "file", path: proposal.path };
}
