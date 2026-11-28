import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type AttemptId, attemptId, type AttemptRecord, type TaskRef } from "../attempts/record.ts";
import { attemptDir, receiptPath, writeJsonAtomic, writeRecord } from "../attempts/state.ts";
import { record, tempState } from "../attempts/test-fixtures.ts";
import type { ExecResult } from "../exec.ts";
import type { CheckRun, PullRequests } from "../pull-request/port.ts";
import {
    digestOf,
    FINDINGS_FILE,
    PUBLISH_RECEIPT_SCHEMA,
    writePublishReceipt,
} from "../publish/receipt.ts";
import type { Result } from "../result.ts";
import type { GuardTools } from "./guards.ts";

export const BRANCH = "feature/DOT-110-implement-stage";

export const CHANGE = "add-implementation-stage";

const fail = (error: string): ExecResult => ({ ok: false, error });

// Guards that run no command: for a transition the guards never reach.
export const NO_TOOLS: GuardTools = {
    git: () => Promise.resolve(fail("unused")),
    openspecIn: () => () => Promise.resolve(fail("unused")),
    pullRequests: () => {
        throw new Error("no pull requests were expected");
    },
};

// What the workspace holds; the defaults are finished work.
export interface Work {
    completed?: number;
    total?: number;
    status?: string; // `git status --porcelain --untracked-files=normal`
    remote?: boolean; // whether origin/<branch> exists
    ahead?: number;
    fetchError?: string;
    draft?: boolean; // whether the pull request is still a draft
    readyError?: string; // the failure of marking the pull request ready
    checkRuns?: CheckRun[]; // the head commit's check runs
    checkRunsError?: string;
}

// Fake git and openspec execs that answer by their arguments and log "<command> <arguments>".
export function workTools(work: Work = {}, calls: string[] = []): GuardTools {
    const { completed = 12, total = 12, status = "", remote = true, ahead = 0 } = work;
    const git = (args: string[]): Promise<ExecResult> => {
        calls.push(`git ${args.slice(2).join(" ")}`);
        const [verb] = args.slice(2);
        const answers: Record<string, ExecResult> = {
            fetch: work.fetchError === undefined ? { ok: true, stdout: "" } : fail(work.fetchError),
            "merge-base": { ok: true, stdout: "5ca1ab1e\n" },
            diff: { ok: true, stdout: `openspec/changes/${CHANGE}/proposal.md\n` },
            status: { ok: true, stdout: status },
            "rev-parse": remote ? { ok: true, stdout: "0ddba11\n" } : fail("unknown revision"),
            "rev-list": { ok: true, stdout: `${ahead}\n` },
        };
        return Promise.resolve(answers[verb ?? ""] ?? fail(`git ${verb} was not expected`));
    };
    const listing = JSON.stringify({
        changes: [{ name: CHANGE, completedTasks: completed, totalTasks: total }],
    });
    return {
        git,
        openspecIn: () => (args) => {
            calls.push(`openspec ${args.join(" ")}`);
            return Promise.resolve({ ok: true, stdout: listing });
        },
        pullRequests: () => workPullRequests(work, calls),
    };
}

// A pull request that is not a draft, with no check run and no review, unless `work` says otherwise.
function workPullRequests(work: Work, calls: string[]): PullRequests {
    const answer = <T>(error: string | undefined, value: T): Promise<Result<T>> =>
        Promise.resolve(error === undefined ? { ok: true, value } : { ok: false, error });
    return {
        defaultBranch: () => Promise.resolve({ ok: true, value: "main" }),
        state: (number) => {
            calls.push(`pr state ${number}`);
            return answer(undefined, {
                draft: work.draft ?? false,
                head: { sha: "0ddba11", committedAt: "2026-01-01T00:00:00Z" },
                readyAt: null,
            });
        },
        ready: (number) => {
            calls.push(`pr ready ${number}`);
            return answer(work.readyError, undefined);
        },
        checkRuns: (sha) => {
            calls.push(`pr checkRuns ${sha}`);
            return answer(work.checkRunsError, work.checkRuns ?? []);
        },
        reviews: (number) => {
            calls.push(`pr reviews ${number}`);
            return answer(undefined, []);
        },
    } as Partial<PullRequests> as PullRequests;
}

// A state directory with one attempt of the task, whose workspace is a directory that exists. The
// attempt is completed, so it holds no task and awaits no receipt.
export async function stateWithWorkspace(
    task: TaskRef,
    overrides: Partial<AttemptRecord> = {},
): Promise<{ state: string; workspace: string }> {
    const state = tempState();
    const workspace = mkdtempSync(join(tmpdir(), "autonomous-workspace-"));
    const id = `${task.source}:${task.id}:implement:1` as const;
    await writeRecord(
        state,
        record({
            id,
            task: { ...task, title: "Implementation stage" },
            stage: "implement",
            state: "completed",
            workspace: {
                manager: "worktrunk",
                repository: "/w/dotfiles",
                inferredFrom: "project Dotfiles",
                branch: BRANCH,
                path: workspace,
            },
            ...overrides,
        }),
    );
    return { state, workspace };
}

export const FINDINGS = '{"schema":"autonomous.findings.v1","entries":[]}\n';

export interface Reviewed {
    persisted?: boolean; // the persistence receipt
    findings?: string | null; // the bytes of findings.json; null writes none
    published?: string | null; // the digest published.json names; null writes none
}

// A state directory with a started attempt of the task at `code-review`, whose workspace is a
// directory that exists. By default it is persisted, holds a record and has published exactly it.
export async function stateInReview(
    task: TaskRef,
    reviewed: Reviewed = {},
): Promise<{ state: string; workspace: string; attempt: AttemptId; dir: string }> {
    const { persisted = true, findings = FINDINGS } = reviewed;
    const published = reviewed.published === undefined ? digestOf(FINDINGS) : reviewed.published;
    const attempt = attemptId(task, "code-review", 1);
    const made = await stateWithWorkspace(task, {
        id: attempt,
        stage: "code-review",
        state: "started",
    });
    const dir = attemptDir(made.state, attempt);
    mkdirSync(dir, { recursive: true });
    if (persisted) {
        await writeJsonAtomic(receiptPath(dir), { schema: "autonomous.persisted.v1" });
    }
    if (findings !== null) {
        writeFileSync(join(dir, FINDINGS_FILE), findings);
    }
    if (published !== null) {
        await writePublishReceipt(dir, {
            schema: PUBLISH_RECEIPT_SCHEMA,
            attempt,
            pullRequest: { number: 7, url: "https://github.com/o/r/pull/7" },
            findingsDigest: published,
            walkthroughDigest: null,
            publishedAt: "2026-11-01T09:00:00.000Z",
        });
    }
    return { ...made, attempt, dir };
}
