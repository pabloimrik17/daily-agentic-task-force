// Repository inference and naming for a launched attempt (design D5): which git
// repository under the workspace root a task belongs to, the branch and the AoE
// group its session gets. The name comparison is ghd-aoe's.

import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";

import { isContractLabel } from "../label-contract/contract.ts";
import type { WorkTask } from "../select/types.ts";

export function comparableName(value: string): string {
    return value
        .normalize("NFKD")
        .replace(/[/_-]+/g, " ")
        .replace(/[^a-z0-9 ]+/gi, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

async function hasGit(directory: string): Promise<boolean> {
    try {
        await stat(join(directory, ".git")); // a worktree or submodule has a file, a clone a directory
        return true;
    } catch {
        return false;
    }
}

// Absolute paths of the directories directly under `root` that hold a git repository.
export async function listRepositories(root: string): Promise<string[]> {
    let entries;
    try {
        entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
        throw new Error(`workspace root ${root} cannot be read: ${(error as Error).message}`, {
            cause: error,
        });
    }
    const found: string[] = [];
    for (const entry of entries) {
        const path = join(root, entry.name);
        if (entry.isDirectory() && (await hasGit(path))) {
            found.push(path);
        }
    }
    return found.sort();
}

export function repositorySignals(task: WorkTask): string[] {
    if (task.source === "github") {
        const name = task.repository?.split("/").at(-1);
        return name ? [name] : [];
    }
    if (task.source === "linear") {
        return task.project === null ? [] : [task.project];
    }
    return task.labels.filter((label) => !isContractLabel(label));
}

export type Inference =
    | { ok: true; repository: string; inferredFrom: string }
    | { ok: false; reason: string };

function matchesOf(repositories: readonly string[], signals: readonly string[]) {
    const matches: { repository: string; signal: string }[] = [];
    for (const repository of repositories) {
        const name = comparableName(basename(repository));
        const signal = signals.find((candidate) => comparableName(candidate) === name);
        if (signal !== undefined) {
            matches.push({ repository, signal });
        }
    }
    return matches;
}

export function inferRepository(task: WorkTask, repositories: readonly string[]): Inference {
    const signals = repositorySignals(task);
    const matches = matchesOf(repositories, signals);
    const [only] = matches;
    if (matches.length === 1 && only !== undefined) {
        return { ok: true, repository: only.repository, inferredFrom: only.signal };
    }
    if (matches.length === 0) {
        const listed = signals.length === 0 ? "none" : signals.join(", ");
        return {
            ok: false,
            reason: `no repository under the workspace root matches ${task.source} signals [${listed}]`,
        };
    }
    const named = matches.map((match) => `${match.repository} (${match.signal})`).join(", ");
    return { ok: false, reason: `several repositories match: ${named}` };
}

export function branchFor(task: { id: string; title: string }): string {
    const id = task.id.replace(/[/#]/g, "-");
    const slug = task.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40)
        .replace(/-+$/, "");
    return `feature/${id}-${slug}`;
}

function humanise(name: string): string {
    const words = name
        .replace(/[_.-]+/g, " ")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
    return words ? words[0]!.toUpperCase() + words.slice(1) : "Repository";
}

export function groupFor(repository: string, groups: readonly string[]): string {
    const name = basename(repository);
    const target = comparableName(name);
    const matches = groups.filter(
        (group) => comparableName(group.split("/").at(-1) ?? group) === target,
    );
    const [only] = matches;
    return matches.length === 1 && only !== undefined ? only : humanise(name);
}
