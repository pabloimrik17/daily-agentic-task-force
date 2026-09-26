import type { RunArgs } from "../args.ts";
import { type AutonomousConfig, CONFIG_SCHEMA, type ConfigLoad, type Source } from "../config.ts";
import { NOW } from "../quota-gate/test-fixtures.ts";
import type { RunContext } from "../runner.ts";
import type { JudgementExec, JudgementRequest, JudgementResult } from "./judgement.ts";
import type { Tracker, TrackerResult, TrackerTask, Trackers } from "./trackers/tracker.ts";

export function config(): AutonomousConfig {
    return {
        schema: CONFIG_SCHEMA,
        sources: {
            linear: { enabled: true, scope: "personal" },
            beads: { enabled: true, directory: "/repo", aliases: { work: ["nazaries"] } },
            github: { enabled: true, repos: ["owner/repo"] },
        },
        judgement: {
            model: "claude-sonnet-5",
            effort: "medium",
            threshold: 0.95,
            cap: 25,
            batch: 20,
        },
    };
}

export function task(
    source: Source,
    id: string,
    labels: string[],
    overrides: Partial<TrackerTask> = {},
): TrackerTask {
    return {
        source,
        id,
        title: `Task ${id}`,
        description: source === "linear" ? null : `About ${id}`,
        labels,
        status: "open",
        updatedAt: "2026-09-20T10:00:00Z",
        ...overrides,
    };
}

interface FakeOptions {
    descriptions?: Record<string, string>; // what readTask fills in for a task listed without one
    readErrors?: Record<string, string>;
    addLabelError?: string;
}

// A tracker over an in-memory listing: addLabel really adds, so readTask reads
// the write back. `tasks` as a string makes listTasks fail with it.
function fakeTracker(
    source: Source,
    tasks: TrackerTask[] | string,
    calls: string[],
    options: FakeOptions = {},
): Tracker {
    const labels = new Map(
        typeof tasks === "string" ? [] : tasks.map((t) => [t.id, [...t.labels]]),
    );
    const find = (id: string) =>
        typeof tasks === "string" ? undefined : tasks.find((t) => t.id === id);
    return {
        source,
        labelScopes: [],
        createsLabels: false,
        listTasks: () => {
            calls.push(`${source}:listTasks`);
            return Promise.resolve(
                typeof tasks === "string"
                    ? { ok: false, error: tasks }
                    : { ok: true, value: tasks },
            );
        },
        readTask: (id) => {
            calls.push(`${source}:readTask:${id}`);
            const listed = find(id);
            const error = options.readErrors?.[id];
            if (error !== undefined || listed === undefined) {
                return Promise.resolve({ ok: false, error: error ?? `${id} not found` });
            }
            const description = options.descriptions?.[id] ?? listed.description;
            return Promise.resolve({
                ok: true,
                value: { ...listed, description, labels: labels.get(id) ?? [] },
            });
        },
        addLabel: (id, label) => {
            calls.push(`${source}:addLabel:${id}:${label}`);
            if (options.addLabelError !== undefined) {
                return Promise.resolve({ ok: false, error: options.addLabelError });
            }
            labels.set(id, [...(labels.get(id) ?? []), label]);
            return Promise.resolve({ ok: true, value: undefined });
        },
        listLabels: () => Promise.resolve({ ok: true, value: [] }),
        createLabel: (): Promise<TrackerResult<void>> =>
            Promise.reject(new Error("the triage never creates labels")),
    };
}

export function trackers(
    calls: string[],
    listings: Partial<Record<Source, TrackerTask[] | string>>,
    options: Partial<Record<Source, FakeOptions>> = {},
): Trackers {
    const of = (source: Source) =>
        fakeTracker(source, listings[source] ?? [], calls, options[source]);
    return { beads: of("beads"), github: of("github"), linear: of("linear") };
}

export function fakeJudgement(
    answer: (request: JudgementRequest) => JudgementResult,
): JudgementExec & { requests: JudgementRequest[] } {
    const requests: JudgementRequest[] = [];
    const exec = (request: JudgementRequest) => {
        requests.push(request);
        return Promise.resolve(answer(request));
    };
    return Object.assign(exec, { requests });
}

const noJudgement = () => fakeJudgement(() => ({ ok: false, error: "judgement was not expected" }));

export function triageContext(options: {
    config?: ConfigLoad | AutonomousConfig;
    trackers: Trackers;
    judgement?: JudgementExec;
    args?: Partial<RunArgs>;
}): RunContext {
    const given = options.config ?? config();
    const load: ConfigLoad =
        "schema" in given
            ? { ok: true, path: "/home/me/.config/autonomous/config.json", config: given }
            : given;
    return {
        args: {
            account: undefined,
            force: false,
            json: false,
            apply: false,
            bootstrapLabels: false,
            ...options.args,
        },
        now: NOW,
        config: load,
        io: {
            openUsage: () => Promise.reject(new Error("the triage never reads OpenUsage")),
            trackers: () => options.trackers,
            judgement: options.judgement ?? noJudgement(),
        },
    };
}
