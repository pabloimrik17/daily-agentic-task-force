import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import type { Answer } from "./args.ts";
import { type AutonomousConfig, CONFIG_SCHEMA, EXAMPLE_PATH } from "./config.ts";
import { config, fakeJudgement, task, trackers } from "./label-triage/test-fixtures.ts";
import type { Tracker, TrackerLabel, Trackers } from "./label-triage/trackers/tracker.ts";
import { fakeExec, limits, NOW, provider, session, weekly } from "./quota-gate/test-fixtures.ts";
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

// `steps` undefined runs the real STEPS.
function deps(steps: readonly Step[] | undefined, overrides: Partial<MainDeps> = {}) {
    const out: string[] = [];
    const err: string[] = [];
    const d: MainDeps = {
        now: () => NOW,
        env: { AUTONOMOUS_CONFIG: join(tmpdir(), "autonomous-run-absent", "config.json") },
        openUsage: () => Promise.resolve({ ok: false, error: "unused" }),
        trackers: () => {
            throw new Error("unused");
        },
        judgement: () => Promise.resolve({ ok: false, error: "unused" }),
        chezmoi: () => Promise.resolve({ ok: false, error: "unused" }),
        work: () => {
            throw new Error("unused");
        },
        selection: () => Promise.resolve({ ok: false, error: "unused" }),
        stdout: (t) => out.push(t),
        stderr: (t) => err.push(t),
        ...(steps === undefined ? {} : { steps }),
        ...overrides,
    };
    return { d, out, err };
}

const capacity = () =>
    fakeExec(limits({ claude: provider({ session: session(20), weekly: weekly(30) }) }));

