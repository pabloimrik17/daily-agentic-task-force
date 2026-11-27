import {
    copyFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import type { Answer } from "./args.ts";
import { fakeSessions, fakeWorkspace, record, tempState } from "./attempts/test-fixtures.ts";
import {
    attemptDir,
    logbookEntryPath,
    logbookReceiptPath,
    receiptPath,
    recordPath,
    writeRecord,
} from "./attempts/state.ts";
import { capacityStep } from "./capacity/step.ts";
import { type AutonomousConfig, CONFIG_SCHEMA, EXAMPLE_PATH } from "./config.ts";
import type { ContextReader } from "./context/types.ts";
import { COLOURS, LABELS } from "./label-contract/contract.ts";
import type { TriageQuestionsReport } from "./label-triage/questions-mode.ts";
import {
    config,
    fakeJudgement,
    inertDocumentMethods,
    task,
    trackers,
} from "./label-triage/test-fixtures.ts";
import type {
    Tracker,
    TrackerLabel,
    TrackerResult,
    TrackerTask,
    Trackers,
} from "./label-triage/trackers/tracker.ts";
import {
    type AttemptOptions,
    type DocumentScript,
    fakeDocuments,
    startAttempt,
    trackersWith,
} from "./persist/test-fixtures.ts";
import type { ExecResult } from "./exec.ts";
import type { PullRequests, ReviewThread } from "./pull-request/port.ts";
import { FINDINGS_FILE, PUBLISH_RECEIPT_FILE } from "./publish/receipt.ts";
import { CHANGE, DIFF, finding, recordText } from "./publish/test-fixtures.ts";
import { openUsageSource } from "./quota-gate/openusage.ts";
import {
    ANA,
    fakeExec,
    fakeLogin,
    limits,
    NOW,
    provider,
    session,
    weekly,
} from "./quota-gate/test-fixtures.ts";
import { main, type MainDeps } from "./run.ts";
import type {
    AnswerContext,
    AnswerRecord,
    AnswerStatus,
    HandoffQuestion,
    Step,
    StepOutcome,
} from "./runner.ts";
import { fakeChezmoi, fakeReader, fakeSelection, workTask } from "./select/test-fixtures.ts";
import type { SelectData } from "./select/types.ts";

function fakeStep(outcome: StepOutcome): Step<{ value: number }> {
    return {
        id: "fake",
        run: () =>
            Promise.resolve({
                step: "fake",
                tier: "code",
                outcome,
                reasons: ["because"],
                data: { value: 42 },
            }),
        render: (result) => `[fake] ${result.outcome} value=${result.data.value}`,
    };
}

const STATES: string[] = [];
afterAll(() => {
    for (const dir of STATES) {
        rmSync(dir, { recursive: true, force: true });
    }
});

function state(): string {
    const dir = tempState();
    STATES.push(dir);
    return dir;
}

const inertContext: ContextReader = {
    source: "linear",
    read: () => Promise.resolve({ ok: false, error: "unused" }),
};

const inertPullRequests = new Proxy({} as PullRequests, {
    get: () => () => Promise.resolve({ ok: false, error: "unused" }),
});

// The run lock (design D12) of every run whose env does not name its own state.
const STATE = state();

// A state directory whose lock this live process holds, as another run would.
function heldLock(): { dir: string; error: string } {
    const dir = state();
    const startedAt = "2026-10-17T08:59:00.000Z";
    writeFileSync(join(dir, "run.lock"), JSON.stringify({ pid: process.pid, startedAt }));
    const error = `another run holds ${join(dir, "run.lock")} (pid ${process.pid}, started ${startedAt})`;
    return { dir, error };
}

const ABSENT_CONFIG = join(tmpdir(), "autonomous-run-absent", "config.json");
const ABSENT_HOME = join(tmpdir(), "autonomous-run-absent", "home");

// `steps` undefined runs the real STEPS. Unless the override names them, the
// env points AUTONOMOUS_CONFIG at a missing file, AUTONOMOUS_STATE at a
// temporary directory and HOME at a missing directory, so no test reads the
// user's own configuration, state or installed plugins.
function deps(steps: readonly Step[] | undefined, overrides: Partial<MainDeps> = {}) {
    const out: string[] = [];
    const err: string[] = [];
    const d: MainDeps = {
        now: () => NOW,
        env: {},
        quota: { read: () => Promise.resolve({ ok: false, error: "unused" }) },
        login: () => Promise.resolve({ ok: false, error: "unused" }),
        trackers: () => {
            throw new Error("unused");
        },
        judgement: () => Promise.resolve({ ok: false, error: "unused" }),
        chezmoi: () => Promise.resolve({ ok: false, error: "unused" }),
        work: () => {
            throw new Error("unused");
        },
        selection: () => Promise.resolve({ ok: false, error: "unused" }),
        sessions: () => {
            throw new Error("unused");
        },
        workspace: () => {
            throw new Error("unused");
        },
        naming: () => Promise.resolve({ ok: false, error: "unused" }),
        // Launch builds the stage's readers before its prerequisites, so these are inert.
        pullRequests: () => inertPullRequests,
        context: () => ({ beads: inertContext, github: inertContext, linear: inertContext }),
        openspec: () => Promise.resolve({ ok: false, error: "unused" }),
        openspecIn: () => () => Promise.resolve({ ok: false, error: "unused" }),
        git: () => Promise.resolve({ ok: false, error: "unused" }),
        plannotatorIn: () => () => Promise.resolve({ ok: false, error: "unused" }),
        stdout: (t) => out.push(t),
        stderr: (t) => err.push(t),
        wait: () => Promise.reject(new Error("wait was not expected")),
        stopSignal: () => new AbortController().signal,
        signalLoop: () => {
            throw new Error("no signal was expected");
        },
        ...(steps === undefined ? {} : { steps }),
        ...overrides,
    };
    d.env = {
        AUTONOMOUS_CONFIG: ABSENT_CONFIG,
        AUTONOMOUS_STATE: STATE,
        HOME: ABSENT_HOME,
        ...d.env,
    };
    return { d, out, err };
}

const CAPACITY = limits({ claude: provider({ session: session(20), weekly: weekly(30) }) });

// One Claude account with capacity, and Claude Code logged in as it.
const capacity = (openUsage = fakeExec(CAPACITY)) => ({
    quota: openUsageSource(openUsage),
    login: fakeLogin(ANA),
});

describe("main", () => {
    it.each<[StepOutcome, number]>([
        ["advance", 0],
        ["wait", 2],
        ["not-evaluable", 3],
    ])("exits for %s with %i", async (outcome, code) => {
        const { d } = deps([fakeStep(outcome)]);
        expect(await main([], d)).toBe(code);
    });

    it("prints one autonomous.run.v2 JSON document with --json", async () => {
        const { d, out } = deps([fakeStep("wait")]);
        await main(["--json"], d);
        expect(out).toHaveLength(1);
        expect(JSON.parse(out[0] as string)).toEqual({
            schema: "autonomous.run.v2",
            startedAt: NOW.toISOString(),
            steps: [
                {
                    step: "fake",
                    tier: "code",
                    outcome: "wait",
                    reasons: ["because"],
                    data: { value: 42 },
                },
            ],
            outcome: "wait",
        });
    });

    it("renders text through each step's renderer", async () => {
        const { d, out } = deps([fakeStep("advance")]);
        await main([], d);
        expect(out[0]).toBe(
            `autonomous run — started ${NOW.toISOString()}\noutcome: advance\n\n[fake] advance value=42`,
        );
    });

    it("prints usage and exits 1 on an unknown flag", async () => {
        const { d, out, err } = deps([fakeStep("advance")]);
        expect(await main(["--nope"], d)).toBe(1);
        expect(out).toEqual([]);
        expect(err.join("\n")).toContain("Usage: /autonomous:run");
    });

    it.each([
        ["a run", ["--account", "ana@example.com"]],
        ["the loop", ["--loop", "--apply", "--account", "claude@1a2b3c4d"]],
    ])("runs no step and exits 1 when --account is given to %s", async (_, argv) => {
        const { d, out, err } = deps([fakeStep("advance")]);
        expect(await main(argv, d)).toBe(1);
        expect(out).toEqual([]);
        expect(err.join("\n")).toContain(
            "the run evaluates the account Claude Code is logged in as",
        );
    });

    it("exits 1 when the runner itself fails", async () => {
        const broken: Step = {
            id: "broken",
            run: () => Promise.reject(new Error("boom")),
            render: () => "",
        };
        const { d, err } = deps([broken]);
        expect(await main([], d)).toBe(1);
        expect(err).toEqual(["autonomous run failed: boom"]);
    });
});

describe("main handoff", () => {
    const question = (n: number): HandoffQuestion => ({
        id: `asking:${n}`,
        step: "asking",
        header: `Q${n}`,
        question: `Question ${n}?\nWith a second line`,
        options: [
            { label: "Yes", value: "yes", description: "Say yes" },
            { label: "Later", value: null, description: "Leave it" },
        ],
        multiSelect: false,
    });

    const asking: Step = {
        id: "asking",
        run: () =>
            Promise.resolve({
                step: "asking",
                tier: "code",
                outcome: "advance",
                reasons: ["six questions"],
                data: null,
                questions: [1, 2, 3, 4, 5, 6].map(question),
            }),
        render: (result) => `[asking] ${result.outcome}`,
    };

    it("carries the first 4 questions and 2 remaining with --apply", async () => {
        const { d, out } = deps([asking]);
        expect(await main(["--apply", "--json"], d)).toBe(0);
        const report = JSON.parse(out[0] as string) as Record<string, unknown>;
        expect(report.handoff).toEqual({ questions: [1, 2, 3, 4].map(question), remaining: 2 });
        expect(report.steps).toEqual([
            {
                step: "asking",
                tier: "code",
                outcome: "advance",
                reasons: ["six questions"],
                data: null,
            },
        ]);
    });

    it.each([[[]], [["--apply", "--no-handoff"]]])("carries no handoff with %j", async (flags) => {
        const json = deps([asking]);
        await main([...flags, "--json"], json.d);
        expect(JSON.parse(json.out[0] as string)).not.toHaveProperty("handoff");

        const text = deps([asking]);
        await main(flags, text.d);
        expect(text.out[0]).not.toContain("handoff:");
    });

    it("ends the text report with the handoff as one line of JSON", async () => {
        const { d, out } = deps([asking]);
        expect(await main(["--apply"], d)).toBe(0);
        const lines = (out[0] as string).split("\n");
        const last = lines.at(-1) as string;
        expect(last.startsWith("handoff: ")).toBe(true);
        expect(JSON.parse(last.slice("handoff: ".length))).toEqual({
            questions: [1, 2, 3, 4].map(question),
            remaining: 2,
        });
        expect(out[0]).toBe(
            `autonomous run — started ${NOW.toISOString()}\noutcome: advance\n\n[asking] advance\n\n${last}`,
        );
    });
});

describe("main --bootstrap-labels", () => {
    const dir = mkdtempSync(join(tmpdir(), "autonomous-run-"));
    const configPath = join(dir, "config.json");
    writeFileSync(
        configPath,
        JSON.stringify({
            schema: CONFIG_SCHEMA,
            sources: {
                linear: { enabled: true },
                beads: { enabled: false, directory: "/repo" },
                github: { enabled: false, repos: [] },
            },
            judgement: {
                model: "claude-sonnet-5",
                effort: "medium",
                threshold: 0.95,
                cap: 25,
                batch: 20,
            },
            selection: { model: "sonnet", effort: "high" },
        }),
    );
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    const everyLabel = (differing: Record<string, string> = {}): TrackerLabel[] =>
        LABELS.map((name) => ({
            scope: "workspace",
            name,
            colour: differing[name] ?? COLOURS[name],
            id: `label-${name}`,
        }));

    function linear(
        labels: TrackerLabel[] | string,
        outcomes: { create?: TrackerResult<void>; recolour?: TrackerResult<void> } = {},
    ): Tracker {
        const unused = () => Promise.reject(new Error("unused"));
        return {
            source: "linear",
            labelScopes: ["workspace"],
            createsLabels: true,
            listTasks: unused,
            readTask: unused,
            addLabel: unused,
            removeLabel: unused,
            ...inertDocumentMethods,
            listLabels: () =>
                Promise.resolve(
                    typeof labels === "string"
                        ? { ok: false, error: labels }
                        : { ok: true, value: labels },
                ),
            createLabel: () => Promise.resolve(outcomes.create ?? { ok: true, value: undefined }),
            recolourLabel: () =>
                Promise.resolve(outcomes.recolour ?? { ok: true, value: undefined }),
        };
    }

    function bootstrapDeps(
        tracker: Tracker,
        env: Record<string, string> = { AUTONOMOUS_CONFIG: configPath },
    ) {
        const calls = { steps: 0, quota: 0 };
        const step: Step = {
            id: "counted",
            run: () => {
                calls.steps++;
                return Promise.reject(new Error("a step ran"));
            },
            render: () => "",
        };
        const result = deps([step], {
            env,
            quota: {
                read: () => {
                    calls.quota++;
                    return Promise.resolve({ ok: false, error: "unused" });
                },
            },
            // Beads and GitHub are disabled in the configuration, so only Linear is reached.
            trackers: (): Trackers => ({ beads: tracker, github: tracker, linear: tracker }),
        });
        return { ...result, calls };
    }

    it("runs only the bootstrap and prints its report", async () => {
        const { d, out, err, calls } = bootstrapDeps(linear([]));
        expect(await main(["--bootstrap-labels"], d)).toBe(0);
        expect(calls).toEqual({ steps: 0, quota: 0 });
        expect(err).toEqual([]);
        expect(out).toEqual([
            [
                `label bootstrap — started ${NOW.toISOString()}`,
                "outcome: advance",
                "  linear    workspace: created work, personal, AFK, HITL, grill-me, proposal, implement, verify, code-review, qa, external-review, wrap-up, ready-to-merge, taken, triage-me",
            ].join("\n"),
        ]);
    });

    it("prints one autonomous.bootstrap.v1 JSON document with --json", async () => {
        const { d, out } = bootstrapDeps(linear([]));
        expect(await main(["--bootstrap-labels", "--json"], d)).toBe(0);
        expect(out).toHaveLength(1);
        expect(JSON.parse(out[0] as string)).toMatchObject({
            schema: "autonomous.bootstrap.v1",
            startedAt: NOW.toISOString(),
            outcome: "advance",
            sources: [{ source: "linear", evaluable: true }],
        });
    });

    it("exits 3 when a source is not evaluable", async () => {
        const { d, out, calls } = bootstrapDeps(
            linear("linear label list --all --json: Linear CLI is not authenticated"),
        );
        expect(await main(["--bootstrap-labels"], d)).toBe(3);
        expect(calls.steps).toBe(0);
        expect(out[0]).toContain("outcome: not-evaluable");
    });

    it("exits 3 and reports the label as failed when a label cannot be created", async () => {
        const missing = everyLabel().filter((label) => label.name !== "proposal");
        const error = "linear label create -n proposal -c #bb87fc: linear failed: rate limited";
        const { d, out } = bootstrapDeps(linear(missing, { create: { ok: false, error } }));
        expect(await main(["--bootstrap-labels"], d)).toBe(3);
        expect(out).toEqual([
            [
                `label bootstrap — started ${NOW.toISOString()}`,
                "outcome: not-evaluable",
                `  linear    workspace: present work, personal, AFK, HITL, grill-me, implement, verify, code-review, qa, external-review, wrap-up, ready-to-merge, taken, triage-me; failed proposal (${error})`,
            ].join("\n"),
        ]);
    });

    it("exits 0 and reports the label as recoloured when only a colour differed", async () => {
        const { d, out, calls } = bootstrapDeps(linear(everyLabel({ AFK: "#000000" })));
        expect(await main(["--bootstrap-labels"], d)).toBe(0);
        expect(calls.steps).toBe(0);
        expect(out).toEqual([
            [
                `label bootstrap — started ${NOW.toISOString()}`,
                "outcome: advance",
                "  linear    workspace: recoloured AFK (was #000000); present work, personal, HITL, grill-me, proposal, implement, verify, code-review, qa, external-review, wrap-up, ready-to-merge, taken, triage-me",
            ].join("\n"),
        ]);
    });

    it("reports a recoloured label with status recoloured in the JSON document", async () => {
        const { d, out } = bootstrapDeps(linear(everyLabel({ AFK: "#000000" })));
        expect(await main(["--bootstrap-labels", "--json"], d)).toBe(0);
        const report = JSON.parse(out[0] as string) as {
            sources: { labels: { label: string; status: string; colour: string | null }[] }[];
        };
        expect(report.sources[0]?.labels.find((label) => label.label === "AFK")).toMatchObject({
            status: "recoloured",
            colour: "#5e6ad2",
            note: "was #000000",
        });
    });

    it("exits 3 and reports the label as failed when a recolour fails", async () => {
        const error =
            "linear api issueLabelUpdate --variable id=label-AFK: Linear did not report success";
        const { d, out } = bootstrapDeps(
            linear(everyLabel({ AFK: "#000000" }), { recolour: { ok: false, error } }),
        );
        expect(await main(["--bootstrap-labels"], d)).toBe(3);
        expect(out).toEqual([
            [
                `label bootstrap — started ${NOW.toISOString()}`,
                "outcome: not-evaluable",
                `  linear    workspace: present work, personal, HITL, grill-me, proposal, implement, verify, code-review, qa, external-review, wrap-up, ready-to-merge, taken, triage-me; failed AFK (${error})`,
            ].join("\n"),
        ]);
    });

    it("exits 3 naming the path when the configuration file is missing", async () => {
        const missing = join(dir, "absent.json");
        const { d, out, err, calls } = bootstrapDeps(linear([]), { AUTONOMOUS_CONFIG: missing });
        expect(await main(["--bootstrap-labels"], d)).toBe(3);
        expect(calls).toEqual({ steps: 0, quota: 0 });
        expect(out).toEqual([]);
        expect(err).toHaveLength(1);
        expect(err[0]).toContain(`configuration file not found at ${missing}`);
    });

    it("prints the missing configuration as one autonomous.bootstrap.v1 document with --json", async () => {
        const missing = join(dir, "absent.json");
        const { d, out, calls } = bootstrapDeps(linear([]), { AUTONOMOUS_CONFIG: missing });
        expect(await main(["--bootstrap-labels", "--json"], d)).toBe(3);
        expect(calls).toEqual({ steps: 0, quota: 0 });
        expect(out).toHaveLength(1);
        expect(JSON.parse(out[0] as string)).toEqual({
            schema: "autonomous.bootstrap.v1",
            startedAt: NOW.toISOString(),
            outcome: "not-evaluable",
            sources: [],
            config: {
                path: missing,
                error: `configuration file not found at ${missing}; create it from the example at ${EXAMPLE_PATH}`,
            },
        });
    });

    it("takes no run lock: a lock another run holds does not stop it", async () => {
        const { dir } = heldLock();
        const { d, calls } = bootstrapDeps(linear([]), {
            AUTONOMOUS_CONFIG: configPath,
            AUTONOMOUS_STATE: dir,
        });
        expect(await main(["--bootstrap-labels"], d)).toBe(0);
        expect(calls).toEqual({ steps: 0, quota: 0 });
    });

    it("exits 1 when the bootstrap itself fails", async () => {
        const broken = { ...linear([]), listLabels: () => Promise.reject(new Error("boom")) };
        const { d, err } = bootstrapDeps(broken);
        expect(await main(["--bootstrap-labels"], d)).toBe(1);
        expect(err).toEqual(["autonomous run failed: boom"]);
    });
});

describe("main --triage-questions", () => {
    const dir = mkdtempSync(join(tmpdir(), "autonomous-triage-questions-"));
    const configPath = join(dir, "config.json");
    writeFileSync(
        configPath,
        JSON.stringify({
            schema: CONFIG_SCHEMA,
            sources: {
                linear: { enabled: true },
                beads: { enabled: false, directory: "/repo" },
                github: { enabled: false, repos: [] },
            },
            judgement: {
                model: "claude-sonnet-5",
                effort: "medium",
                threshold: 0.95,
                cap: 25,
                batch: 20,
            },
            selection: { model: "sonnet", effort: "high" },
        }),
    );
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    // Six marked Linear tasks, each lacking the scope, and an unmarked one with a doubt.
    const sixMarked = [1, 2, 3, 4, 5, 6].map((n) =>
        task("linear", `DOT-${n}`, ["triage-me", "AFK", "proposal"]),
    );

    function questionsDeps(
        listing: TrackerTask[] | string,
        env: Record<string, string> = { AUTONOMOUS_CONFIG: configPath },
    ) {
        const calls: string[] = [];
        const judged = fakeJudgement(() => ({ ok: false, error: "judgement was not expected" }));
        const counts = { steps: 0, quota: 0 };
        const step: Step = {
            id: "counted",
            run: () => {
                counts.steps++;
                return Promise.reject(new Error("a step ran"));
            },
            render: () => "",
        };
        const result = deps([step], {
            env,
            quota: {
                read: () => {
                    counts.quota++;
                    return Promise.resolve({ ok: false, error: "unused" });
                },
            },
            judgement: judged,
            trackers: () => trackers(calls, { linear: listing }),
        });
        return { ...result, calls, counts, judged };
    }

    it("Marked tasks waiting: runs no step, judges nothing, writes nothing and lists six questions", async () => {
        const { d, out, calls, counts, judged } = questionsDeps([
            ...sixMarked,
            task("linear", "DOT-9", []),
        ]);
        expect(await main(["--triage-questions"], d)).toBe(0);
        expect(counts).toEqual({ steps: 0, quota: 0 });
        expect(judged.requests).toEqual([]);
        // Linear lists no description, so each marked task is read for its own; the unmarked
        // one is not, and nothing is written.
        expect(calls).toEqual([
            "linear:listTasks",
            ...sixMarked.map(({ id }) => `linear:readTask:${id}`),
        ]);
        expect(out[0]).toContain("marked: 6 tasks");
        expect(out[0]?.match(/^question /gm)).toHaveLength(6);
        expect(out[0]?.split("\n").at(-1)).toMatch(/^handoff: /);
    });

    it("Nothing marked: says there is no marked task and exits 0", async () => {
        const { d, out } = questionsDeps([task("linear", "DOT-1", ["AFK", "proposal"])]);
        expect(await main(["--triage-questions"], d)).toBe(0);
        expect(out).toEqual([
            [
                `triage questions — started ${NOW.toISOString()}`,
                "outcome: advance",
                "no marked task",
            ].join("\n"),
        ]);
    });

    it("prints one autonomous.triage-questions.v1 document with --json and a handoff of 4 with remaining 2", async () => {
        const { d, out } = questionsDeps(sixMarked);
        expect(await main(["--triage-questions", "--json"], d)).toBe(0);
        expect(out).toHaveLength(1);
        const report = JSON.parse(out[0] ?? "") as TriageQuestionsReport;
        expect(report).toMatchObject({
            schema: "autonomous.triage-questions.v1",
            outcome: "advance",
            marked: 6,
        });
        expect(report.questions).toHaveLength(6);
        expect(report.handoff?.questions).toHaveLength(4);
        expect(report.handoff?.remaining).toBe(2);
    });

    it("Source unreachable: the reason names Linear and the command, no question, exit 3", async () => {
        const { d, out } = questionsDeps("linear issue query --json: linear failed: unreachable");
        expect(await main(["--triage-questions"], d)).toBe(3);
        expect(out[0]).toContain("outcome: not-evaluable");
        expect(out[0]).toContain("reason: linear: linear issue query --json");
        expect(out[0]).not.toContain("question ");
    });

    it("exits 3 with the error on stderr when the configuration cannot be loaded", async () => {
        const missing = join(dir, "absent.json");
        const { d, out, err, calls } = questionsDeps([], { AUTONOMOUS_CONFIG: missing });
        expect(await main(["--triage-questions"], d)).toBe(3);
        expect(err).toHaveLength(1);
        expect(err[0]).toContain(missing);
        expect(out).toEqual([]);
        expect(calls).toEqual([]);
    });

    it("prints the missing configuration as one autonomous.triage-questions.v1 document with --json", async () => {
        const missing = join(dir, "absent.json");
        const { d, out } = questionsDeps([], { AUTONOMOUS_CONFIG: missing });
        expect(await main(["--triage-questions", "--json"], d)).toBe(3);
        expect(JSON.parse(out[0] ?? "")).toMatchObject({
            schema: "autonomous.triage-questions.v1",
            outcome: "not-evaluable",
            questions: [],
        });
    });

    it("takes no lock: another run holding it does not stop the mode", async () => {
        const { dir: held } = heldLock();
        const { d } = questionsDeps(sixMarked, {
            AUTONOMOUS_CONFIG: configPath,
            AUTONOMOUS_STATE: held,
        });
        expect(await main(["--triage-questions"], d)).toBe(0);
    });

    it("Combined with apply: prints a usage message and exits 1 without reading a tracker", async () => {
        const { d, err, calls } = questionsDeps(sixMarked);
        expect(await main(["--triage-questions", "--apply"], d)).toBe(1);
        expect(err[0]).toContain("--triage-questions can only be combined with --json");
        expect(calls).toEqual([]);
    });

    it("exits 1 when the mode itself fails", async () => {
        const { d, err } = questionsDeps([]);
        d.trackers = () => {
            throw new Error("boom");
        };
        expect(await main(["--triage-questions"], d)).toBe(1);
        expect(err).toEqual(["autonomous run failed: boom"]);
    });
});

describe("main with the real steps", () => {
    const dir = mkdtempSync(join(tmpdir(), "autonomous-steps-"));
    const configPath = join(dir, "config.json");
    copyFileSync(EXAMPLE_PATH, configPath);
    // The example's workspace root, under the HOME of these runs: launch infers the repository
    // before the stage's prerequisites.
    mkdirSync(join(dir, "WebstormProjects", "dotfiles", ".git"), { recursive: true });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    function empty(source: Tracker["source"]): Tracker {
        const unused = () => Promise.reject(new Error("unused"));
        return {
            source,
            labelScopes: [],
            createsLabels: false,
            listTasks: () => Promise.resolve({ ok: true, value: [] }),
            readTask: unused,
            addLabel: unused,
            removeLabel: unused,
            ...inertDocumentMethods,
            listLabels: unused,
            createLabel: unused,
            recolourLabel: unused,
        };
    }

    it("stops at reconcile without a configuration file, reporting the missing file", async () => {
        const missing = join(dir, "absent.json");
        const { d, out } = deps(undefined, {
            env: { AUTONOMOUS_CONFIG: missing },
            ...capacity(),
        });
        expect(await main(["--json"], d)).toBe(3);
        const report = JSON.parse(out[0] as string) as {
            outcome: string;
            steps: { step: string; outcome: string; reasons: string[] }[];
        };
        expect(report.outcome).toBe("not-evaluable");
        expect(report.steps.map((s) => [s.step, s.outcome])).toEqual([
            ["reconcile", "not-evaluable"],
        ]);
        expect(report.steps[0]?.reasons).toEqual([
            `configuration file not found at ${missing}; create it from the example at ${EXAMPLE_PATH}`,
        ]);
    });

    // Two in-scope grill-me candidates for the select step; the LLM picks DOT-120.
    function selecting(calls: string[]) {
        const selection = fakeSelection(() => ({
            ok: true,
            answer: {
                source: "linear",
                id: "DOT-120",
                explanation: "It unblocks two tasks.",
                exception: null,
            },
        }));
        return {
            chezmoi: fakeChezmoi({ machineType: "personal" }, calls),
            work: () => [
                fakeReader("beads", [workTask("beads", "B-7", ["personal", "grill-me"])], calls),
                fakeReader(
                    "linear",
                    [
                        workTask("linear", "DOT-120", ["personal", "HITL", "grill-me"], {
                            project: "Dotfiles",
                        }),
                    ],
                    calls,
                ),
            ],
            selection,
        };
    }

    const emptyTrackers = (): Trackers => ({
        beads: empty("beads"),
        github: empty("github"),
        linear: empty("linear"),
    });

    // A home without Claude Code's plugin registry, so launch waits on the grill-me prerequisites.
    it("runs the five steps with the example configuration, launch waiting on the stage", async () => {
        let judged = 0;
        const calls: string[] = [];
        const { d, out, err } = deps(undefined, {
            env: { AUTONOMOUS_CONFIG: configPath, HOME: dir },
            ...capacity(),
            trackers: emptyTrackers,
            judgement: () => {
                judged++;
                return Promise.resolve({ ok: false, error: "unused" });
            },
            ...selecting(calls),
        });
        expect(await main([], d)).toBe(2);
        expect(err).toEqual([]);
        expect(judged).toBe(0);
        const text = out[0] as string;
        expect(text).toContain("outcome: wait");
        expect(text).toContain("[reconcile] advance (code)");
        expect(text).toContain("[capacity] advance (code)");
        expect(text).toContain("[quota-gate] advance (code)");
        expect(text).toContain("[label-triage] advance (code)");
        expect(text).toContain("[select] advance (llm)");
        expect(text).toContain("[launch] wait (code)");
        expect(text).toContain(
            `cannot read the plugin registry ${join(dir, ".claude", "plugins", "installed_plugins.json")}`,
        );
    });

    it("runs reconcile, capacity, quota-gate, label-triage, select and launch, in that order", async () => {
        const { d, out } = deps(undefined, {
            env: { AUTONOMOUS_CONFIG: configPath, HOME: dir },
            ...capacity(),
            trackers: emptyTrackers,
            ...selecting([]),
        });
        await main(["--json"], d);
        const report = JSON.parse(out[0] as string) as { steps: { step: string }[] };
        expect(report.steps.map((s) => s.step)).toEqual([
            "reconcile",
            "capacity",
            "quota-gate",
            "label-triage",
            "select",
            "launch",
        ]);
    });

    it("runs reconcile, capacity, quota-gate and launch with --task", async () => {
        const { d, out } = deps(undefined, {
            env: { AUTONOMOUS_CONFIG: configPath, HOME: dir },
            ...capacity(),
            trackers: emptyTrackers,
            ...selecting([]),
        });
        await main(["--json", "--task", "beads:B-7"], d);
        const report = JSON.parse(out[0] as string) as { steps: { step: string }[] };
        expect(report.steps.map((s) => s.step)).toEqual([
            "reconcile",
            "capacity",
            "quota-gate",
            "launch",
        ]);
    });

    it("does not run the select step when label-triage is not evaluable because bd cannot be executed", async () => {
        const calls: string[] = [];
        const { d, out } = deps(undefined, {
            env: { AUTONOMOUS_CONFIG: configPath, HOME: dir },
            ...capacity(),
            trackers: () => trackers(calls, { beads: "bd list --json: bd CLI not found on PATH" }),
            ...selecting(calls),
        });
        expect(await main(["--json"], d)).toBe(3);
        const report = JSON.parse(out[0] as string) as {
            steps: { step: string; outcome: string }[];
        };
        expect(report.steps.map((s) => [s.step, s.outcome])).toEqual([
            ["reconcile", "advance"],
            ["capacity", "advance"],
            ["quota-gate", "advance"],
            ["label-triage", "not-evaluable"],
        ]);
        expect(calls).toEqual(["beads:listTasks"]);
    });

    it("writes nothing and carries no question from the select step with --apply", async () => {
        const calls: string[] = [];
        const { d, out } = deps(undefined, {
            env: { AUTONOMOUS_CONFIG: configPath, HOME: dir },
            ...capacity(),
            // Every listed task is complete, so label-triage has nothing to write or ask either.
            trackers: () =>
                trackers(calls, { beads: [task("beads", "B-7", ["personal", "grill-me"])] }),
            ...selecting(calls),
        });
        expect(await main(["--apply", "--json"], d)).toBe(2);
        const report = JSON.parse(out[0] as string) as Record<string, unknown>;
        expect(report.outcome).toBe("wait");
        expect(report).not.toHaveProperty("handoff");
        expect(calls.filter((call) => call.includes(":addLabel:"))).toEqual([]);
    });

    it("carries the select step's data in the --json report", async () => {
        const calls: string[] = [];
        const { d, out } = deps(undefined, {
            env: { AUTONOMOUS_CONFIG: configPath, HOME: dir },
            ...capacity(),
            trackers: emptyTrackers,
            ...selecting(calls),
        });
        expect(await main(["--json"], d)).toBe(2);
        const report = JSON.parse(out[0] as string) as {
            steps: { step: string; tier: string; outcome: string; data: unknown }[];
        };
        const select = report.steps[4];
        expect(select?.step).toBe("select");
        expect(select?.tier).toBe("llm");
        expect(select?.data).toEqual({
            machineScope: "personal",
            selected: {
                source: "linear",
                id: "DOT-120",
                title: "Task DOT-120",
                stage: "grill-me",
                autonomy: "HITL",
                scope: "personal",
                explanation: "It unblocks two tasks.",
                exception: null,
            },
            candidates: [
                {
                    source: "beads",
                    id: "B-7",
                    title: "Task B-7",
                    scope: "personal",
                    stage: "grill-me",
                },
                {
                    source: "linear",
                    id: "DOT-120",
                    title: "Task DOT-120",
                    scope: "personal",
                    stage: "grill-me",
                },
            ],
            setAside: [],
            excluded: [],
            notEvaluated: ["github: dependencies"],
            comparison: { model: "sonnet", effort: "high" },
            readyToClose: [],
        } satisfies SelectData);
    });

    it("prints an autonomous.run.v2 document that names no entry group with --json", async () => {
        const calls: string[] = [];
        const { d, out } = deps(undefined, {
            env: { AUTONOMOUS_CONFIG: configPath, HOME: dir },
            ...capacity(),
            trackers: emptyTrackers,
            ...selecting(calls),
        });
        expect(await main(["--json"], d)).toBe(2);
        expect(out).toHaveLength(1);
        expect(JSON.parse(out[0] as string)).toMatchObject({ schema: "autonomous.run.v2" });
        expect(out[0]).not.toMatch(/"entry"/);
    });
});

describe("main --answer", () => {
    const dir = mkdtempSync(join(tmpdir(), "autonomous-answers-"));
    const configPath = join(dir, "config.json");
    // The workspace holds the repository B-2 names, as launch infers it before the prerequisites.
    mkdirSync(join(dir, "dotfiles", ".git"), { recursive: true });
    // Only Beads is enabled, so the round at the end reads a single source.
    const settings: AutonomousConfig = {
        ...config(),
        workspace: { root: dir },
        sources: {
            linear: { enabled: false },
            beads: { enabled: true, directory: "/repo" },
            github: { enabled: false, repos: [] },
        },
    };
    writeFileSync(configPath, JSON.stringify(settings));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    const records = (answers: readonly Answer[], status: AnswerStatus): AnswerRecord[] =>
        answers.map((answer) => ({
            id: answer.id,
            labels: answer.values,
            status,
            detail: `${status} by the fake`,
        }));

    type Respond = NonNullable<Step["answer"]>;

    // A step that takes answers. Both of its entry points log to `log`, an
    // answer call in the `--answer` syntax.
    function answering(
        id: string,
        log: string[],
        respond: Respond = (answers) => Promise.resolve(records(answers, "applied")),
    ): Step {
        return {
            id,
            run: () => {
                log.push(`${id}:run`);
                return Promise.reject(new Error(`${id} ran`));
            },
            render: () => "",
            answer: (answers, ctx) => {
                const given = answers.map((answer) => `${answer.id}=${answer.values.join(",")}`);
                log.push(`${id}:answer ${given.join(" ")}`);
                return respond(answers, ctx);
            },
        };
    }

    function silent(log: string[]): Step {
        return {
            id: "silent",
            run: () => {
                log.push("silent:run");
                return Promise.reject(new Error("silent ran"));
            },
            render: () => "",
        };
    }

    function answerDeps(
        log: string[],
        steps: readonly Step[],
        env: Record<string, string> = { AUTONOMOUS_CONFIG: configPath },
    ) {
        const fake = trackers([], {});
        const result = deps(steps, {
            env,
            quota: {
                read: () => {
                    log.push("quota");
                    return Promise.resolve({ ok: false, error: "unused" });
                },
            },
            judgement: () => {
                log.push("judgement");
                return Promise.resolve({ ok: false, error: "unused" });
            },
            trackers: () => {
                log.push("trackers");
                return fake;
            },
        });
        return { ...result, fake };
    }

    const answerArgs = (...answers: string[]) => answers.flatMap((a) => ["--answer", a]);

    const reportOf = (out: string[]) =>
        JSON.parse(out[0] as string) as { outcome: string; answers: AnswerRecord[] };

    it("applies the answers through their step without running a step, OpenUsage or the judgement", async () => {
        const log: string[] = [];
        const seen: AnswerContext[] = [];
        const triage = answering("triage", log, (answers, ctx) => {
            seen.push(ctx);
            return Promise.resolve(records(answers, "applied"));
        });
        const { d, out, err, fake } = answerDeps(log, [triage, silent(log)]);
        expect(await main(["--apply", ...answerArgs("triage:B-1:autonomy=HITL")], d)).toBe(0);
        expect(log).toEqual(["trackers", "triage:answer triage:B-1:autonomy=HITL"]);
        expect(seen).toHaveLength(1);
        expect(seen[0]?.config).toEqual(settings);
        expect(seen[0]?.trackers).toBe(fake);
        expect(err).toEqual([]);
        expect(out).toHaveLength(1);
    });

    it("takes no run lock: a lock another run holds does not stop it", async () => {
        const log: string[] = [];
        const { dir } = heldLock();
        const { d } = answerDeps(log, [answering("triage", log)], {
            AUTONOMOUS_CONFIG: configPath,
            AUTONOMOUS_STATE: dir,
        });
        expect(await main(["--apply", ...answerArgs("triage:B-1:autonomy=HITL")], d)).toBe(0);
        expect(log).toEqual(["trackers", "triage:answer triage:B-1:autonomy=HITL"]);
    });

    it("prints usage and exits 1 for an answer without --apply", async () => {
        const log: string[] = [];
        const { d, out, err } = answerDeps(log, [answering("triage", log)]);
        expect(await main(answerArgs("triage:B-1:autonomy=HITL"), d)).toBe(1);
        expect(out).toEqual([]);
        expect(err.join("\n")).toContain("--answer requires --apply");
        expect(err.join("\n")).toContain("Usage: /autonomous:run");
        expect(log).toEqual([]);
    });

    it("rejects an answer to a step that takes none and still processes the others", async () => {
        const log: string[] = [];
        const { d, out } = answerDeps(log, [answering("triage", log), silent(log)]);
        const argv = [
            "--apply",
            "--json",
            ...answerArgs("nope:1=HITL", "triage:2=AFK", "silent:3=HITL"),
        ];
        expect(await main(argv, d)).toBe(3);
        expect(log).toEqual(["trackers", "triage:answer triage:2=AFK"]);
        expect(reportOf(out)).toEqual({
            schema: "autonomous.answers.v1",
            startedAt: NOW.toISOString(),
            outcome: "not-evaluable",
            answers: [
                {
                    id: "nope:1",
                    labels: ["HITL"],
                    status: "rejected",
                    detail: "no step nope takes answers",
                },
                {
                    id: "triage:2",
                    labels: ["AFK"],
                    status: "applied",
                    detail: "applied by the fake",
                },
                {
                    id: "silent:3",
                    labels: ["HITL"],
                    status: "rejected",
                    detail: "no step silent takes answers",
                },
            ],
        });
    });

    it("calls each step once with its answers and reports them in input order", async () => {
        const log: string[] = [];
        // `first` hands its records back reversed: they are matched to the answers by id.
        const first = answering("first", log, (answers) =>
            Promise.resolve(records(answers, "applied").reverse()),
        );
        const { d, out } = answerDeps(log, [answering("second", log), first]);
        const argv = [
            "--apply",
            "--json",
            ...answerArgs("first:1=AFK", "second:2=HITL", "first:3=HITL"),
        ];
        expect(await main(argv, d)).toBe(0);
        expect(log).toEqual([
            "trackers",
            "first:answer first:1=AFK first:3=HITL",
            "second:answer second:2=HITL",
        ]);
        expect(reportOf(out).answers.map((record) => [record.id, record.labels])).toEqual([
            ["first:1", ["AFK"]],
            ["second:2", ["HITL"]],
            ["first:3", ["HITL"]],
        ]);
    });

    it.each<[AnswerStatus, number, string]>([
        ["applied", 0, "advance"],
        ["skipped", 0, "advance"],
        ["rejected", 3, "not-evaluable"],
        ["failed", 3, "not-evaluable"],
    ])("exits for an answer %s by its step with %i", async (status, code, outcome) => {
        const log: string[] = [];
        const triage = answering("triage", log, (answers) =>
            Promise.resolve(records(answers, status)),
        );
        const { d, out } = answerDeps(log, [triage]);
        expect(await main(["--apply", "--json", ...answerArgs("triage:1=HITL")], d)).toBe(code);
        expect(reportOf(out).outcome).toBe(outcome);
    });

    it("prints one autonomous.answers.v1 JSON document with --json and no handoff", async () => {
        const log: string[] = [];
        const { d, out, err } = answerDeps(log, [answering("triage", log)]);
        expect(
            await main(["--apply", "--json", ...answerArgs("triage:B-1:autonomy=HITL")], d),
        ).toBe(0);
        expect(err).toEqual([]);
        expect(out).toHaveLength(1);
        const report = JSON.parse(out[0] as string) as unknown;
        expect(report).toEqual({
            schema: "autonomous.answers.v1",
            startedAt: NOW.toISOString(),
            outcome: "advance",
            answers: [
                {
                    id: "triage:B-1:autonomy",
                    labels: ["HITL"],
                    status: "applied",
                    detail: "applied by the fake",
                },
            ],
        });
        expect(report).not.toHaveProperty("handoff");
    });

    it("renders one text line per answer, in input order", async () => {
        const log: string[] = [];
        const { d, out } = answerDeps(log, [answering("triage", log)]);
        expect(
            await main(["--apply", ...answerArgs("nope:1=HITL", "triage:2=AFK,grill-me")], d),
        ).toBe(3);
        expect(out).toEqual([
            [
                `autonomous answers — started ${NOW.toISOString()}`,
                "outcome: not-evaluable",
                "  rejected  nope:1 → HITL → no step nope takes answers",
                "  applied   triage:2 → AFK, grill-me → applied by the fake",
            ].join("\n"),
        ]);
    });

    it("exits 3 naming the path when the configuration file is missing", async () => {
        const missing = join(dir, "absent.json");
        const log: string[] = [];
        const { d, out, err } = answerDeps(log, [answering("triage", log)], {
            AUTONOMOUS_CONFIG: missing,
        });
        expect(await main(["--apply", ...answerArgs("triage:1=HITL")], d)).toBe(3);
        expect(log).toEqual([]);
        expect(out).toEqual([]);
        expect(err).toEqual([
            `configuration file not found at ${missing}; create it from the example at ${EXAMPLE_PATH}`,
        ]);
    });

    it("prints the missing configuration as one autonomous.answers.v1 document with --json", async () => {
        const missing = join(dir, "absent.json");
        const error = `configuration file not found at ${missing}; create it from the example at ${EXAMPLE_PATH}`;
        const log: string[] = [];
        const { d, out, err } = answerDeps(log, [answering("triage", log)], {
            AUTONOMOUS_CONFIG: missing,
        });
        expect(await main(["--apply", "--json", ...answerArgs("triage:1=HITL")], d)).toBe(3);
        expect(log).toEqual([]);
        expect(err).toEqual([error]);
        expect(out).toHaveLength(1);
        expect(JSON.parse(out[0] as string)).toEqual({
            schema: "autonomous.answers.v1",
            startedAt: NOW.toISOString(),
            outcome: "not-evaluable",
            answers: [],
            config: { path: missing, error },
        });
    });

    it("exits 1 when a step fails to answer", async () => {
        const log: string[] = [];
        const triage = answering("triage", log, () => Promise.reject(new Error("boom")));
        const { d, out, err } = answerDeps(log, [triage]);
        expect(await main(["--apply", ...answerArgs("triage:1=HITL")], d)).toBe(1);
        expect(out).toEqual([]);
        expect(err).toEqual(["autonomous run failed: boom"]);
    });

    it("exits 1 when a step leaves an answer without a record", async () => {
        const log: string[] = [];
        const triage = answering("triage", log, () => Promise.resolve([]));
        const { d, out, err } = answerDeps(log, [triage]);
        expect(await main(["--apply", ...answerArgs("triage:1=HITL")], d)).toBe(1);
        expect(out).toEqual([]);
        expect(err).toEqual(["autonomous run failed: no record for answer triage:1"]);
    });

    it("applies the answer to a question of the handoff the run before emitted", async () => {
        const calls: string[] = [];
        // One instance for both invocations, so the answer lands on what the run listed.
        const fake = trackers(calls, { beads: [task("beads", "B-1", ["work"])] });
        const judgement = fakeJudgement((request) => ({
            ok: true,
            answers: request.tasks.map((t) => ({
                id: t.id,
                autonomy: { labels: ["HITL"], confidence: 0.8, reason: "needs a decision" },
            })),
        }));
        const openUsage = fakeExec(CAPACITY);
        const shared = {
            env: { AUTONOMOUS_CONFIG: configPath, HOME: dir },
            ...capacity(openUsage),
            trackers: () => fake,
            judgement,
            // B-1 still lacks its autonomy group, so select advances on another, complete task.
            chezmoi: fakeChezmoi({ machineType: "personal" }, []),
            work: () => [
                fakeReader(
                    "beads",
                    [workTask("beads", "B-2", ["work", "grill-me", "dotfiles"])],
                    [],
                ),
            ],
        };

        // launch waits: the home holds no plugin registry for the grill-me prerequisites.
        const run = deps(undefined, shared);
        expect(await main(["--apply", "--json"], run.d)).toBe(2);
        const { handoff } = JSON.parse(run.out[0] as string) as {
            handoff?: { questions: HandoffQuestion[]; remaining: number };
        };
        expect(handoff?.remaining).toBe(0);
        expect(handoff?.questions.map((q) => q.id)).toEqual(["label-triage:beads:B-1:autonomy"]);
        const question = handoff?.questions[0];
        expect(question?.options.map((option) => option.value)).toContain("HITL");

        const listed = calls.length;
        const answer = deps(undefined, shared);
        const id = question?.id ?? "";
        expect(await main(["--apply", "--json", ...answerArgs(`${id}=HITL`)], answer.d)).toBe(0);
        expect(answer.err).toEqual([]);
        expect(JSON.parse(answer.out[0] as string)).toMatchObject({
            schema: "autonomous.answers.v1",
            outcome: "advance",
            answers: [{ id, labels: ["HITL"], status: "applied" }],
        });
        expect(openUsage.calls).toHaveLength(1);
        expect(judgement.requests).toHaveLength(1);
        expect(calls.slice(listed)).not.toContain("beads:listTasks");
        expect(await fake.beads.readTask("B-1")).toMatchObject({
            ok: true,
            value: { labels: ["work", "HITL", "proposal"] },
        });
    });
});

describe("main --transition", () => {
    const dir = mkdtempSync(join(tmpdir(), "autonomous-transition-"));
    const configPath = join(dir, "config.json");
    // Only Beads is enabled; its trackers check no label before a write.
    const settings: AutonomousConfig = {
        ...config(),
        sources: {
            linear: { enabled: false },
            beads: { enabled: true, directory: "/repo" },
            github: { enabled: false, repos: [] },
        },
    };
    writeFileSync(configPath, JSON.stringify(settings));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    const missing = join(dir, "absent.json");
    const missingError = `configuration file not found at ${missing}; create it from the example at ${EXAMPLE_PATH}`;

    function transitionDeps(
        labels: string[],
        env: Record<string, string> = { AUTONOMOUS_CONFIG: configPath },
    ) {
        const calls: string[] = [];
        const log: string[] = [];
        const fake = trackers(calls, { beads: [task("beads", "B-1", labels)] });
        const step: Step = {
            id: "fake",
            run: () => {
                log.push("fake:run");
                return Promise.reject(new Error("fake ran"));
            },
            render: () => "",
        };
        const result = deps([step], {
            env,
            quota: {
                read: () => {
                    log.push("quota");
                    return Promise.resolve({ ok: false, error: "unused" });
                },
            },
            trackers: () => {
                log.push("trackers");
                return fake;
            },
        });
        return { ...result, calls, log, fake };
    }

    const transitionArgs = (...extra: string[]) => [
        "--apply",
        "--transition",
        "beads:B-1",
        ...extra,
    ];

    interface TransitionDocument {
        schema: string;
        outcome: string;
        task: { source: string; id: string; labels: string[] } | null;
        reasons: string[];
        handoff?: { questions: HandoffQuestion[]; remaining: number };
        config?: { path: string; error: string };
    }

    const documentOf = (out: string[]) => JSON.parse(out[0] as string) as TransitionDocument;

    const answersOf = (out: string[]) =>
        (JSON.parse(out[0] as string) as { answers: AnswerRecord[] }).answers.map((record) => [
            record.id,
            record.status,
            record.detail,
        ]);

    it("Task in grill-me: exits 0, runs no step and ends the text report with the handoff", async () => {
        const { d, out, err, calls, log } = transitionDeps(["personal", "grill-me"]);
        expect(await main(transitionArgs(), d)).toBe(0);
        expect(err).toEqual([]);
        expect(out).toHaveLength(1);
        const lines = (out[0] as string).split("\n");
        expect(lines[0]).toBe(`autonomous transition — started ${NOW.toISOString()}`);
        const last = lines.at(-1) ?? "";
        expect(last.startsWith("handoff: ")).toBe(true);
        const handoff = JSON.parse(last.slice("handoff: ".length)) as {
            questions: HandoffQuestion[];
            remaining: number;
        };
        expect(handoff.questions.map((question) => question.id)).toEqual(["transition:beads:B-1"]);
        expect(log).toEqual(["trackers"]);
        expect(calls).toEqual(["beads:readTask:B-1"]);
    });

    it("passes --from on: a task not in the stage named is refused with exit 3", async () => {
        const { d, out, calls } = transitionDeps(["personal", "grill-me"]);
        expect(await main(transitionArgs("--from", "proposal", "--json"), d)).toBe(3);
        expect(documentOf(out).reasons).toEqual([
            "beads B-1 is in grill-me, not proposal (labels [personal, grill-me])",
        ]);
        expect(calls).toEqual(["beads:readTask:B-1"]);
    });

    it("takes no run lock: a lock another run holds does not stop it and is left as it was", async () => {
        const { dir: held } = heldLock();
        const lock = join(held, "run.lock");
        const before = readFileSync(lock, "utf8");
        const { d, log } = transitionDeps(["personal", "grill-me"], {
            AUTONOMOUS_CONFIG: configPath,
            AUTONOMOUS_STATE: held,
        });
        expect(await main(transitionArgs(), d)).toBe(0);
        expect(readFileSync(lock, "utf8")).toBe(before);
        expect(log).toEqual(["trackers"]);
    });

    it("Transition JSON report: one autonomous.transition.v1 document with a handoff of one question", async () => {
        const { d, out, err } = transitionDeps(["personal", "grill-me"]);
        expect(await main(transitionArgs("--json"), d)).toBe(0);
        expect(err).toEqual([]);
        expect(out).toHaveLength(1);
        const report = documentOf(out);
        expect(report).toMatchObject({
            schema: "autonomous.transition.v1",
            outcome: "advance",
            task: { source: "beads", id: "B-1", labels: ["personal", "grill-me"] },
            reasons: [],
        });
        expect(report.handoff?.questions.map((question) => question.id)).toEqual([
            "transition:beads:B-1",
        ]);
    });

    it("Task not in grill-me: exits 3 with the reason and no handoff", async () => {
        const { d, out, calls } = transitionDeps(["personal", "AFK", "external-review"]);
        expect(await main(transitionArgs("--json"), d)).toBe(3);
        const report = documentOf(out);
        expect(report.outcome).toBe("not-evaluable");
        expect(report.reasons).toEqual([
            "beads B-1 is in none of grill-me, proposal, implement, verify and code-review (labels [personal, AFK, external-review])",
        ]);
        expect(report).not.toHaveProperty("handoff");
        expect(calls).toEqual(["beads:readTask:B-1"]);
    });

    it("AFK task in proposal: applies the transition, exits 0 and carries no handoff", async () => {
        const { d, out, fake } = transitionDeps(["personal", "AFK", "proposal"], {
            AUTONOMOUS_CONFIG: configPath,
            AUTONOMOUS_STATE: dir,
        });
        expect(await main(transitionArgs("--json"), d)).toBe(0);
        const report = documentOf(out);
        expect(report).toMatchObject({ outcome: "advance", applied: true });
        expect(report).not.toHaveProperty("handoff");
        const read = await fake.beads.readTask("B-1");
        expect(read.ok ? [...read.value.labels].sort() : []).toEqual([
            "AFK",
            "implement",
            "personal",
        ]);
    });

    it("Transition without apply: prints usage and exits 1", async () => {
        const { d, out, err, log } = transitionDeps(["personal", "grill-me"]);
        expect(await main(["--transition", "beads:B-1"], d)).toBe(1);
        expect(out).toEqual([]);
        expect(err.join("\n")).toContain("--transition requires --apply");
        expect(err.join("\n")).toContain("Usage: /autonomous:run");
        expect(log).toEqual([]);
    });

    it("exits 3 naming the path when the configuration file is missing", async () => {
        const { d, out, err, log } = transitionDeps(["personal", "grill-me"], {
            AUTONOMOUS_CONFIG: missing,
        });
        expect(await main(transitionArgs(), d)).toBe(3);
        expect(out).toEqual([]);
        expect(err).toEqual([missingError]);
        expect(log).toEqual([]);
    });

    it("prints the missing configuration as one autonomous.transition.v1 document with --json", async () => {
        const { d, out, err, log } = transitionDeps(["personal", "grill-me"], {
            AUTONOMOUS_CONFIG: missing,
        });
        expect(await main(transitionArgs("--json"), d)).toBe(3);
        expect(err).toEqual([missingError]);
        expect(out).toHaveLength(1);
        expect(JSON.parse(out[0] as string)).toEqual({
            schema: "autonomous.transition.v1",
            startedAt: NOW.toISOString(),
            outcome: "not-evaluable",
            applied: false,
            task: null,
            reasons: [],
            config: { path: missing, error: missingError },
        });
        expect(log).toEqual([]);
    });

    it("Transition answer: the answer to the handoff's question applies the transition and exits 0", async () => {
        const asked = transitionDeps(["work", "HITL", "grill-me"]);
        expect(await main(transitionArgs("--json"), asked.d)).toBe(0);
        const question = documentOf(asked.out).handoff?.questions[0];
        const id = question?.id ?? "";
        expect(id).toBe("transition:beads:B-1");
        expect(question?.options.map((option) => option.value)).toEqual(["AFK", "HITL", null]);

        // A second invocation over the same fake, as the command does with the answer.
        const answered = deps([], {
            env: { AUTONOMOUS_CONFIG: configPath },
            trackers: () => asked.fake,
        });
        expect(await main(["--apply", "--json", "--answer", `${id}=AFK`], answered.d)).toBe(0);
        expect(answered.err).toEqual([]);
        expect(JSON.parse(answered.out[0] as string)).toMatchObject({
            schema: "autonomous.answers.v1",
            outcome: "advance",
            answers: [{ id, labels: ["AFK"], status: "applied" }],
        });
        const read = await asked.fake.beads.readTask("B-1");
        expect(read.ok ? [...read.value.labels].sort() : []).toEqual(["AFK", "proposal", "work"]);
    });

    it("still rejects an answer whose id names no step and not the transition", async () => {
        const { d, out } = transitionDeps(["work", "grill-me"]);
        const argv = ["--apply", "--json", "--answer", "nope:1=AFK"];
        expect(await main([...argv, "--answer", "transition:beads:B-1=HITL"], d)).toBe(3);
        expect(answersOf(out)).toEqual([
            ["nope:1", "rejected", "no step nope takes answers"],
            [
                "transition:beads:B-1",
                "applied",
                "added HITL, proposal, removed grill-me on beads B-1, read back",
            ],
        ]);
    });
});

describe("main --persist", () => {
    const dir = mkdtempSync(join(tmpdir(), "autonomous-persist-"));
    const configPath = join(dir, "config.json");
    writeFileSync(configPath, JSON.stringify(config()));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    const ATTEMPT = "linear:DOT-121:grill-me:1";

    const missing = join(dir, "absent.json");
    const missingError = `configuration file not found at ${missing}; create it from the example at ${EXAMPLE_PATH}`;

    // An attempt in a state directory of its own (or `stateDir`), a fake Linear tracker and a
    // step that fails if the mode runs it.
    async function persistDeps(
        options: AttemptOptions = {},
        script: DocumentScript = {},
        env: Record<string, string> = {},
        stateDir: string = state(),
    ) {
        await startAttempt(stateDir, options);
        const fake = fakeDocuments("linear", script);
        const log: string[] = [];
        const step: Step = {
            id: "fake",
            run: () => {
                log.push("fake:run");
                return Promise.reject(new Error("fake ran"));
            },
            render: () => "",
        };
        const result = deps([step], {
            env: { AUTONOMOUS_CONFIG: configPath, AUTONOMOUS_STATE: stateDir, ...env },
            quota: {
                read: () => {
                    log.push("quota");
                    return Promise.resolve({ ok: false, error: "unused" });
                },
            },
            trackers: () => {
                log.push("trackers");
                return trackersWith(fake);
            },
        });
        return { ...result, fake, log, stateDir };
    }

    const persistArgs = (...extra: string[]) => ["--apply", "--persist", ATTEMPT, ...extra];

    interface PersistDocument {
        schema: string;
        outcome: string;
        attempt: string;
        task: { source: string; id: string } | null;
        written: { description: boolean; comment: string };
        readBack: { description: boolean; comment: boolean };
        notes: string[];
        reasons: string[];
        receipt: string | null;
        config?: { path: string; error: string };
    }

    const documentOf = (out: string[]) => JSON.parse(out[0] as string) as PersistDocument;

    const receiptOf = (stateDir: string) => receiptPath(attemptDir(stateDir, ATTEMPT));

    it("Persisted: runs no step, writes the definition and the comment, writes the receipt and exits 0", async () => {
        const { d, out, err, log, fake, stateDir } = await persistDeps();
        expect(await main(persistArgs(), d)).toBe(0);
        expect(err).toEqual([]);
        expect(log).toEqual(["trackers"]);
        expect(out).toHaveLength(1);
        const lines = (out[0] as string).split("\n");
        expect(lines[0]).toBe(`autonomous persist — started ${NOW.toISOString()}`);
        expect(lines[1]).toBe("outcome: advance");
        expect(fake.description()).toContain("\n---\n\n## Original description\n");
        expect(fake.comments()).toHaveLength(1);
        expect(existsSync(receiptOf(stateDir))).toBe(true);
        expect(existsSync(join(stateDir, "run.lock"))).toBe(false);
    });

    it("takes no run lock: a lock another run holds does not stop it and is left as it was", async () => {
        const { dir: held } = heldLock();
        const lock = join(held, "run.lock");
        const before = readFileSync(lock, "utf8");
        const { d, log, stateDir } = await persistDeps({}, {}, {}, held);
        expect(await main(persistArgs(), d)).toBe(0);
        expect(readFileSync(lock, "utf8")).toBe(before);
        expect(log).toEqual(["trackers"]);
        expect(existsSync(receiptOf(stateDir))).toBe(true);
    });

    it("Persist JSON report: stdout holds exactly one autonomous.persist.v1 document", async () => {
        const { d, out, err, stateDir } = await persistDeps();
        expect(await main(persistArgs("--json"), d)).toBe(0);
        expect(err).toEqual([]);
        expect(out).toHaveLength(1);
        expect(documentOf(out)).toEqual({
            schema: "autonomous.persist.v1",
            startedAt: NOW.toISOString(),
            outcome: "advance",
            attempt: ATTEMPT,
            task: { source: "linear", id: "DOT-121", title: "Fix the login" },
            written: { description: true, comment: "posted" },
            readBack: { description: true, comment: true },
            notes: [],
            reasons: [],
            receipt: receiptOf(stateDir),
        });
    });

    it("Missing stage summary: writes nothing to the tracker, names the file and exits 3", async () => {
        const { d, out, fake, stateDir } = await persistDeps({ summary: null });
        expect(await main(persistArgs("--json"), d)).toBe(3);
        const report = documentOf(out);
        expect(report.outcome).toBe("not-evaluable");
        expect(report.reasons).toEqual([
            `${join(attemptDir(stateDir, ATTEMPT), "stage-summary.md")} is missing`,
        ]);
        expect(report.receipt).toBeNull();
        expect(fake.calls).toEqual([]);
        expect(existsSync(receiptOf(stateDir))).toBe(false);
    });

    it("Attempt already completed: writes nothing and exits 3", async () => {
        const { d, out, fake } = await persistDeps({ status: "completed" });
        expect(await main(persistArgs("--json"), d)).toBe(3);
        expect(documentOf(out).reasons).toEqual([`attempt ${ATTEMPT} is completed, not open`]);
        expect(fake.calls).toEqual([]);
    });

    it("an unknown attempt exits 3 and writes nothing", async () => {
        const { d, out, fake } = await persistDeps();
        expect(await main(["--apply", "--persist", "linear:DOT-999:grill-me:1", "--json"], d)).toBe(
            3,
        );
        expect(documentOf(out).reasons[0]).toContain("unknown attempt linear:DOT-999:grill-me:1");
        expect(fake.calls).toEqual([]);
    });

    it("Comment write fails: exits 3 naming the command and leaves no receipt", async () => {
        const error = "linear issue comment add DOT-121 --body-file comment.md: boom";
        const { d, out, stateDir } = await persistDeps(
            {},
            { failures: [{ method: "addComment", error }] },
        );
        expect(await main(persistArgs(), d)).toBe(3);
        expect(out).toHaveLength(1);
        expect(out[0]).toContain(`  - ${error}`);
        expect(existsSync(receiptOf(stateDir))).toBe(false);
    });

    it("Persist without apply: prints usage and exits 1", async () => {
        const { d, out, err, log } = await persistDeps();
        expect(await main(["--persist", ATTEMPT], d)).toBe(1);
        expect(out).toEqual([]);
        expect(err.join("\n")).toContain("--persist requires --apply");
        expect(err.join("\n")).toContain("Usage: /autonomous:run");
        expect(log).toEqual([]);
    });

    it("exits 3 naming the path when the configuration file is missing", async () => {
        const { d, out, err, log } = await persistDeps({}, {}, { AUTONOMOUS_CONFIG: missing });
        expect(await main(persistArgs(), d)).toBe(3);
        expect(out).toEqual([]);
        expect(err).toEqual([missingError]);
        expect(log).toEqual([]);
    });

    it("prints the missing configuration as one autonomous.persist.v1 document with --json", async () => {
        const { d, out, err, log } = await persistDeps({}, {}, { AUTONOMOUS_CONFIG: missing });
        expect(await main(persistArgs("--json"), d)).toBe(3);
        expect(err).toEqual([missingError]);
        expect(out).toHaveLength(1);
        expect(documentOf(out)).toEqual({
            schema: "autonomous.persist.v1",
            startedAt: NOW.toISOString(),
            outcome: "not-evaluable",
            attempt: ATTEMPT,
            task: null,
            written: { description: false, comment: "none" },
            readBack: { description: false, comment: false },
            notes: [],
            reasons: [],
            receipt: null,
            config: { path: missing, error: missingError },
        });
        expect(log).toEqual([]);
    });

    it("the transition that waited for the receipt asks its question once persist has run", async () => {
        const { d, stateDir, fake } = await persistDeps();
        const waiting = deps([], {
            env: { AUTONOMOUS_CONFIG: configPath, AUTONOMOUS_STATE: stateDir },
            trackers: () => trackersWith(fake),
        });
        const transition = ["--apply", "--transition", "linear:DOT-121", "--json"];
        expect(await main(transition, waiting.d)).toBe(3);
        expect(await main(persistArgs(), d)).toBe(0);
        const again = deps([], {
            env: { AUTONOMOUS_CONFIG: configPath, AUTONOMOUS_STATE: stateDir },
            trackers: () => trackersWith(fake),
        });
        expect(await main(transition, again.d)).toBe(0);
    });
});

function named(id: string, outcome: StepOutcome, log: string[], data: unknown = null): Step {
    return {
        id,
        run: () => {
            log.push(id);
            return Promise.resolve({ step: id, tier: "code", outcome, reasons: [id], data });
        },
        render: (result) => `[${id}] ${result.outcome}`,
    };
}

const FIVE = ["reconcile", "quota-gate", "label-triage", "select", "launch"];

function fakePullRequests(log: string[]): PullRequests {
    const ok = <T>(name: string, value: T) => {
        log.push(name);
        return Promise.resolve({ ok: true as const, value });
    };
    return {
        defaultBranch: () => ok("defaultBranch", "main"),
        find: () => ok("find", null),
        ahead: () => ok("ahead", 1),
        commitsSince: () => ok("commitsSince", []),
        emptyCommit: () => ok("emptyCommit", undefined),
        push: () => ok("push", undefined),
        open: ({ title }) => ok("open", { number: 7, url: "https://github.com/o/r/pull/7", title }),
        edit: () => ok("edit", undefined),
        comment: () => ok("comment", undefined),
        comments: () => ok("comments", []),
        threads: () => ok("threads", []),
        pendingReview: () => ok("pendingReview", null),
        review: () =>
            ok("review", { id: "R_1", url: "https://github.com/o/r/pull/7#pullrequestreview-1" }),
        reply: () => ok("reply", undefined),
        resolve: () => ok("resolve", undefined),
        unresolve: () => ok("unresolve", undefined),
    };
}

describe("main --pull-request", () => {
    const dir = mkdtempSync(join(tmpdir(), "autonomous-pull-request-"));
    const configPath = join(dir, "config.json");
    writeFileSync(configPath, JSON.stringify(config()));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    const ATTEMPT = "linear:DOT-121:grill-me:1";
    const TITLE = "feat(autonomous): read GitHub blockers";

    async function pullRequestDeps(options: AttemptOptions = {}, env: Record<string, string> = {}) {
        const stateDir = state();
        await startAttempt(stateDir, options);
        const log: string[] = [];
        const reader = fakeReader("linear", [workTask("linear", "DOT-121")], log);
        const result = deps([], {
            env: { AUTONOMOUS_CONFIG: configPath, AUTONOMOUS_STATE: stateDir, ...env },
            work: () => [reader],
            pullRequests: (directory) => {
                log.push(`port:${directory}`);
                return fakePullRequests(log);
            },
        });
        return { ...result, log };
    }

    it("Pull request opened: runs no step, opens the draft and exits 0", async () => {
        const { d, out, log } = await pullRequestDeps();
        expect(
            await main(["--apply", "--pull-request", ATTEMPT, "--title", TITLE, "--json"], d),
        ).toBe(0);
        expect(out).toHaveLength(1);
        const report = JSON.parse(out[0] as string) as {
            schema: string;
            pullRequest: { url: string; title: string; action: string } | null;
        };
        expect(report.schema).toBe("autonomous.pull-request.v1");
        expect(report.pullRequest).toMatchObject({
            url: "https://github.com/o/r/pull/7",
            title: `${TITLE} (DOT-121)`,
            action: "opened",
        });
        expect(log).toContain("push");
        expect(log).toContain("open");
    });

    it("Pull-request mode without apply: usage error, exit 1", async () => {
        const { d, out, err, log } = await pullRequestDeps();
        expect(await main(["--pull-request", ATTEMPT], d)).toBe(1);
        expect(out).toEqual([]);
        expect(err.join("\n")).toContain("--pull-request requires --apply");
        expect(log).toEqual([]);
    });

    it("Title without the mode: usage error, exit 1", async () => {
        const { d, err } = await pullRequestDeps();
        expect(await main(["--apply", "--title", "feat: x"], d)).toBe(1);
        expect(err.join("\n")).toContain("--title requires --pull-request");
    });

    it("Completed attempt: nothing is pushed or opened, exit 3", async () => {
        const { d, log } = await pullRequestDeps({ status: "completed" });
        expect(await main(["--apply", "--pull-request", ATTEMPT, "--title", TITLE], d)).toBe(3);
        expect(log.filter((call) => call.startsWith("port:"))).toEqual([]);
    });

    it("prints a configuration that cannot be loaded as one autonomous.pull-request.v1 document", async () => {
        const { d, out, err } = await pullRequestDeps(
            {},
            { AUTONOMOUS_CONFIG: join(dir, "absent.json") },
        );
        expect(await main(["--apply", "--pull-request", ATTEMPT, "--json"], d)).toBe(3);
        expect(err.join("\n")).toContain("configuration file not found");
        expect(out).toHaveLength(1);
        expect(JSON.parse(out[0] as string)).toMatchObject({
            schema: "autonomous.pull-request.v1",
            outcome: "not-evaluable",
            pullRequest: null,
        });
    });
});

describe("main --log", () => {
    const dir = mkdtempSync(join(tmpdir(), "autonomous-log-"));
    const configPath = join(dir, "config.json");
    writeFileSync(configPath, JSON.stringify(config()));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    const ATTEMPT = "linear:DOT-121:grill-me:1";
    const BODY = [
        "### What I did",
        "Grilled the task.",
        "### Decisions",
        "none",
        "### Assumptions",
        "none",
        "### Next stage",
        "See the stage summary.",
    ].join("\n\n");

    function openPullRequest(log: string[]): PullRequests {
        const posted: string[] = [];
        return {
            ...fakePullRequests(log),
            find: () => {
                log.push("find");
                return Promise.resolve({
                    ok: true,
                    value: { number: 7, url: "https://github.com/o/r/pull/7", title: "t" },
                });
            },
            comment: (_number, file) => {
                log.push("comment");
                posted.push(readFileSync(file, "utf8"));
                return Promise.resolve({ ok: true, value: undefined });
            },
            comments: () => Promise.resolve({ ok: true, value: [...posted] }),
        };
    }

    async function logDeps(body: string | null, env: Record<string, string> = {}) {
        const stateDir = state();
        const { dir: attempt } = await startAttempt(stateDir);
        if (body !== null) {
            writeFileSync(logbookEntryPath(attempt), body);
        }
        const log: string[] = [];
        const result = deps([], {
            env: { AUTONOMOUS_CONFIG: configPath, AUTONOMOUS_STATE: stateDir, ...env },
            trackers: () => trackersWith(fakeDocuments("linear")),
            pullRequests: () => openPullRequest(log),
        });
        return { ...result, log, attempt };
    }

    it("Entry logged: runs no step, publishes, reads back, writes the receipt and exits 0", async () => {
        const { d, out, log, attempt } = await logDeps(BODY);
        expect(await main(["--apply", "--log", ATTEMPT, "--json"], d)).toBe(0);
        expect(out).toHaveLength(1);
        expect(JSON.parse(out[0] as string)).toMatchObject({
            schema: "autonomous.log.v1",
            outcome: "advance",
            entry: "published",
            receipt: logbookReceiptPath(attempt),
        });
        expect(log.filter((call) => call === "comment")).toHaveLength(1);
        expect(existsSync(logbookReceiptPath(attempt))).toBe(true);
    });

    it("Log mode without apply: usage error, exit 1", async () => {
        const { d, out, err, log } = await logDeps(BODY);
        expect(await main(["--log", ATTEMPT], d)).toBe(1);
        expect(out).toEqual([]);
        expect(err.join("\n")).toContain("--log requires --apply");
        expect(log).toEqual([]);
    });

    it("Body file missing: nothing is published, the report names the file, exit 3", async () => {
        const { d, out, log, attempt } = await logDeps(null);
        expect(await main(["--apply", "--log", ATTEMPT, "--json"], d)).toBe(3);
        const report = JSON.parse(out[0] as string) as { reasons: string[]; receipt: unknown };
        expect(report.reasons.join("\n")).toContain(logbookEntryPath(attempt));
        expect(report.receipt).toBeNull();
        expect(log).not.toContain("comment");
    });

    it("prints a configuration that cannot be loaded as one autonomous.log.v1 document", async () => {
        const { d, out } = await logDeps(BODY, { AUTONOMOUS_CONFIG: join(dir, "absent.json") });
        expect(await main(["--apply", "--log", ATTEMPT, "--json"], d)).toBe(3);
        expect(out).toHaveLength(1);
        expect(JSON.parse(out[0] as string)).toMatchObject({
            schema: "autonomous.log.v1",
            outcome: "not-evaluable",
            receipt: null,
        });
    });
});

describe("main --publish", () => {
    const dir = mkdtempSync(join(tmpdir(), "autonomous-publish-"));
    const configPath = join(dir, "config.json");
    writeFileSync(configPath, JSON.stringify(config()));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    const ATTEMPT = "linear:DOT-121:code-review:1";
    const PR_URL = "https://github.com/o/r/pull/7";
    const BRANCH = "feature/DOT-109-stage-session-manager";

    function threadedPullRequest(log: string[]): PullRequests {
        const threads: ReviewThread[] = [];
        const done = <T>(name: string, value: T) => {
            log.push(name);
            return Promise.resolve({ ok: true as const, value });
        };
        return {
            ...fakePullRequests(log),
            find: () => done("find", { number: 7, url: PR_URL, title: "t" }),
            threads: () => done("threads", structuredClone(threads)),
            review: (_number, _body, opened) => {
                for (const { anchor, body } of opened) {
                    const id = `T${threads.length + 1}`;
                    const line = anchor.kind === "line";
                    threads.push({
                        id,
                        path: anchor.path,
                        subjectType: line ? "LINE" : "FILE",
                        line: line ? anchor.line : null,
                        startLine: null,
                        side: line ? anchor.side : null,
                        resolved: false,
                        outdated: false,
                        comments: [
                            {
                                id: `${id}-c`,
                                body,
                                url: `${PR_URL}#${id}`,
                                author: "me",
                                createdAt: "",
                            },
                        ],
                    });
                }
                return done("review", { id: "R1", url: `${PR_URL}#pullrequestreview-1` });
            },
            resolve: (id) => {
                const found = threads.find((item) => item.id === id);
                if (found !== undefined) {
                    found.resolved = true;
                }
                return done("resolve", undefined);
            },
        };
    }

    function workspaceGit(ahead: number) {
        return (args: string[]): Promise<ExecResult> => {
            const listing = `openspec/changes/${CHANGE}/proposal.md\n`;
            const answers: Record<string, string> = {
                fetch: "",
                "rev-parse": "0ddba11\n",
                "rev-list": `${ahead}\n`,
                log: "f00dfee\n",
                "merge-base": "5ca1ab1e\n",
                diff: args.includes("--name-only") ? listing : DIFF,
            };
            const stdout = answers[args[2] ?? ""];
            return Promise.resolve(
                stdout === undefined
                    ? { ok: false, error: `git ${args[2]} was not expected` }
                    : { ok: true, stdout },
            );
        };
    }

    interface PublishSetup {
        stage?: "code-review" | "verify";
        record?: string | null;
        ahead?: number;
        env?: Record<string, string>;
    }

    async function publishDeps(options: PublishSetup = {}) {
        const stateDir = state();
        const { dir: attempt } = await startAttempt(stateDir, {
            stage: options.stage ?? "code-review",
        });
        const findings = options.record === undefined ? recordText([finding()]) : options.record;
        if (findings !== null) {
            writeFileSync(join(attempt, FINDINGS_FILE), findings);
        }
        // A walkthrough draft, so the walkthrough stops at Plannotator.
        mkdirSync(join(attempt, "review"));
        writeFileSync(
            join(attempt, "review", "walkthrough.json"),
            JSON.stringify({ title: "Fix the login", intent: "Stop the loop.", sections: [] }),
        );
        const log: string[] = [];
        const result = deps([fakeStep("advance")], {
            env: { AUTONOMOUS_CONFIG: configPath, AUTONOMOUS_STATE: stateDir, ...options.env },
            pullRequests: () => threadedPullRequest(log),
            git: workspaceGit(options.ahead ?? 0),
            plannotatorIn: () => () =>
                Promise.resolve({ ok: false, error: "plannotator CLI not found on PATH" }),
        });
        return { ...result, log, attempt };
    }

    const posted = (log: readonly string[]) =>
        log.filter((call) => ["review", "reply", "resolve", "unresolve"].includes(call));

    it("Published: runs no step, posts and reads back the threads, writes the receipt and exits 0", async () => {
        const { d, out, log, attempt } = await publishDeps();
        expect(await main(["--apply", "--publish", ATTEMPT], d)).toBe(0);
        expect(out).toHaveLength(1);
        expect(out[0]).toContain("autonomous publish");
        expect(out[0]).not.toContain("[fake]");
        expect(posted(log)).toEqual(["review", "resolve"]);
        expect(existsSync(join(attempt, PUBLISH_RECEIPT_FILE))).toBe(true);
    });

    it("Publish without apply: prints usage and exits 1", async () => {
        const { d, out, err, log } = await publishDeps();
        expect(await main(["--publish", ATTEMPT], d)).toBe(1);
        expect(out).toEqual([]);
        expect(err.join("\n")).toContain("--publish requires --apply");
        expect(log).toEqual([]);
    });

    it("Verification attempt: nothing is posted and the run exits 3", async () => {
        const { d, out, log } = await publishDeps({ stage: "verify" });
        const id = "linear:DOT-121:verify:1";
        expect(await main(["--apply", "--publish", id, "--json"], d)).toBe(3);
        const report = JSON.parse(out[0] as string) as { reasons: string[] };
        expect(report.reasons.join("\n")).toContain("belongs to the verify stage");
        expect(posted(log)).toEqual([]);
    });

    it("Record missing: nothing is posted, the report names the file, exit 3", async () => {
        const { d, out, log, attempt } = await publishDeps({ record: null });
        expect(await main(["--apply", "--publish", ATTEMPT, "--json"], d)).toBe(3);
        const report = JSON.parse(out[0] as string) as { reasons: string[] };
        expect(report.reasons).toEqual([`${join(attempt, FINDINGS_FILE)} is missing`]);
        expect(posted(log)).toEqual([]);
    });

    it("Fix not pushed: nothing is posted, the report names the unpushed commit, exit 3", async () => {
        const { d, out, log } = await publishDeps({ ahead: 1 });
        expect(await main(["--apply", "--publish", ATTEMPT, "--json"], d)).toBe(3);
        const report = JSON.parse(out[0] as string) as { reasons: string[] };
        expect(report.reasons).toEqual([
            `the branch ${BRANCH} has 1 commit origin/${BRANCH} lacks: f00dfee`,
        ]);
        expect(posted(log)).toEqual([]);
    });

    it("refuses an unknown attempt with exit 3", async () => {
        const { d, out, log } = await publishDeps();
        const id = "linear:DOT-999:code-review:1";
        expect(await main(["--apply", "--publish", id, "--json"], d)).toBe(3);
        const report = JSON.parse(out[0] as string) as { reasons: string[] };
        expect(report.reasons.join("\n")).toContain(`unknown attempt ${id}`);
        expect(log).toEqual([]);
    });

    it("Publish JSON report: one autonomous.publish.v1 document; the walkthrough says Plannotator is not available", async () => {
        const { d, out, attempt } = await publishDeps();
        expect(await main(["--apply", "--publish", ATTEMPT, "--json"], d)).toBe(0);
        expect(out).toHaveLength(1);
        const report = JSON.parse(out[0] as string) as {
            walkthrough: { outcome: string; reason: string };
        };
        expect(report).toMatchObject({
            schema: "autonomous.publish.v1",
            startedAt: NOW.toISOString(),
            outcome: "advance",
            attempt: ATTEMPT,
            task: { source: "linear", id: "DOT-121", title: "Fix the login" },
            pullRequest: { number: 7, url: PR_URL },
            threads: {
                opened: [{ finding: "f1", url: `${PR_URL}#T1` }],
                answered: [],
                resolved: [{ finding: "f1", url: `${PR_URL}#T1` }],
                unresolved: [],
            },
            matches: [],
            reviews: [{ round: 1, url: `${PR_URL}#pullrequestreview-1` }],
            reasons: [],
            receipt: join(attempt, PUBLISH_RECEIPT_FILE),
        });
        expect(report.walkthrough.outcome).toBe("none");
        expect(report.walkthrough.reason).toContain("Plannotator is not available");
    });

    it("prints a configuration that cannot be loaded as one autonomous.publish.v1 document", async () => {
        const { d, out } = await publishDeps({
            env: { AUTONOMOUS_CONFIG: join(dir, "absent.json") },
        });
        expect(await main(["--apply", "--publish", ATTEMPT, "--json"], d)).toBe(3);
        expect(out).toHaveLength(1);
        expect(JSON.parse(out[0] as string)).toMatchObject({
            schema: "autonomous.publish.v1",
            outcome: "not-evaluable",
            receipt: null,
        });
    });
});

describe("main stage-session wiring", () => {
    it("runs reconcile before the quota gate and keeps its result when the gate waits", async () => {
        const log: string[] = [];
        const steps = [
            named("reconcile", "advance", log, { attempts: [] }),
            named("quota-gate", "wait", log),
            named("label-triage", "advance", log),
        ];
        const { d, out } = deps(steps);
        expect(await main(["--json"], d)).toBe(2);
        expect(log).toEqual(["reconcile", "quota-gate"]);
        const report = JSON.parse(out[0] as string) as {
            outcome: string;
            steps: { step: string; outcome: string; data: unknown }[];
        };
        expect(report.outcome).toBe("wait");
        expect(report.steps.map((s) => [s.step, s.outcome, s.data])).toEqual([
            ["reconcile", "advance", { attempts: [] }],
            ["quota-gate", "wait", null],
        ]);
    });

    it("runs exactly reconcile, quota-gate and launch with --task", async () => {
        const log: string[] = [];
        const { d, out } = deps(FIVE.map((id) => named(id, "advance", log)));
        expect(await main(["--task", "linear:DOT-109", "--json"], d)).toBe(0);
        expect(log).toEqual(["reconcile", "quota-gate", "launch"]);
        const report = JSON.parse(out[0] as string) as { steps: { step: string }[] };
        expect(report.steps.map((s) => s.step)).toEqual(["reconcile", "quota-gate", "launch"]);
    });

    it("runs every step without --task", async () => {
        const log: string[] = [];
        const { d } = deps(FIVE.map((id) => named(id, "advance", log)));
        expect(await main([], d)).toBe(0);
        expect(log).toEqual(FIVE);
    });

    it("carries both new steps' data in the --json report", async () => {
        const log: string[] = [];
        const reconciled = { attempts: [], retained: [], cleanups: [], needsHuman: [], errors: [] };
        const launched = { task: { source: "linear", id: "DOT-109", title: "T" }, stage: "test" };
        const steps = [
            named("reconcile", "advance", log, reconciled),
            named("launch", "advance", log, launched),
        ];
        const { d, out } = deps(steps);
        expect(await main(["--json"], d)).toBe(0);
        const report = JSON.parse(out[0] as string) as { steps: { step: string; data: unknown }[] };
        expect(report.steps.map((s) => [s.step, s.data])).toEqual([
            ["reconcile", reconciled],
            ["launch", launched],
        ]);
    });

    it("is not-evaluable without running a step when another run holds the lock", async () => {
        const log: string[] = [];
        const { dir, error } = heldLock();
        const { d, out } = deps(
            FIVE.map((id) => named(id, "advance", log)),
            {
                env: { AUTONOMOUS_STATE: dir },
            },
        );
        expect(await main([], d)).toBe(3);
        expect(log).toEqual([]);
        expect(out).toEqual([
            `autonomous run — started ${NOW.toISOString()}\noutcome: not-evaluable\n\nlock: ${error}`,
        ]);
        expect(existsSync(join(dir, "run.lock"))).toBe(true);
    });

    it("prints the held lock in one autonomous.run.v2 JSON document with --json", async () => {
        const log: string[] = [];
        const { dir, error } = heldLock();
        const { d, out } = deps([named("reconcile", "advance", log)], {
            env: { AUTONOMOUS_STATE: dir },
        });
        expect(await main(["--json"], d)).toBe(3);
        expect(log).toEqual([]);
        expect(out).toHaveLength(1);
        expect(JSON.parse(out[0] as string)).toEqual({
            schema: "autonomous.run.v2",
            startedAt: NOW.toISOString(),
            steps: [],
            outcome: "not-evaluable",
            lock: { error },
        });
    });

    it.each<[string, Step]>([
        ["after the steps ran", named("reconcile", "advance", [])],
        [
            "when a step throws",
            { id: "broken", run: () => Promise.reject(new Error("boom")), render: () => "" },
        ],
    ])("releases the lock %s", async (_, step) => {
        const dir = state();
        const { d } = deps([step], { env: { AUTONOMOUS_STATE: dir } });
        await main([], d);
        expect(existsSync(join(dir, "run.lock"))).toBe(false);
    });
});

describe("main --discard", () => {
    const dir = mkdtempSync(join(tmpdir(), "autonomous-discard-"));
    const configPath = join(dir, "config.json");
    writeFileSync(configPath, JSON.stringify(config()));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    const ATTEMPT = "linear:DOT-109:test:1";
    const gone = {
        state: "gone",
        status: "not found",
        busy: false,
        needsHuman: false,
        agentSessionId: null,
    } as const;

    // A state directory holding the started attempt, and fakes that discard it:
    // its session is gone and DOT-109 carries `taken`.
    async function discardDeps(env: Record<string, string> = {}) {
        const log: string[] = [];
        const calls: string[] = [];
        const attempts = state();
        await writeRecord(attempts, record());
        const sessions = fakeSessions({
            observe: () => Promise.resolve({ ok: true, value: gone }),
        });
        const result = deps(
            FIVE.map((id) => named(id, "advance", log)),
            {
                env: { AUTONOMOUS_CONFIG: configPath, AUTONOMOUS_STATE: attempts, ...env },
                sessions: () => sessions,
                workspace: () => fakeWorkspace({}),
                trackers: () =>
                    trackers(calls, { linear: [task("linear", "DOT-109", ["work", "taken"])] }),
            },
        );
        const stored = () => readFileSync(recordPath(attemptDir(attempts, ATTEMPT)), "utf8");
        return { ...result, log, calls, sessions, stored };
    }

    const argv = (...extra: string[]) => ["--apply", "--discard", ATTEMPT, ...extra];

    it("discards the attempt without running a step and exits 0", async () => {
        const { d, out, err, log, calls, stored } = await discardDeps();
        expect(await main(argv(), d)).toBe(0);
        expect(log).toEqual([]);
        expect(err).toEqual([]);
        expect(calls).toContain("linear:removeLabel:DOT-109:taken");
        expect(JSON.parse(stored())).toMatchObject({ state: "discarded" });
        expect(out).toHaveLength(1);
        expect(out[0]).toContain(`autonomous discard — started ${NOW.toISOString()}`);
        expect(out[0]).toContain("outcome: advance");
    });

    it("prints one autonomous.discard.v1 JSON document with --json", async () => {
        const { d, out } = await discardDeps();
        expect(await main(argv("--json"), d)).toBe(0);
        expect(out).toHaveLength(1);
        expect(JSON.parse(out[0] as string)).toMatchObject({
            schema: "autonomous.discard.v1",
            startedAt: NOW.toISOString(),
            outcome: "advance",
            attempt: ATTEMPT,
            task: { source: "linear", id: "DOT-109" },
            removed: { session: false, taken: true, workspace: false },
        });
    });

    it("exits 3 when the attempt cannot be discarded", async () => {
        const { d, out, log } = await discardDeps();
        expect(await main(["--apply", "--discard", "linear:DOT-109:test:2", "--json"], d)).toBe(3);
        expect(log).toEqual([]);
        expect(JSON.parse(out[0] as string)).toMatchObject({
            schema: "autonomous.discard.v1",
            outcome: "not-evaluable",
            reasons: ["attempt linear:DOT-109:test:2 not found"],
        });
    });

    it("exits 3 and changes nothing when another run holds the lock", async () => {
        const { dir: held, error } = heldLock();
        const { d, out, log, calls, sessions } = await discardDeps({ AUTONOMOUS_STATE: held });
        expect(await main(argv("--json"), d)).toBe(3);
        expect(log).toEqual([]);
        expect(calls).toEqual([]);
        expect(sessions.calls).toEqual([]);
        expect(JSON.parse(out[0] as string)).toEqual({
            schema: "autonomous.discard.v1",
            startedAt: NOW.toISOString(),
            outcome: "not-evaluable",
            attempt: null,
            task: null,
            found: [],
            removed: { session: false, taken: false, workspace: false },
            reasons: [error],
            notes: [],
        });
    });

    it("leaves the record alone when the lock is held", async () => {
        const { dir: held } = heldLock();
        const { d, stored } = await discardDeps({ AUTONOMOUS_STATE: held });
        const before = stored();
        expect(await main(argv(), d)).toBe(3);
        expect(stored()).toBe(before);
    });

    it("releases the lock once the discard is done", async () => {
        const { d } = await discardDeps();
        await main(argv(), d);
        expect(existsSync(join(d.env.AUTONOMOUS_STATE ?? "", "run.lock"))).toBe(false);
    });

    it("prints the configuration error and one JSON document holding it", async () => {
        const missing = join(dir, "absent.json");
        const error = `configuration file not found at ${missing}; create it from the example at ${EXAMPLE_PATH}`;
        const { d, out, err, log } = await discardDeps({ AUTONOMOUS_CONFIG: missing });
        expect(await main(argv("--json"), d)).toBe(3);
        expect(log).toEqual([]);
        expect(err).toEqual([error]);
        expect(out).toHaveLength(1);
        expect(JSON.parse(out[0] as string)).toMatchObject({
            schema: "autonomous.discard.v1",
            outcome: "not-evaluable",
            config: { path: missing, error },
        });
    });

    it("shows the defaulted keys in the text and the JSON, and neither for a full config", async () => {
        const bare = join(dir, "bare.json");
        writeFileSync(
            bare,
            JSON.stringify({
                ...config(),
                sessions: undefined,
                workspace: undefined,
                naming: undefined,
                runner: undefined,
            }),
        );
        const defaulted = [
            "sessions.tool",
            "sessions.profile",
            "sessions.binary",
            "runner.grills",
            "runner.parallel",
            "runner.intervalMinutes",
        ];

        const text = await discardDeps({ AUTONOMOUS_CONFIG: bare });
        await main(argv(), text.d);
        expect((text.out[0] as string).split("\n").slice(0, 3)).toEqual([
            `autonomous discard — started ${NOW.toISOString()}`,
            "outcome: advance",
            expect.stringMatching(/^defaults: sessions\.tool, sessions\.profile, sessions\.binary/),
        ]);

        const json = await discardDeps({ AUTONOMOUS_CONFIG: bare });
        await main(argv("--json"), json.d);
        expect(
            (JSON.parse(json.out[0] as string) as { config: { defaulted: string[] } }).config
                .defaulted,
        ).toEqual(expect.arrayContaining(defaulted));

        const full = await discardDeps();
        await main(argv("--json"), full.d);
        expect(JSON.parse(full.out[0] as string)).not.toHaveProperty("config");
        const fullText = await discardDeps();
        await main(argv(), fullText.d);
        expect(fullText.out[0]).not.toContain("defaults:");
    });
});

describe("main configuration defaults", () => {
    const dir = mkdtempSync(join(tmpdir(), "autonomous-defaults-"));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    function configFile(name: string, full: boolean): string {
        const { sessions, workspace, naming, runner, ...required } = config();
        const path = join(dir, name);
        writeFileSync(
            path,
            JSON.stringify(full ? { ...required, sessions, workspace, naming, runner } : required),
        );
        return path;
    }

    const DEFAULTED = [
        "sessions.tool",
        "sessions.profile",
        "sessions.binary",
        "workspace.root",
        "naming.model",
        "naming.effort",
        "runner.grills",
        "runner.parallel",
        "runner.intervalMinutes",
    ];

    it("shows the defaulted keys in the text header and in the JSON", async () => {
        const env = { AUTONOMOUS_CONFIG: configFile("bare.json", false) };
        const text = deps([fakeStep("advance")], { env });
        await main([], text.d);
        expect((text.out[0] as string).split("\n\n")[0]).toBe(
            [
                `autonomous run — started ${NOW.toISOString()}`,
                "outcome: advance",
                `defaults: ${DEFAULTED.join(", ")}`,
            ].join("\n"),
        );

        const json = deps([fakeStep("advance")], { env });
        await main(["--json"], json.d);
        expect(JSON.parse(json.out[0] as string)).toMatchObject({
            config: { defaulted: DEFAULTED },
        });
    });

    it("shows neither when the file sets every key", async () => {
        const env = { AUTONOMOUS_CONFIG: configFile("full.json", true) };
        const text = deps([fakeStep("advance")], { env });
        await main([], text.d);
        expect(text.out[0]).not.toContain("defaults:");

        const json = deps([fakeStep("advance")], { env });
        await main(["--json"], json.d);
        expect(JSON.parse(json.out[0] as string)).not.toHaveProperty("config");
    });
});

describe("main --loop", () => {
    const dir = mkdtempSync(join(tmpdir(), "autonomous-loop-config-"));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    function configFile(runner: Partial<AutonomousConfig["runner"]>): string {
        const base = config();
        const path = join(dir, `config-${STATES.length}.json`);
        writeFileSync(path, JSON.stringify({ ...base, runner: { ...base.runner, ...runner } }));
        return path;
    }

    const RECONCILED = { attempts: [], retained: [], cleanups: [], needsHuman: [], errors: [] };

    // Stops the loop in the wait that follows its `iterations`-th iteration.
    function looped(iterations: number, onWait: (n: number) => Promise<void> = async () => {}) {
        const controller = new AbortController();
        const waits: number[] = [];
        return {
            waits,
            overrides: {
                wait: async (ms: number) => {
                    waits.push(ms);
                    await onWait(waits.length);
                    if (waits.length >= iterations) {
                        controller.abort("received SIGTERM");
                    }
                },
                stopSignal: () => controller.signal,
            },
        };
    }

    const read = (state: string, name: string) => readFileSync(join(state, name), "utf8");

    it("logs an iteration where every kind is full and prints nothing", async () => {
        const log: string[] = [];
        const stateDir = state();
        const loop = looped(2);
        const { d, out, err } = deps(
            [
                named("reconcile", "advance", log, RECONCILED),
                capacityStep,
                named("launch", "advance", log),
            ],
            {
                ...loop.overrides,
                env: {
                    AUTONOMOUS_STATE: stateDir,
                    AUTONOMOUS_CONFIG: configFile({ grills: 0, parallel: 0 }),
                },
            },
        );
        expect(await main(["--loop", "--apply"], d)).toBe(0);
        expect(log).toEqual(["reconcile", "reconcile"]);
        expect(out).toEqual([]);
        expect(err).toEqual([]);
        const entries = read(stateDir, "loop.log").split(`autonomous run — started `).slice(1);
        expect(entries).toHaveLength(2);
        expect(entries[0]).toContain("outcome: wait");
        expect(entries[0]).toContain("every kind of slot is full: grill slots 0/0, work slots 0/0");
        expect(read(stateDir, "loop.notices")).toBe("loop stopped: received SIGTERM\n");
        expect(existsSync(join(stateDir, "loop.lock"))).toBe(false);
    });

    it("writes one JSON line per iteration with --json, without a handoff", async () => {
        const stateDir = state();
        const loop = looped(2);
        const asking: Step = {
            id: "asking",
            run: () =>
                Promise.resolve({
                    step: "asking",
                    tier: "code",
                    outcome: "advance",
                    reasons: [],
                    data: null,
                    questions: [
                        {
                            id: "asking:1",
                            step: "asking",
                            header: "Q1",
                            question: "Which scope?",
                            options: [
                                { label: "A", value: "a", description: "a" },
                                { label: "Later", value: null, description: "later" },
                            ],
                            multiSelect: false,
                        },
                    ],
                }),
            render: () => "[asking]",
        };
        const { d, out } = deps([asking], {
            ...loop.overrides,
            env: { AUTONOMOUS_STATE: stateDir },
        });
        expect(await main(["--loop", "--apply", "--json"], d)).toBe(0);
        expect(out).toEqual([]);
        const lines = read(stateDir, "loop.log").split("\n").filter(Boolean);
        expect(lines).toHaveLength(2);
        for (const line of lines) {
            const report = JSON.parse(line) as Record<string, unknown>;
            expect(report).toMatchObject({ schema: "autonomous.run.v2", outcome: "advance" });
            expect(report).not.toHaveProperty("handoff");
        }
    });

    it.each<[string, string[], Partial<AutonomousConfig["runner"]> | null, number]>([
        ["the shipped default", [], null, 10],
        ["the file", [], { intervalMinutes: 5 }, 5],
        ["the flag over the file", ["--interval", "30"], { intervalMinutes: 5 }, 30],
    ])("waits the interval from %s", async (_, flags, runner, minutes) => {
        const loop = looped(2);
        const env = {
            AUTONOMOUS_STATE: state(),
            ...(runner === null ? {} : { AUTONOMOUS_CONFIG: configFile(runner) }),
        };
        const { d } = deps([fakeStep("advance")], { ...loop.overrides, env });
        expect(await main(["--loop", "--apply", ...flags], d)).toBe(0);
        expect(loop.waits).toEqual([minutes * 60_000, minutes * 60_000]);
    });

    it("goes on while a manual run holds the run lock", async () => {
        const log: string[] = [];
        const { dir: stateDir, error } = heldLock();
        const loop = looped(2);
        const { d } = deps([named("reconcile", "advance", log)], {
            ...loop.overrides,
            env: { AUTONOMOUS_STATE: stateDir },
        });
        expect(await main(["--loop", "--apply"], d)).toBe(0);
        expect(log).toEqual([]);
        const text = read(stateDir, "loop.log");
        expect(text.split("outcome: not-evaluable")).toHaveLength(3);
        expect(text).toContain(`lock: ${error}`);
    });

    it("lets a manual run execute while the loop waits", async () => {
        const stateDir = state();
        const manual: string[] = [];
        const codes: number[] = [];
        const loop = looped(1, async () => {
            const run = deps([named("reconcile", "advance", manual)], {
                env: { AUTONOMOUS_STATE: stateDir },
            });
            codes.push(await main(["--apply"], run.d));
        });
        const { d } = deps([fakeStep("advance")], {
            ...loop.overrides,
            env: { AUTONOMOUS_STATE: stateDir },
        });
        expect(await main(["--loop", "--apply"], d)).toBe(0);
        expect(codes).toEqual([0]);
        expect(manual).toEqual(["reconcile"]);
    });

    it("refuses a second loop with code 3, naming the first, and runs no iteration", async () => {
        const log: string[] = [];
        const stateDir = state();
        const startedAt = "2026-11-14T08:00:00.000Z";
        writeFileSync(join(stateDir, "loop.lock"), JSON.stringify({ pid: process.pid, startedAt }));
        const { d, out, err } = deps([named("reconcile", "advance", log)], {
            env: { AUTONOMOUS_STATE: stateDir },
        });
        expect(await main(["--loop", "--apply"], d)).toBe(3);
        expect(log).toEqual([]);
        expect(out).toEqual([]);
        expect(err).toEqual([
            `another loop holds ${join(stateDir, "loop.lock")} (pid ${process.pid}, started ${startedAt})`,
        ]);
    });

    it("stops with code 1 and the stop notice when the runner throws", async () => {
        const stateDir = state();
        const broken: Step = {
            id: "broken",
            run: () => Promise.reject(new Error("boom")),
            render: () => "",
        };
        const { d, err } = deps([broken], { env: { AUTONOMOUS_STATE: stateDir } });
        expect(await main(["--loop", "--apply"], d)).toBe(1);
        expect(err).toEqual(["autonomous loop failed: boom"]);
        expect(read(stateDir, "loop.notices")).toBe("loop stopped: runner error: boom\n");
        expect(existsSync(join(stateDir, "loop.lock"))).toBe(false);
        expect(existsSync(join(stateDir, "run.lock"))).toBe(false);
    });

    it("runs one dry iteration without --apply, prints its report and writes nothing", async () => {
        const log: string[] = [];
        const stateDir = state();
        const { d, out, err } = deps(
            [
                named("reconcile", "advance", log, RECONCILED),
                capacityStep,
                named("launch", "advance", log),
            ],
            {
                env: { AUTONOMOUS_STATE: stateDir, AUTONOMOUS_CONFIG: configFile({}) },
                stopSignal: () => {
                    throw new Error("a dry iteration asks for no stop signal");
                },
            },
        );
        expect(await main(["--loop"], d)).toBe(0);
        expect(log).toEqual(["reconcile", "launch"]);
        expect(err).toEqual([]);
        expect(out).toHaveLength(1);
        expect(out[0]).toContain("[capacity] advance (code)");
        expect(out[0]).toContain("grill slots 0/1  limit from file");
        expect(out[0]).toContain("[launch] advance");
        expect(readdirSync(stateDir)).toEqual([]);
    });

    it("exits a dry iteration with the code of its outcome", async () => {
        const stateDir = state();
        const { d } = deps([named("reconcile", "advance", [], RECONCILED), capacityStep], {
            env: {
                AUTONOMOUS_STATE: stateDir,
                AUTONOMOUS_CONFIG: configFile({ grills: 0, parallel: 0 }),
            },
        });
        expect(await main(["--loop"], d)).toBe(2);
        expect(readdirSync(stateDir)).toEqual([]);
    });
});

describe("main --notices", () => {
    // Polls without real time and counts them.
    function polled(stateDir: string) {
        const waits: number[] = [];
        const wait = (ms: number) => {
            waits.push(ms);
            return Promise.resolve();
        };
        return { waits, ...deps(undefined, { env: { AUTONOMOUS_STATE: stateDir }, wait }) };
    }

    it("prints the new notices of the live loop and the next count", async () => {
        const stateDir = state();
        const startedAt = "2026-01-01T00:00:00.000Z";
        writeFileSync(join(stateDir, "loop.lock"), JSON.stringify({ pid: process.pid, startedAt }));
        writeFileSync(join(stateDir, "loop.notices"), "linear:DOT-98 grill-me → proposal\n");
        const { d, out, waits } = polled(stateDir);
        expect(await main(["--notices", "0"], d)).toBe(0);
        expect(out).toEqual(["linear:DOT-98 grill-me → proposal\nnext: 1"]);
        expect(waits).toEqual([]);
    });

    it("says the loop is not running, with code 2, when none appears within the grace", async () => {
        const { d, out, waits } = polled(state());
        expect(await main(["--notices", "3"], d)).toBe(2);
        expect(out).toEqual(["loop stopped: not running"]);
        expect(waits).toEqual([2_000, 2_000, 2_000, 2_000, 2_000]);
    });
});

describe("main --stop-loop", () => {
    it("says the loop is not running, with code 2, reading no configuration", async () => {
        const stateDir = state();
        const config = join(state(), "config.json");
        writeFileSync(config, "{ not json");
        const { d, out, err } = deps(undefined, {
            env: { AUTONOMOUS_STATE: stateDir, AUTONOMOUS_CONFIG: config },
        });
        expect(await main(["--stop-loop"], d)).toBe(2);
        expect(out).toEqual(["loop stopped: not running"]);
        expect(err).toEqual([]);
        expect(readdirSync(stateDir)).toEqual([]);
    });
});
