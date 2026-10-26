import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..");
const oxfmtBin = join(repoRoot, "node_modules", ".bin", "oxfmt");

// Unformatted on purpose: any formatting pass that reaches a file rewrites it.
const UNFORMATTED = "export   const a={b:1}\n";
const VENDORED = "plugins/stonks/mod/types/claude-code.d.ts";
const SIBLING = "plugins/stonks/mod/types/sibling.ts";

let root: string;

function oxfmt(args: string[], cwd = root): number | null {
    return spawnSync(oxfmtBin, args, { cwd, encoding: "utf8" }).status;
}

function read(relativePath: string): string {
    return readFileSync(join(root, relativePath), "utf8");
}

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "datf-oxfmt-"));
    copyFileSync(join(repoRoot, "oxfmt.config.ts"), join(root, "oxfmt.config.ts"));
    mkdirSync(join(root, "plugins/stonks/mod/types"), { recursive: true });
    writeFileSync(join(root, VENDORED), UNFORMATTED, "utf8");
    writeFileSync(join(root, SIBLING), UNFORMATTED, "utf8");
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
});

describe("oxfmt.config.ts ignorePatterns", () => {
    it("skips an excluded file named by a relative path", () => {
        expect(oxfmt(["--no-error-on-unmatched-pattern", VENDORED])).toBe(0);
        expect(read(VENDORED)).toBe(UNFORMATTED);
    });

    it("skips an excluded file named by an absolute path", () => {
        expect(oxfmt(["--no-error-on-unmatched-pattern", join(root, VENDORED)])).toBe(0);
        expect(read(VENDORED)).toBe(UNFORMATTED);
    });

    it("skips an excluded file when formatting its directory", () => {
        expect(oxfmt(["plugins/stonks"])).toBe(0);
        expect(read(VENDORED)).toBe(UNFORMATTED);
        // The sibling proves the run formatted, so the exclusion is what spared the vendored file.
        expect(read(SIBLING)).not.toBe(UNFORMATTED);
    });

    it("skips an excluded file when run from a nested directory", () => {
        expect(oxfmt(["."], join(root, "plugins/stonks"))).toBe(0);
        expect(read(VENDORED)).toBe(UNFORMATTED);
        expect(read(SIBLING)).not.toBe(UNFORMATTED);
    });

    it("rejects an entirely excluded selection without --no-error-on-unmatched-pattern", () => {
        expect(oxfmt([VENDORED])).toBe(2);
        expect(read(VENDORED)).toBe(UNFORMATTED);
    });
});
