import { describe, expect, it } from "vitest";

import { anchorFor, hunkHolding, parseDiff, proposalPath } from "./anchor.ts";
import { CHANGE, DIFF } from "./test-fixtures.ts";

const FILES = parseDiff(DIFF);

describe("parseDiff", () => {
    it("reads modified, added, renamed, deleted and binary files", () => {
        expect(
            FILES.map(({ path, oldPath, status, binary }) => ({ path, oldPath, status, binary })),
        ).toEqual([
            { path: "src/retry.ts", oldPath: "src/retry.ts", status: "modified", binary: false },
            {
                path: proposalPath(CHANGE),
                oldPath: proposalPath(CHANGE),
                status: "added",
                binary: false,
            },
            {
                path: "src/new-name.ts",
                oldPath: "src/old-name.ts",
                status: "renamed",
                binary: false,
            },
            { path: "src/gone.ts", oldPath: "src/gone.ts", status: "deleted", binary: false },
            {
                path: "assets/logo.png",
                oldPath: "assets/logo.png",
                status: "modified",
                binary: true,
            },
        ]);
    });

    it("reads every hunk's ranges, past a removed line that looks like a header", () => {
        expect(FILES[0]?.hunks).toEqual([
            { oldStart: 10, oldLines: 4, newStart: 10, newLines: 5 },
            { oldStart: 40, oldLines: 3, newStart: 41, newLines: 3 },
        ]);
        expect(FILES[3]?.hunks).toEqual([{ oldStart: 1, oldLines: 2, newStart: 0, newLines: 0 }]);
        expect(FILES.map(({ path }) => path)).not.toContain("not a header");
    });

    it("unquotes a path git quoted", () => {
        const diff = [
            'diff --git "a/docs/caf\\303\\251.md" "b/docs/caf\\303\\251.md"',
            "index 1111111..2222222 100644",
            '--- "a/docs/caf\\303\\251.md"',
            '+++ "b/docs/caf\\303\\251.md"',
            "@@ -1 +1 @@",
            "-old",
            "+new",
        ].join("\n");
        expect(parseDiff(diff)[0]).toMatchObject({ path: "docs/café.md", oldPath: "docs/café.md" });
    });
});

describe("Where a comment is anchored", () => {
    it("Line in the diff: anchored to that line", () => {
        const location = {
            scope: "line",
            file: "src/retry.ts",
            startLine: 12,
            endLine: 12,
            side: "new",
        } as const;
        expect(anchorFor(location, FILES, CHANGE)).toEqual({
            kind: "line",
            path: "src/retry.ts",
            line: 12,
            side: "RIGHT",
        });
    });

    it("anchors a range to its last line with its first, and the old side to LEFT", () => {
        const range = {
            scope: "line",
            file: "src/retry.ts",
            startLine: 41,
            endLine: 43,
            side: "new",
        } as const;
        expect(anchorFor(range, FILES, CHANGE)).toEqual({
            kind: "line",
            path: "src/retry.ts",
            line: 43,
            startLine: 41,
            side: "RIGHT",
        });
        const removed = {
            scope: "line",
            file: "src/gone.ts",
            startLine: 2,
            endLine: 2,
            side: "old",
        } as const;
        expect(anchorFor(removed, FILES, CHANGE)).toEqual({
            kind: "line",
            path: "src/gone.ts",
            line: 2,
            side: "LEFT",
        });
    });

    it("Line outside every hunk: anchored to the file at file level", () => {
        const location = {
            scope: "line",
            file: "src/retry.ts",
            startLine: 30,
            endLine: 30,
            side: "new",
        } as const;
        expect(anchorFor(location, FILES, CHANGE)).toEqual({ kind: "file", path: "src/retry.ts" });
    });

    it("anchors a range across two hunks at file level", () => {
        const location = {
            scope: "line",
            file: "src/retry.ts",
            startLine: 12,
            endLine: 42,
            side: "new",
        } as const;
        expect(anchorFor(location, FILES, CHANGE)).toEqual({ kind: "file", path: "src/retry.ts" });
    });

    it("anchors a renamed file's old path to its new one", () => {
        const location = { scope: "file", file: "src/old-name.ts" } as const;
        expect(anchorFor(location, FILES, CHANGE)).toEqual({
            kind: "file",
            path: "src/new-name.ts",
        });
    });

    it("Whole change: anchored at file level to the change's proposal.md", () => {
        expect(anchorFor({ scope: "change" }, FILES, CHANGE)).toEqual({
            kind: "file",
            path: `openspec/changes/${CHANGE}/proposal.md`,
        });
    });

    it("anchors a file the diff does not change to the proposal", () => {
        const location = { scope: "file", file: "src/untouched.ts" } as const;
        expect(anchorFor(location, FILES, CHANGE)).toEqual({
            kind: "file",
            path: proposalPath(CHANGE),
        });
    });

    it("leaves a finding to the review body when the diff holds no proposal", () => {
        expect(anchorFor({ scope: "change" }, FILES, "another-change")).toBeNull();
    });
});

describe("hunkHolding", () => {
    it("finds the one hunk that holds a range on that side", () => {
        expect(hunkHolding(FILES, "src/retry.ts", 41, 41, "old")).toEqual({
            oldStart: 40,
            oldLines: 3,
            newStart: 41,
            newLines: 3,
        });
        expect(hunkHolding(FILES, "src/retry.ts", 14, 14, "old")).toBeNull();
        expect(hunkHolding(FILES, "src/gone.ts", 1, 1, "new")).toBeNull();
        expect(hunkHolding(FILES, "src/missing.ts", 1, 1, "new")).toBeNull();
    });
});
