import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { findBranchChange } from "./openspec-change.ts";
import { gitSync, isolatedGit as git } from "./test-fixtures.ts";

let root: string;
let clone: string;

function run(cwd: string, ...args: string[]): void {
    gitSync(
        [
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@example.com",
            "-c",
            "commit.gpgsign=false",
            ...args,
        ],
        cwd,
    );
}

function write(path: string, content = "x\n"): void {
    const full = join(clone, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
}

function commit(message: string): void {
    run(clone, "add", "-A");
    run(clone, "commit", "-m", message);
}

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "openspec-change-"));
    const origin = join(root, "origin.git");
    clone = join(root, "clone");
    run(root, "init", "--bare", "-b", "main", origin);
    run(root, "clone", origin, clone);
    run(clone, "checkout", "-b", "main");
    write("README.md");
    write("openspec/changes/y/proposal.md");
    write("plugins/x/GLOSSARY.md", "base\n");
    commit("base");
    run(clone, "push", "origin", "main");
    run(clone, "checkout", "-b", "feature/work");
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
});

const lookup = (ref = "feature/work") => ({ directory: clone, base: "main", ref });

describe("findBranchChange", () => {
    it("One change: the branch adds the files of a change", async () => {
        write("openspec/changes/read-github-blockers/proposal.md");
        write("openspec/changes/read-github-blockers/tasks.md");
        commit("propose");

        expect(await findBranchChange(git, lookup())).toEqual({
            ok: true,
            value: "read-github-blockers",
        });
    });

    it("No change: the branch adds only files outside openspec/changes", async () => {
        write("docs/notes.md");
        commit("notes");

        const found = await findBranchChange(git, lookup());

        expect(found.ok).toBe(false);
        expect(!found.ok && found.error).toContain("adds no OpenSpec change");
        expect(!found.ok && found.error).toContain("feature/work");
        expect(!found.ok && found.error).toContain("origin/main");
    });

    it("Two changes: the error names both", async () => {
        write("openspec/changes/alpha/proposal.md");
        write("openspec/changes/beta/proposal.md");
        commit("propose two");

        const found = await findBranchChange(git, lookup());

        expect(found.ok).toBe(false);
        expect(!found.ok && found.error).toContain("alpha");
        expect(!found.ok && found.error).toContain("beta");
    });

    it("Archive only: archived and archiving changes are not the change to implement", async () => {
        write("openspec/changes/archive/2026-01-01-x/proposal.md");
        commit("add archived");
        run(clone, "mv", "openspec/changes/y", "openspec/changes/archive/2026-01-02-y");
        commit("archive y");

        const found = await findBranchChange(git, lookup());

        expect(found.ok).toBe(false);
        expect(!found.ok && found.error).toContain("adds no OpenSpec change");
    });

    it("Glossary alongside: a modified glossary file does not hide the change", async () => {
        write("plugins/x/GLOSSARY.md", "changed\n");
        write("plugins/x/NEW.md");
        write("openspec/changes/gamma/proposal.md");
        write("openspec/changes/gamma/design.md");
        commit("propose with glossary");

        expect(await findBranchChange(git, lookup())).toEqual({ ok: true, value: "gamma" });
    });

    it("HEAD: the checked out branch is inspected when ref is HEAD", async () => {
        write("openspec/changes/delta/proposal.md");
        commit("propose");

        expect(await findBranchChange(git, lookup("HEAD"))).toEqual({ ok: true, value: "delta" });
    });

    it("Git failure: an unknown base is reported with what was being done", async () => {
        const found = await findBranchChange(git, { ...lookup(), base: "nope" });

        expect(found.ok).toBe(false);
        expect(!found.ok && found.error).toContain("finding the merge base");
    });
});
