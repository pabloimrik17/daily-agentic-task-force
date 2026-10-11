import type { RunArgs } from "../args.ts";
import type { AutonomousConfig, ConfigLoad, Source } from "../config.ts";
import type { Exec } from "../exec.ts";
import { task, trackers, triageContext } from "../label-triage/test-fixtures.ts";
import type { RunContext, StepResult } from "../runner.ts";
import type {
    Candidate,
    SelectionExec,
    SelectionRequest,
    SelectionResult,
    WorkReader,
    WorkTask,
} from "./types.ts";

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
        ...overrides,
    };
}

export function candidate(overrides: Partial<Candidate> = {}): Candidate {
    return {
        task: workTask(),
        scope: "personal",
        autonomy: "grill-me",
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
    answer: (request: SelectionRequest) => SelectionResult,
): SelectionExec & { requests: SelectionRequest[] } {
    const requests: SelectionRequest[] = [];
    const exec = (request: SelectionRequest) => {
        requests.push(request);
        return Promise.resolve(answer(request));
    };
    return Object.assign(exec, { requests });
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
        },
    };
}
