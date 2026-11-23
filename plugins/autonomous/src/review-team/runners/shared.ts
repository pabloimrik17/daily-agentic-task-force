// What the CLI reviewers' runners share (spec review-team, "Output is validated at run time" and
// "A reviewer that cannot run is skipped and recorded"; design D7 and D8): the context a runner
// receives, the raw files it saves, its timing, and the one place where its result becomes a
// validated `ReviewerFile`. A runner always resolves; `run <id>` writes the file it returns.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Exec } from "../../exec.ts";
import { parseReviewerFile } from "../schema.ts";
import {
    type DroppedEntry,
    FINDING_SCHEMA,
    type Plan,
    type PlannedReviewer,
    type RawItem,
    type ReviewerFile,
    type ReviewerId,
} from "../types.ts";

export interface RunContext {
    // Bound to the repository's directory. `keepOutputOnExit` keeps a failed run's stdout, for a
    // tool that reports its error there.
    exec: (command: string, timeoutMs: number, options?: { keepOutputOnExit?: boolean }) => Exec;
    dir: string; // the report directory, absolute
    plan: Plan;
    row: PlannedReviewer; // this reviewer's entry of `plan.team`
    now: () => number; // epoch ms
}

export type Runner = (ctx: RunContext) => Promise<ReviewerFile>;

// What a runner decides: the items it read and any entry it dropped, or why it gives up.
export type Verdict = { items: RawItem[]; dropped?: DroppedEntry[] } | { skip: string };

// Design D7: every CLI reviewer gets the same 15 minutes.
export const REVIEW_TIMEOUT_MS = 15 * 60 * 1000;

export async function saveRaw(dir: string, name: string, content: string): Promise<void> {
    await mkdir(join(dir, "raw"), { recursive: true });
    await writeFile(join(dir, "raw", name), content);
}

export function skippedFile(
    reviewer: ReviewerId,
    reason: string,
    durationMs: number,
): ReviewerFile {
    return { schema: FINDING_SCHEMA, reviewer, outcome: "skipped", reason, durationMs };
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

// Times `decide`, turns a crash into a skip, and validates what it returns with the same parser
// `collect` uses, so a file this writes is never one `collect` would refuse.
export async function runTimed(
    ctx: RunContext,
    reviewer: ReviewerId,
    decide: () => Promise<Verdict>,
): Promise<ReviewerFile> {
    const start = ctx.now();
    let verdict: Verdict;
    try {
        verdict = await decide();
    } catch (error) {
        verdict = { skip: `${reviewer} runner failed: ${messageOf(error)}` };
    }
    const durationMs = Math.max(0, ctx.now() - start);
    if ("skip" in verdict) {
        return skippedFile(reviewer, verdict.skip, durationMs);
    }
    const file: ReviewerFile = {
        schema: FINDING_SCHEMA,
        reviewer,
        outcome: "reported",
        durationMs,
        items: verdict.items,
        // Written only when non-empty.
        ...(verdict.dropped === undefined || verdict.dropped.length === 0
            ? {}
            : { dropped: verdict.dropped }),
    };
    const parsed = parseReviewerFile(file);
    return parsed.ok
        ? parsed.value
        : skippedFile(reviewer, `${reviewer} output is invalid: ${parsed.error}`, durationMs);
}
