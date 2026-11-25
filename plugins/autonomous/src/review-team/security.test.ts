import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Exec } from "../exec.ts";
import { gitSync, isolatedGit, temporaryDirectories } from "../stages/test-fixtures.ts";
import { securityMatches } from "./security.ts";
import type { ReviewConfig } from "./types.ts";

const PATTERNS: ReviewConfig["security"] = {
    pathPatterns: ["(^|/)auth", "secret", "(^|/)\\.env"],
    linePatterns: ["\\bexecFile\\s*\\(", "\\beval\\s*\\(", "new Function\\s*\\("],
};

const directories = temporaryDirectories("review-security");
let repo: string;

const git: Exec = (args) => isolatedGit(["-C", repo, ...args]);

function write(path: string, content: string): void {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
}

function commitAll(message: string): void {
    gitSync(["-C", repo, "add", "-A"]);
    gitSync(["-C", repo, "commit", "-q", "-m", message]);
}

const BEFORE = ["import { readFile } from 'node:fs';", "", "export function run() {", "}", ""];

// `src/run.ts` holds `BEFORE` on `main`; the branch `work` starts there.
beforeEach(() => {
    repo = directories.make("repo");
    gitSync(["-C", repo, "init", "-q", "-b", "main"]);
    write("src/run.ts", BEFORE.join("\n"));
    commitAll("base");
    gitSync(["-C", repo, "checkout", "-q", "-b", "work"]);
});

afterEach(async () => {
    await directories.removeAll();
});

const matches = () => securityMatches(git, "main", "HEAD", PATTERNS);

describe("securityMatches", () => {
    it("Shell execution added: names the pattern, the file and the new-side line", async () => {
        const after = [...BEFORE];
        after.splice(3, 0, "    execFile('sh', ['-c', input]);");
        write("src/run.ts", after.join("\n"));
        commitAll("work");

        expect(await matches()).toEqual({
            ok: true,
            value: [{ kind: "line", pattern: "\\bexecFile\\s*\\(", file: "src/run.ts", line: 4 }],
        });
    });

    it("Nothing sensitive: no match", async () => {
        write("src/run.ts", BEFORE.join("\n").replace("run()", "start()"));
        write("docs/guide.md", "Run the tool.\n");
        commitAll("work");

        expect(await matches()).toEqual({ ok: true, value: [] });
    });

    it("matches a changed path case-insensitively, a deleted one included", async () => {
        write("src/Auth/login.ts", "export const login = 1;\n");
        write("config/.env.local", "KEY=1\n");
        commitAll("seed");
        gitSync(["-C", repo, "branch", "-f", "main"]);
        rmSync(join(repo, "config/.env.local"));
        write("src/Auth/login.ts", "export const login = 2;\n");
        commitAll("work");

        expect(await matches()).toEqual({
            ok: true,
            value: [
                { kind: "path", pattern: "(^|/)auth", file: "src/Auth/login.ts" },
                { kind: "path", pattern: "(^|/)\\.env", file: "config/.env.local" },
            ],
        });
    });

    it("numbers each added line across hunks and files, and ignores deleted ones", async () => {
        const lines = Array.from({ length: 30 }, (_, n) => `const v${n} = ${n};`);
        write("src/many.ts", `${lines.join("\n")}\n`);
        write("src/gone.ts", "eval(code);\n");
        commitAll("seed");
        gitSync(["-C", repo, "branch", "-f", "main"]);
        lines.splice(2, 1, "eval(a);");
        lines.splice(20, 0, "++ eval(b);", "const f = new Function('x');");
        write("src/many.ts", `${lines.join("\n")}\n`);
        write("src/my file.ts", "execFile('ls');\n");
        rmSync(join(repo, "src/gone.ts"));
        commitAll("work");

        expect(await matches()).toEqual({
            ok: true,
            value: [
                { kind: "line", pattern: "\\beval\\s*\\(", file: "src/many.ts", line: 3 },
                { kind: "line", pattern: "\\beval\\s*\\(", file: "src/many.ts", line: 21 },
                { kind: "line", pattern: "new Function\\s*\\(", file: "src/many.ts", line: 22 },
                { kind: "line", pattern: "\\bexecFile\\s*\\(", file: "src/my file.ts", line: 1 },
            ],
        });
    });

    it("does not leave out lockfiles or OpenSpec changes", async () => {
        write("bun.lock", "eval(x);\n");
        write("openspec/changes/add-x/secret-handling.md", "notes\n");
        commitAll("work");

        expect(await matches()).toEqual({
            ok: true,
            value: [
                {
                    kind: "path",
                    pattern: "secret",
                    file: "openspec/changes/add-x/secret-handling.md",
                },
                { kind: "line", pattern: "\\beval\\s*\\(", file: "bun.lock", line: 1 },
            ],
        });
    });

    it("numbers lines right when the git configuration joins hunks across a line", async () => {
        gitSync(["-C", repo, "config", "diff.interHunkContext", "1"]);
        write("src/gap.ts", "const a = 1;\nconst b = 2;\nconst c = 3;\n");
        commitAll("seed");
        gitSync(["-C", repo, "branch", "-f", "main"]);
        write("src/gap.ts", "eval(a);\nconst b = 2;\neval(c);\n");
        commitAll("work");

        expect(await matches()).toEqual({
            ok: true,
            value: [
                { kind: "line", pattern: "\\beval\\s*\\(", file: "src/gap.ts", line: 1 },
                { kind: "line", pattern: "\\beval\\s*\\(", file: "src/gap.ts", line: 3 },
            ],
        });
    });

    it.each([
        ["a quote and a backslash", 'we"ird\\name.ts'],
        ["a tab", "tab\tname.ts"],
        ["a control character", "ctl\u0001name.ts"],
        ["a multibyte character and a quote", 'caf\u00e9 "x".ts'],
        ["a space", "my file.ts"],
        ["nothing unusual", "plain.ts"],
    ])("names the real file when its name holds %s", async (_label, name) => {
        write(`src/${name}`, "eval(code);\n");
        commitAll("work");

        expect(await matches()).toEqual({
            ok: true,
            value: [{ kind: "line", pattern: "\\beval\\s*\\(", file: `src/${name}`, line: 1 }],
        });
    });

    it("fails, naming git, on an unknown base", async () => {
        const result = await securityMatches(git, "no-such-ref", "HEAD", PATTERNS);

        expect(result.ok).toBe(false);
        expect(!result.ok && result.error).toMatch(/^listing the changed paths: git failed/);
    });
});
