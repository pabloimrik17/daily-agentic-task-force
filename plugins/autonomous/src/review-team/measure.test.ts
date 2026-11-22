import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Exec } from "../exec.ts";
import { gitSync, isolatedGit, temporaryDirectories } from "../stages/test-fixtures.ts";
import { chooseTier, measureDiff, tierOf } from "./measure.ts";
import type { ReviewConfig } from "./types.ts";

const TIERS: ReviewConfig["tiers"] = {
    S: { maxLines: 150, maxFiles: 5 },
    M: { maxLines: 600, maxFiles: 20 },
};

const directories = temporaryDirectories("review-measure");
let repo: string;

const git: Exec = (args) => isolatedGit(["-C", repo, ...args]);

const lines = (count: number, tag = "line") =>
    Array.from({ length: count }, (_, n) => `${tag} ${n}\n`).join("");

function put(path: string, content: string | Buffer): void {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
}

// Commits `files` on `main`, then `change` on a branch, and measures the branch's diff.
async function measureChange(
    change: () => void,
    files: Record<string, string> = { "README.md": "base\n" },
) {
    for (const [path, content] of Object.entries(files)) {
        put(path, content);
    }
    gitSync(["-C", repo, "add", "-A"]);
    gitSync(["-C", repo, "commit", "-q", "-m", "base"]);
    gitSync(["-C", repo, "checkout", "-q", "-b", "work"]);
    change();
    gitSync(["-C", repo, "add", "-A"]);
    gitSync(["-C", repo, "commit", "-q", "-m", "work"]);
    return measureDiff(git, "main", "HEAD");
}

beforeEach(() => {
    repo = directories.make("repo");
    gitSync(["-C", repo, "init", "-q", "-b", "main"]);
});

afterEach(async () => {
    await directories.removeAll();
});

describe("measureDiff", () => {
    it("counts added and deleted lines, and the changed files", async () => {
        const measure = await measureChange(
            () => {
                put("a.ts", lines(40));
                put("b.ts", lines(30));
                put("README.md", lines(20));
            },
            { "README.md": lines(10, "old") },
        );

        expect(measure).toEqual({ ok: true, value: { lines: 100, files: 3 } });
    });

    it("Lockfile excluded: 100 lines of source and 3,000 of bun.lock is tier S", async () => {
        const measure = await measureChange(() => {
            put("src/a.ts", lines(60));
            put("src/b.ts", lines(40));
            put("bun.lock", lines(3000));
        });

        expect(measure).toEqual({ ok: true, value: { lines: 100, files: 2 } });
        expect(measure.ok && tierOf(measure.value, TIERS)).toBe("S");
    });

    it("leaves out every lockfile by its name, at any depth", async () => {
        const measure = await measureChange(() => {
            put("src/a.ts", lines(5));
            for (const lockfile of [
                "bun.lockb",
                "package-lock.json",
                "pnpm-lock.yaml",
                "yarn.lock",
                "Cargo.lock",
                "mise.lock",
                "plugins/x/bun.lock",
            ]) {
                put(lockfile, lines(50));
            }
        });

        expect(measure).toEqual({ ok: true, value: { lines: 5, files: 1 } });
    });

    it("leaves out a file under openspec/changes/", async () => {
        const measure = await measureChange(() => {
            put("src/a.ts", lines(5));
            put("openspec/changes/add-x/tasks.md", lines(400));
            put("openspec/specs/x/spec.md", lines(7));
        });

        expect(measure).toEqual({ ok: true, value: { lines: 12, files: 2 } });
    });

    it("counts a binary file as one file and zero lines", async () => {
        const measure = await measureChange(() => {
            put("src/a.ts", lines(5));
            put("logo.png", Buffer.from([0, 1, 2, 0, 255, 0, 3]));
        });

        expect(measure).toEqual({ ok: true, value: { lines: 5, files: 2 } });
    });

    it("counts a renamed file once, by its changed lines", async () => {
        const measure = await measureChange(
            () => {
                mkdirSync(join(repo, "src"));
                gitSync(["-C", repo, "mv", "old name.ts", "src/new name.ts"]);
                put("src/new name.ts", `${lines(30)}added\n`);
                put("other.ts", lines(2));
            },
            { "old name.ts": lines(30) },
        );

        expect(measure).toEqual({ ok: true, value: { lines: 3, files: 2 } });
    });

    it("counts a renamed lockfile as left out, by its new name", async () => {
        const measure = await measureChange(
            () => {
                gitSync(["-C", repo, "mv", "deps.txt", "bun.lock"]);
            },
            { "deps.txt": lines(30) },
        );

        expect(measure).toEqual({ ok: true, value: { lines: 0, files: 0 } });
    });

    it("fails, naming git, on an unknown base", async () => {
        const measure = await measureDiff(git, "no-such-ref", "HEAD");

        expect(measure.ok).toBe(false);
        expect(!measure.ok && measure.error).toMatch(/^measuring the diff: git failed/);
    });
});

describe("tierOf", () => {
    it.each([
        ["Small change", 90, 3, "S"],
        ["Many files", 200, 25, "L"],
        ["at both S thresholds", 150, 5, "S"],
        ["one line over S", 151, 5, "M"],
        ["one file over S", 150, 6, "M"],
        ["at both M thresholds", 600, 20, "M"],
        ["one line over M", 601, 20, "L"],
        ["one file over M", 600, 21, "L"],
        ["no change", 0, 0, "S"],
    ] as const)("%s: %i lines in %i files is %s", (_, lines_, files, tier) => {
        expect(tierOf({ lines: lines_, files }, TIERS)).toBe(tier);
    });

    it("takes its thresholds from the configuration", () => {
        const tight = { S: { maxLines: 10, maxFiles: 1 }, M: { maxLines: 20, maxFiles: 2 } };

        expect(tierOf({ lines: 90, files: 3 }, tight)).toBe("L");
    });
});

describe("chooseTier", () => {
    it("uses the measured tier when none is asked for", () => {
        expect(chooseTier("M")).toEqual({ ok: true, value: { measured: "M", used: "M" } });
    });

    it("Raised with a reason: records the measured tier, the tier used and the reason", () => {
        const reason = "the change touches the label contract";

        expect(chooseTier("S", { tier: "L", reason })).toEqual({
            ok: true,
            value: { measured: "S", used: "L", reason },
        });
    });

    it("Lowering refused: the error names both tiers", () => {
        const choice = chooseTier("L", { tier: "M", reason: "small enough" });

        expect(choice).toEqual({
            ok: false,
            refused: true,
            error: "tier M is below the measured tier L: a tier can be raised, never lowered",
        });
    });

    it.each([undefined, "", "   "])("refuses a raise with the reason %j", (reason) => {
        const choice = chooseTier("S", { tier: "M", ...(reason === undefined ? {} : { reason }) });

        expect(choice).toEqual({
            ok: false,
            refused: true,
            error: "raising the tier from S to M needs a reason",
        });
    });

    it("needs no reason to ask for the measured tier itself", () => {
        expect(chooseTier("M", { tier: "M" })).toEqual({
            ok: true,
            value: { measured: "M", used: "M" },
        });
    });
});