describe("main", () => {
    it.each<[StepOutcome, number]>([
        ["advance", 0],
        ["wait", 2],
        ["not-evaluable", 3],
    ])("exits for %s with %i", async (outcome, code) => {
        const { d } = deps([fakeStep(outcome)]);
        expect(await main([], d)).toBe(code);
    });

    it("prints one autonomous.run.v1 JSON document with --json", async () => {
        const { d, out } = deps([fakeStep("wait")]);
        await main(["--json"], d);
        expect(out).toHaveLength(1);
        expect(JSON.parse(out[0] as string)).toEqual({
            schema: "autonomous.run.v1",
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

    function linear(labels: TrackerLabel[] | string): Tracker {
        const unused = () => Promise.reject(new Error("unused"));
        return {
            source: "linear",
            labelScopes: ["workspace"],
            createsLabels: true,
            listTasks: unused,
            readTask: unused,
            addLabel: unused,
            listLabels: () =>
                Promise.resolve(
                    typeof labels === "string"
                        ? { ok: false, error: labels }
                        : { ok: true, value: labels },
                ),
            createLabel: () => Promise.resolve({ ok: true, value: undefined }),
        };
    }

    function bootstrapDeps(tracker: Tracker, env = { AUTONOMOUS_CONFIG: configPath }) {
        const calls = { steps: 0, openUsage: 0 };
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
            openUsage: () => {
                calls.openUsage++;
                return Promise.resolve({ ok: false, error: "unused" });
            },
            // Beads and GitHub are disabled in the configuration, so only Linear is reached.
            trackers: (): Trackers => ({ beads: tracker, github: tracker, linear: tracker }),
        });
        return { ...result, calls };
    }

    it("runs only the bootstrap and prints its report", async () => {
        const { d, out, err, calls } = bootstrapDeps(linear([]));
        expect(await main(["--bootstrap-labels"], d)).toBe(0);
        expect(calls).toEqual({ steps: 0, openUsage: 0 });
        expect(err).toEqual([]);
        expect(out).toEqual([
            [
                `label bootstrap — started ${NOW.toISOString()}`,
                "outcome: advance",
                "  linear    workspace: created work, personal, AFK, HITL, grill-me, taken",
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

    it("exits 3 naming the path when the configuration file is missing", async () => {
        const missing = join(dir, "absent.json");
        const { d, out, err, calls } = bootstrapDeps(linear([]), { AUTONOMOUS_CONFIG: missing });
        expect(await main(["--bootstrap-labels"], d)).toBe(3);
        expect(calls).toEqual({ steps: 0, openUsage: 0 });
        expect(out).toEqual([]);
        expect(err).toHaveLength(1);
        expect(err[0]).toContain(`configuration file not found at ${missing}`);
    });

    it("prints the missing configuration as one autonomous.bootstrap.v1 document with --json", async () => {
        const missing = join(dir, "absent.json");
        const { d, out, calls } = bootstrapDeps(linear([]), { AUTONOMOUS_CONFIG: missing });
        expect(await main(["--bootstrap-labels", "--json"], d)).toBe(3);
        expect(calls).toEqual({ steps: 0, openUsage: 0 });
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

    it("exits 1 when the bootstrap itself fails", async () => {
        const broken = { ...linear([]), listLabels: () => Promise.reject(new Error("boom")) };
        const { d, err } = bootstrapDeps(broken);
        expect(await main(["--bootstrap-labels"], d)).toBe(1);
        expect(err).toEqual(["autonomous run failed: boom"]);
    });
});

describe("main with the real steps", () => {
    const dir = mkdtempSync(join(tmpdir(), "autonomous-steps-"));
    const configPath = join(dir, "config.json");
    copyFileSync(EXAMPLE_PATH, configPath);
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
            listLabels: unused,
            createLabel: unused,
        };
    }

    it("still runs the quota gate without a configuration file, the triage reporting the missing file", async () => {
        const missing = join(dir, "absent.json");
        const { d, out } = deps(undefined, {
            env: { AUTONOMOUS_CONFIG: missing },
            openUsage: capacity(),
        });
        expect(await main(["--json"], d)).toBe(3);
        const report = JSON.parse(out[0] as string) as {
            outcome: string;
            steps: { step: string; outcome: string; reasons: string[] }[];
        };
        expect(report.outcome).toBe("not-evaluable");
        expect(report.steps.map((s) => [s.step, s.outcome])).toEqual([
            ["quota-gate", "advance"],
            ["label-triage", "not-evaluable"],
        ]);
        expect(report.steps[1]?.reasons).toEqual([
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
                    [workTask("linear", "DOT-120", ["personal", "HITL", "grill-me"])],
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

    it("advances through the three steps with the example configuration", async () => {
        let judged = 0;
        const calls: string[] = [];
        const { d, out, err } = deps(undefined, {
            env: { AUTONOMOUS_CONFIG: configPath },
            openUsage: capacity(),
            trackers: emptyTrackers,
            judgement: () => {
                judged++;
                return Promise.resolve({ ok: false, error: "unused" });
            },
            ...selecting(calls),
        });
        expect(await main([], d)).toBe(0);
        expect(err).toEqual([]);
        expect(judged).toBe(0);
        const text = out[0] as string;
        expect(text).toContain("outcome: advance");
        expect(text).toContain("[quota-gate] advance (code)");
        expect(text).toContain("[label-triage] advance (code)");
        expect(text).toContain("[select] advance (llm)");
    });

    it("does not run the select step when label-triage is not evaluable because bd cannot be executed", async () => {
        const calls: string[] = [];
        const { d, out } = deps(undefined, {
            env: { AUTONOMOUS_CONFIG: configPath },
            openUsage: capacity(),
            trackers: () => trackers(calls, { beads: "bd list --json: bd CLI not found on PATH" }),
            ...selecting(calls),
        });
        expect(await main(["--json"], d)).toBe(3);
        const report = JSON.parse(out[0] as string) as {
            steps: { step: string; outcome: string }[];
        };
        expect(report.steps.map((s) => [s.step, s.outcome])).toEqual([
            ["quota-gate", "advance"],
            ["label-triage", "not-evaluable"],
        ]);
        expect(calls).toEqual(["beads:listTasks"]);
    });

    it("writes nothing and carries no question from the select step with --apply", async () => {
        const calls: string[] = [];
        const { d, out } = deps(undefined, {
            env: { AUTONOMOUS_CONFIG: configPath },
            openUsage: capacity(),
            // Every listed task is complete, so label-triage has nothing to write or ask either.
            trackers: () =>
                trackers(calls, { beads: [task("beads", "B-7", ["personal", "grill-me"])] }),
            ...selecting(calls),
        });
        expect(await main(["--apply", "--json"], d)).toBe(0);
        const report = JSON.parse(out[0] as string) as Record<string, unknown>;
        expect(report.outcome).toBe("advance");
        expect(report).not.toHaveProperty("handoff");
        expect(calls.filter((call) => call.includes(":addLabel:"))).toEqual([]);
    });

    it("carries the select step's data in the --json report", async () => {
        const calls: string[] = [];
        const { d, out } = deps(undefined, {
            env: { AUTONOMOUS_CONFIG: configPath },
            openUsage: capacity(),
            trackers: emptyTrackers,
            ...selecting(calls),
        });
        expect(await main(["--json"], d)).toBe(0);
        const report = JSON.parse(out[0] as string) as {
            steps: { step: string; tier: string; outcome: string; data: unknown }[];
        };
        const select = report.steps[2];
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
            excluded: [],
            notEvaluated: ["github: dependencies and children"],
            comparison: { model: "sonnet", effort: "high" },
        } satisfies SelectData);
    });
});

describe("main --answer", () => {
    const dir = mkdtempSync(join(tmpdir(), "autonomous-answers-"));
    const configPath = join(dir, "config.json");
    // Only Beads is enabled, so the round at the end reads a single source.
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
        env = { AUTONOMOUS_CONFIG: configPath },
    ) {
        const fake = trackers([], {});
        const result = deps(steps, {
            env,
            openUsage: () => {
                log.push("openUsage");
                return Promise.resolve({ ok: false, error: "unused" });
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
        expect(await main(["--apply", ...answerArgs("triage:B-1:entry=HITL")], d)).toBe(0);
        expect(log).toEqual(["trackers", "triage:answer triage:B-1:entry=HITL"]);
        expect(seen).toHaveLength(1);
        expect(seen[0]?.config).toEqual(settings);
        expect(seen[0]?.trackers).toBe(fake);
        expect(err).toEqual([]);
        expect(out).toHaveLength(1);
    });

    it("prints usage and exits 1 for an answer without --apply", async () => {
        const log: string[] = [];
        const { d, out, err } = answerDeps(log, [answering("triage", log)]);
        expect(await main(answerArgs("triage:B-1:entry=HITL"), d)).toBe(1);
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
        expect(await main(["--apply", "--json", ...answerArgs("triage:B-1:entry=HITL")], d)).toBe(
            0,
        );
        expect(err).toEqual([]);
        expect(out).toHaveLength(1);
        const report = JSON.parse(out[0] as string) as unknown;
        expect(report).toEqual({
            schema: "autonomous.answers.v1",
            startedAt: NOW.toISOString(),
            outcome: "advance",
            answers: [
                {
                    id: "triage:B-1:entry",
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
                entry: { labels: ["HITL"], confidence: 0.8, reason: "needs a decision" },
            })),
        }));
        const openUsage = capacity();
        const shared = {
            env: { AUTONOMOUS_CONFIG: configPath },
            openUsage,
            trackers: () => fake,
            judgement,
            // B-1 still lacks its entry group, so select advances on another, complete task.
            chezmoi: fakeChezmoi({ machineType: "personal" }, []),
            work: () => [fakeReader("beads", [workTask("beads", "B-2", ["work", "grill-me"])], [])],
        };

        const run = deps(undefined, shared);
        expect(await main(["--apply", "--json"], run.d)).toBe(0);
        const { handoff } = JSON.parse(run.out[0] as string) as {
            handoff?: { questions: HandoffQuestion[]; remaining: number };
        };
        expect(handoff?.remaining).toBe(0);
        expect(handoff?.questions.map((q) => q.id)).toEqual(["label-triage:beads:B-1:entry"]);
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
            value: { labels: ["work", "HITL"] },
        });
    });
});
