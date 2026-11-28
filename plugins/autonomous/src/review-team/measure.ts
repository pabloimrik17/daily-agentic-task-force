// The review tier (spec review-team, "The review tier is measured from the
// diff" and "A tier can be raised, never lowered"; design D5 and D6). Code
// measures the committed diff and sets the tier; a caller may only raise it.

import { basename } from "node:path";

import type { Exec } from "../exec.ts";
import type { Result } from "../result.ts";
import {
    type Measure,
    type Refusable,
    type ReviewConfig,
    type Tier,
    type TierChoice,
    TIERS,
} from "./types.ts";

const LOCKFILES = new Set([
    "bun.lock",
    "bun.lockb",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "Cargo.lock",
    "mise.lock",
]);

// A change's planning documents are verification's subject, not code review's.
const CHANGES_DIR = "openspec/changes/";

function counted(path: string): boolean {
    return !LOCKFILES.has(basename(path)) && !path.startsWith(CHANGES_DIR);
}

interface NumstatEntry {
    path: string;
    lines: number;
}

// With `-z`, a record is `added\tdeleted\tpath\0`, or `added\tdeleted\t\0old\0new\0` for a
// rename; a binary file has `-` for both counts.
const NUMSTAT_RECORD = /(-|\d+)\t(-|\d+)\t(?:([^\0]+)|\0[^\0]*\0([^\0]+))\0/g;

const count = (value: string | undefined): number => Number(value) || 0;

function parseNumstat(stdout: string): NumstatEntry[] {
    return [...stdout.matchAll(NUMSTAT_RECORD)].map(([, added, deleted, path, renamedTo]) => ({
        path: path ?? renamedTo ?? "",
        lines: count(added) + count(deleted),
    }));
}

export async function measureDiff(
    git: Exec,
    mergeBase: string,
    head: string,
): Promise<Result<Measure>> {
    const numstat = await git(["diff", "--numstat", "-z", "-M", mergeBase, head, "--"]);
    if (!numstat.ok) {
        return { ok: false, error: `measuring the diff: ${numstat.error}` };
    }
    const entries = parseNumstat(numstat.stdout).filter((entry) => counted(entry.path));
    return {
        ok: true,
        value: {
            lines: entries.reduce((sum, entry) => sum + entry.lines, 0),
            files: entries.length,
        },
    };
}

export function tierOf(measure: Measure, tiers: ReviewConfig["tiers"]): Tier {
    const within = (tier: "S" | "M") =>
        measure.lines <= tiers[tier].maxLines && measure.files <= tiers[tier].maxFiles;
    if (within("S")) {
        return "S";
    }
    return within("M") ? "M" : "L";
}

function refusal(measured: Tier, requested: { tier: Tier; reason?: string }): string | undefined {
    if (TIERS.indexOf(requested.tier) < TIERS.indexOf(measured)) {
        return `tier ${requested.tier} is below the measured tier ${measured}: a tier can be raised, never lowered`;
    }
    return requested.reason?.trim()
        ? undefined
        : `raising the tier from ${measured} to ${requested.tier} needs a reason`;
}

export function chooseTier(
    measured: Tier,
    requested?: { tier: Tier; reason?: string },
): Refusable<TierChoice> {
    if (requested === undefined || requested.tier === measured) {
        return { ok: true, value: { measured, used: measured } };
    }
    const refused = refusal(measured, requested);
    if (refused !== undefined) {
        return { ok: false, refused: true, error: refused };
    }
    return {
        ok: true,
        value: { measured, used: requested.tier, reason: requested.reason?.trim() },
    };
}
