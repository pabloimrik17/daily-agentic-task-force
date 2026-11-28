import { mkdirSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { vi } from "vitest";

import type { RunArgs } from "../args.ts";
import type { AutonomousConfig, ConfigLoad, Source } from "../config.ts";
import type { Exec } from "../exec.ts";
import { config, task, trackers, triageContext } from "../label-triage/test-fixtures.ts";
import type { RunContext, StepResult } from "../runner.ts";
import { STAGES } from "../stages/registry.ts";
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

// The repository every located task belongs to, under the root selectWorkspace makes.
export const REPOSITORY = "repo";

// The task with the signal its source infers `repo` from: Linear's project, GitHub's repository,
// a Beads label.
function located(listed: WorkTask): WorkTask {
    if (listed.source === "linear") {
        return { ...listed, project: REPOSITORY };
    }
    if (listed.source === "github") {
        return { ...listed, repository: `owner/${REPOSITORY}` };
    }
    return { ...listed, labels: [...listed.labels, REPOSITORY] };
}

export interface SelectWorkspace {
    root: string; // holds `repo`, a git repository with an OpenSpec root
    state: string; // an empty state directory
    remove(): Promise<void>;
}

export function selectWorkspace(): SelectWorkspace {
    const root = mkdtempSync(join(tmpdir(), "select-root-"));
    const state = mkdtempSync(join(tmpdir(), "select-state-"));
    mkdirSync(join(root, REPOSITORY, ".git"), { recursive: true });
    mkdirSync(join(root, REPOSITORY, "openspec"));
    return {
        root,
        state,
        remove: async () => {
            await Promise.all(
                [root, state].map((dir) => rm(dir, { recursive: true, force: true })),
            );
        },
    };
}

// Every registered stage's prerequisites hold; the caller restores the mocks.
export function holdPrerequisites(): void {
    for (const stage of STAGES.values()) {
        vi.spyOn(stage, "prerequisites").mockResolvedValue({ ok: true, context: {} });
    }
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

// fakeReader over located tasks.
export function locatedReader(
    source: Source,
    tasks: WorkTask[] | string,
    calls: string[],
    options: ReaderOptions = {},
): WorkReader {
    return fakeReader(
        source,
        typeof tasks === "string" ? tasks : tasks.map(located),
        calls,
        options,
    );
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
    workspace?: SelectWorkspace; // its root replaces the configured one, its state the state
}): RunContext {
    const base = triageContext({
        trackers: trackers(options.calls, {}),
        ...configOf(options.config, options.workspace),
        ...(options.args === undefined ? {} : { args: options.args }),
    });
    return {
        ...base,
        results: options.results ?? [],
        io: {
            ...base.io,
            ...(options.workspace === undefined ? {} : inertStageReaders(options.workspace)),
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

function configOf(
    given: ConfigLoad | AutonomousConfig | undefined,
    workspace: SelectWorkspace | undefined,
): { config?: ConfigLoad | AutonomousConfig } {
    if (workspace === undefined) {
        return given === undefined ? {} : { config: given };
    }
    const settings = given ?? config();
    return "schema" in settings
        ? { config: { ...settings, workspace: { root: workspace.root } } }
        : { config: settings };
}

// The readers a stage environment is built with; the stages' prerequisites are mocked, so none is
// ever read.
function inertStageReaders({ state }: SelectWorkspace): Partial<RunContext["io"]> {
    const unread = () => Promise.reject(new Error("select's mocked prerequisites read nothing"));
    const reader = (source: Source) => ({ source, read: unread });
    return {
        state,
        context: () => ({
            beads: reader("beads"),
            github: reader("github"),
            linear: reader("linear"),
        }),
        pullRequests: () =>
            new Proxy({} as ReturnType<RunContext["io"]["pullRequests"]>, { get: () => unread }),
    };
}
