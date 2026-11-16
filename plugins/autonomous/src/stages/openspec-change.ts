// Finds the OpenSpec change a branch adds (design D3), with git alone: the pull request's
// file list from `gh` is capped, and git sees the same diff without the cap.

import type { Exec } from "../exec.ts";
import type { Result } from "../result.ts";

export interface ChangeLookup {
    directory: string; // where git runs, passed as `git -C <directory>`
    base: string; // the repository's default branch, compared as `origin/<base>`
    ref: string; // the branch tip to inspect: a branch name or `HEAD`
}

const CHANGES_DIR = "openspec/changes/";

function changeNames(paths: string): string[] {
    const names = new Set<string>();
    for (const path of paths.split("\n")) {
        if (!path.startsWith(CHANGES_DIR)) {
            continue;
        }
        const [name, ...rest] = path.slice(CHANGES_DIR.length).split("/");
        if (name !== undefined && name !== "" && name !== "archive" && rest.length > 0) {
            names.add(name);
        }
    }
    return [...names].sort();
}

export async function findBranchChange(git: Exec, lookup: ChangeLookup): Promise<Result<string>> {
    const { directory, base, ref } = lookup;
    const mergeBase = await git(["-C", directory, "merge-base", `origin/${base}`, ref]);
    if (!mergeBase.ok) {
        return {
            ok: false,
            error: `finding the merge base of ${ref} and origin/${base}: ${mergeBase.error}`,
        };
    }
    const added = await git([
        "-C",
        directory,
        "diff",
        "--name-only",
        "--no-renames",
        "--diff-filter=A",
        mergeBase.stdout.trim(),
        ref,
        "--",
        CHANGES_DIR,
    ]);
    if (!added.ok) {
        return {
            ok: false,
            error: `listing the files ${ref} adds under ${CHANGES_DIR}: ${added.error}`,
        };
    }
    const names = changeNames(added.stdout);
    const [only] = names;
    if (names.length === 1 && only !== undefined) {
        return { ok: true, value: only };
    }
    if (names.length === 0) {
        return {
            ok: false,
            error: `${ref} adds no OpenSpec change under ${CHANGES_DIR} compared with origin/${base}`,
        };
    }
    return {
        ok: false,
        error: `${ref} adds more than one OpenSpec change compared with origin/${base}: ${names.join(", ")}`,
    };
}
