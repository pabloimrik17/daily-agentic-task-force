import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { workTask } from "../select/test-fixtures.ts";
import {
    branchFor,
    comparableName,
    groupFor,
    inferRepository,
    listRepositories,
    repositorySignals,
} from "./infer.ts";

let root: string;

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "infer-"));
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
});

function gitRepository(name: string): string {
    mkdirSync(join(root, name, ".git"), { recursive: true });
    return join(root, name);
}

describe("comparableName", () => {
    it("folds case, separators, accents and punctuation", () => {
        expect(comparableName("Daily_agentic-task/Force")).toBe("daily agentic task force");
        expect(comparableName("Café (v2)!")).toBe("cafe v2");
        expect(comparableName("  a   b ")).toBe("a b");
    });
});

describe("listRepositories", () => {
    it("keeps the directories holding .git, a directory or a file, sorted", async () => {
        const monolab = gitRepository("monolab");
        const alpha = join(root, "alpha");
        mkdirSync(alpha);
        writeFileSync(join(alpha, ".git"), "gitdir: /elsewhere\n");
        mkdirSync(join(root, "notes"));
        writeFileSync(join(root, "stray.txt"), "x");

        expect(await listRepositories(root)).toEqual([alpha, monolab]);
    });

    it("throws an error naming a root that cannot be read", async () => {
        const missing = join(root, "missing");

        await expect(listRepositories(missing)).rejects.toThrow(missing);
    });
});

describe("repositorySignals", () => {
    it("takes the Beads labels that are not contract labels", () => {
        const task = workTask("beads", "bd-1", ["work", "AFK", "taken", "monolab"]);

        expect(repositorySignals(task)).toEqual(["monolab"]);
    });

    it("has none for a Beads task carrying only contract labels", () => {
        const task = workTask("beads", "bd-1", ["work", "AFK", "taken"]);

        expect(repositorySignals(task)).toEqual([]);
    });

    it("takes the Linear project when set", () => {
        expect(repositorySignals(workTask("linear", "DOT-1", [], { project: "Dotfiles" }))).toEqual(
            ["Dotfiles"],
        );
        expect(repositorySignals(workTask("linear", "DOT-1", [], { project: null }))).toEqual([]);
    });

    it("takes the name part of the GitHub repository", () => {
        const task = workTask("github", "owner/name#12", [], { repository: "owner/name" });

        expect(repositorySignals(task)).toEqual(["name"]);
    });
});

describe("inferRepository", () => {
    it("matches a Beads label", async () => {
        const monolab = gitRepository("monolab");
        gitRepository("dotfiles");
        mkdirSync(join(root, "plain"));
        const task = workTask("beads", "bd-1", ["work", "AFK", "taken", "monolab"]);

        expect(inferRepository(task, await listRepositories(root))).toEqual({
            ok: true,
            repository: monolab,
            inferredFrom: "monolab",
        });
    });

    it("matches a Linear project against a directory", async () => {
        const dotfiles = gitRepository("dotfiles");
        gitRepository("monolab");
        const task = workTask("linear", "DOT-1", ["AFK"], { project: "Dotfiles" });

        expect(inferRepository(task, await listRepositories(root))).toEqual({
            ok: true,
            repository: dotfiles,
            inferredFrom: "Dotfiles",
        });
    });

    it("matches a GitHub repository name", async () => {
        const name = gitRepository("name");
        const task = workTask("github", "owner/name#12", ["AFK"], { repository: "owner/name" });

        expect(inferRepository(task, await listRepositories(root))).toEqual({
            ok: true,
            repository: name,
            inferredFrom: "name",
        });
    });

    it("names the signals when nothing matches", async () => {
        gitRepository("monolab");
        const task = workTask("beads", "bd-1", ["AFK", "qup", "ghost"]);

        expect(inferRepository(task, await listRepositories(root))).toEqual({
            ok: false,
            reason: "no repository under the workspace root matches beads signals [qup, ghost]",
        });
    });

    it("says there were no signals when the task has none", async () => {
        gitRepository("monolab");
        const task = workTask("beads", "bd-1", ["work", "AFK", "taken"]);

        expect(inferRepository(task, await listRepositories(root))).toEqual({
            ok: false,
            reason: "no repository under the workspace root matches beads signals [none]",
        });
    });

    it("names both repositories when two match", async () => {
        const monolab = gitRepository("monolab");
        const qup = gitRepository("qup");
        const task = workTask("beads", "bd-1", ["AFK", "monolab", "qup"]);

        expect(inferRepository(task, await listRepositories(root))).toEqual({
            ok: false,
            reason: `several repositories match: ${monolab} (monolab), ${qup} (qup)`,
        });
    });
});

describe("branchFor", () => {
    it("slugs a title with punctuation", () => {
        expect(branchFor({ id: "DOT-109", title: "feat: Stage session manager! (DOT-109)" })).toBe(
            "feature/DOT-109-feat-stage-session-manager-dot-109",
        );
    });

    it("replaces / and # in a GitHub id", () => {
        expect(branchFor({ id: "owner/name#12", title: "Fix the thing" })).toBe(
            "feature/owner-name-12-fix-the-thing",
        );
    });

    it("cuts the slug to 40 characters", () => {
        const slug = branchFor({
            id: "X-1",
            title: "An extremely long title that goes on and on forever",
        }).slice("feature/X-1-".length);

        expect(slug).toBe("an-extremely-long-title-that-goes-on-and");
        expect(slug).toHaveLength(40);
    });

    it("trims the dash a cut leaves at the end", () => {
        expect(branchFor({ id: "X-1", title: "An extremely long title that goes on ab cd" })).toBe(
            "feature/X-1-an-extremely-long-title-that-goes-on-ab",
        );
    });
});

describe("groupFor", () => {
    const groups = ["Dotfiles", "Monolab/Qup", "Daily agentic task force"];

    it("picks the group whose last segment matches the directory", () => {
        expect(groupFor("/w/daily-agentic-task-force", groups)).toBe("Daily agentic task force");
        expect(groupFor("/w/qup", groups)).toBe("Monolab/Qup");
    });

    it("humanises the directory name otherwise", () => {
        expect(groupFor("/w/someNewRepo", groups)).toBe("Some new repo");
        expect(groupFor("/w/my_repo.name", groups)).toBe("My repo name");
    });
});
