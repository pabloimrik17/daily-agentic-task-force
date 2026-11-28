import type { RunArgs } from "../args.ts";
import type { AutonomousConfig, ConfigLoad, Source } from "../config.ts";
import type { Exec } from "../exec.ts";
import { task, trackers, triageContext } from "../label-triage/test-fixtures.ts";
import type {
    CheckRun,
    PullRequest,
    PullRequests,
    PullRequestsFactory,
    ReviewThread,
} from "../pull-request/port.ts";
import { NOW } from "../quota-gate/test-fixtures.ts";
import type { Result } from "../result.ts";
import { HEAD, prState } from "../review-bots/test-fixtures.ts";
import type { RunContext, StepResult } from "../runner.ts";
import type { Candidate, SelectionExec, SelectionRequest, WorkReader, WorkTask } from "./types.ts";

export function workTask(
    source: Source = "linear",
    id = "TEST-1",
    labels: string[] = ["personal", "grill-me"],
    overrides: Partial<WorkTask> = {},
): WorkTask {
    return {
        ...task(source, id, labels),
        priority: "High",
        blocks: [],
        blockedBy: [],
        children: [],
        childCount: 0,
        project: null,
        repository: null,
        ...overrides,
    };
}

export function candidate(overrides: Partial<Candidate> = {}): Candidate {
    return {
        task: workTask(),
        scope: "personal",
        autonomy: null,
        stage: "grill-me",
        ...overrides,
    };
}

interface ReaderOptions {
    details?: Record<string, Partial<WorkTask>>; // what detail fills in, by task id
    detailErrors?: Record<string, string>;
}

// A reader over an in-memory listing, logging each call to `calls`. `tasks` as a
// string makes list fail with it.
export function fakeReader(
    source: Source,
    tasks: WorkTask[] | string,
    calls: string[],
    options: ReaderOptions = {},
): WorkReader {
    return {
        source,
        list: () => {
            calls.push(`${source}:list`);
            return Promise.resolve(
                typeof tasks === "string"
                    ? { ok: false, error: tasks }
                    : { ok: true, value: tasks },
            );
        },
        detail: (listed) => {
            calls.push(`${source}:detail:${listed.id}`);
            const error = options.detailErrors?.[listed.id];
            return Promise.resolve(
                error === undefined
                    ? { ok: true, value: { ...listed, ...options.details?.[listed.id] } }
                    : { ok: false, error },
            );
        },
    };
}

// `chezmoi data` printing `data` as JSON, or failing with `data` when it is a string.
export function fakeChezmoi(data: Record<string, unknown> | string, calls: string[]): Exec {
    return (args) => {
        calls.push(`chezmoi ${args.join(" ")}`);
        return Promise.resolve(
            typeof data === "string"
                ? { ok: false, error: data }
                : { ok: true, stdout: JSON.stringify(data) },
        );
    };
}

export function fakeSelection(
    answer: (request: SelectionRequest) => Awaited<ReturnType<SelectionExec>>,
): SelectionExec & { requests: SelectionRequest[] } {
    const requests: SelectionRequest[] = [];
    const exec = (request: SelectionRequest) => {
        requests.push(request);
        return Promise.resolve(answer(request));
    };
    return Object.assign(exec, { requests });
}

const PULL_REQUEST: PullRequest = {
    number: 12,
    url: "https://example.test/pull/12",
    title: "Build the feature",
};

// Eighteen minutes before the run: a review bot with no check run has 12 of its 30 minutes left.
const COMMITTED = new Date(NOW.getTime() - 18 * 60_000).toISOString();

export interface PullRequestFacts {
    found?: PullRequest | null | string; // what find answers; a string makes it fail with it
    draft?: boolean;
    readyError?: string;
    checkRuns?: CheckRun[];
    threads?: ReviewThread[];
}

// Pull requests over `facts`, logging each call to `calls` as "pr <method> <argument>". Marking a
// draft ready takes effect at the run's time, as GitHub's ReadyForReviewEvent would.
export function fakePullRequests(
    calls: string[],
    facts: PullRequestFacts = {},
): PullRequestsFactory {
    let draft = facts.draft ?? false;
    let readyAt: string | null = null;
    const answer = <T>(call: string, value: Result<T>): Promise<Result<T>> => {
        calls.push(call);
        return Promise.resolve(value);
    };
    const found = facts.found === undefined ? PULL_REQUEST : facts.found;
    const port: Partial<PullRequests> = {
        find: (branch) =>
            answer(
                `pr find ${branch}`,
                typeof found === "string"
                    ? { ok: false, error: found }
                    : { ok: true, value: found },
            ),
        state: (number) =>
            answer(`pr state ${number}`, {
                ok: true,
                value: prState({ draft, readyAt, head: { sha: HEAD, committedAt: COMMITTED } }),
            }),
        ready: (number) => {
            if (facts.readyError !== undefined) {
                return answer(`pr ready ${number}`, { ok: false, error: facts.readyError });
            }
            draft = false;
            readyAt = NOW.toISOString();
            return answer(`pr ready ${number}`, { ok: true, value: undefined });
        },
        checkRuns: (sha) =>
            answer(`pr checkRuns ${sha}`, { ok: true, value: facts.checkRuns ?? [] }),
        threads: (number) =>
            answer(`pr threads ${number}`, { ok: true, value: facts.threads ?? [] }),
        reviews: (number) => answer(`pr reviews ${number}`, { ok: true, value: [] }),
    };
    return () => port as PullRequests;
}

// A run context for the select step. Every reader, chezmoi and tracker call goes
// to `calls`; the trackers are there only to show that the step never uses them.
export function selectContext(options: {
    calls: string[];
    readers: WorkReader[];
    chezmoi?: Exec;
    selection?: SelectionExec;
    config?: ConfigLoad | AutonomousConfig;
    results?: StepResult[];
    args?: Partial<RunArgs>;
    pullRequests?: PullRequestsFactory;
    state?: string;
}): RunContext {
    const base = triageContext({
        trackers: trackers(options.calls, {}),
        ...(options.config === undefined ? {} : { config: options.config }),
        ...(options.args === undefined ? {} : { args: options.args }),
    });
    return {
        ...base,
        results: options.results ?? [],
        io: {
            ...base.io,
            chezmoi: options.chezmoi ?? fakeChezmoi({ machineType: "personal" }, options.calls),
            work: () => {
                options.calls.push("work");
                return options.readers;
            },
            selection:
                options.selection ??
                fakeSelection(() => ({ ok: false, error: "selection was not expected" })),
            pullRequests: options.pullRequests ?? base.io.pullRequests,
            state: options.state ?? base.io.state,
        },
    };
}
