import { describe, expect, it } from "vitest";

import type { Source } from "../config.ts";
import { NOW } from "../quota-gate/test-fixtures.ts";
import {
    renderTriageQuestionsJson,
    renderTriageQuestionsText,
    runTriageQuestions,
    TRIAGE_QUESTIONS_SCHEMA,
    type TriageQuestionsReport,
    unconfiguredTriageQuestions,
} from "./questions-mode.ts";
import { config, task, trackers } from "./test-fixtures.ts";
import type { Trackers } from "./trackers/tracker.ts";

const WRITES = [
    "addLabel",
    "removeLabel",
    "createLabel",
    "recolourLabel",
    "addComment",
    "updateDescription",
] as const;

// The fixture's trackers with every write method recorded and refused, so a test can assert
// that nothing was written, whatever the fixture itself logs.
function readOnly(inner: Trackers, writes: string[]): Trackers {
    const guard = (source: Source) => {
        const tracker = { ...inner[source] };
        for (const method of WRITES) {
            tracker[method] = () => {
                writes.push(`${source}:${method}`);
                return Promise.reject(new Error(`${method} is a write`));
            };
        }
        return tracker;
    };
    return { beads: guard("beads"), github: guard("github"), linear: guard("linear") };
}

async function run(listings: Parameters<typeof trackers>[1], cfg = config()) {
    const calls: string[] = [];
    const writes: string[] = [];
    const report = await runTriageQuestions(
        { config: cfg, trackers: readOnly(trackers(calls, listings), writes) },
        NOW,
    );
    return { report, calls, writes };
}

const headers = (questions: { header: string }[]) => questions.map((q) => q.header).toSorted();

// Three tasks lacking the scope and three lacking the autonomy, all marked.
const sixMarked = {
    github: [
        task("github", "gh-1", ["triage-me", "AFK", "proposal"]),
        task("github", "gh-2", ["triage-me", "HITL", "proposal"]),
        task("github", "gh-3", ["triage-me", "AFK", "implement"]),
    ],
    beads: [
        task("beads", "bd-1", ["triage-me", "work", "proposal"]),
        task("beads", "bd-2", ["triage-me", "personal", "proposal"]),
        task("beads", "bd-3", ["triage-me", "work", "implement"]),
    ],
};

describe("runTriageQuestions", () => {
    it("Marked tasks waiting: six marked tasks each lacking one group give six questions and no write", async () => {
        const { report, calls, writes } = await run(sixMarked);
        expect(report.outcome).toBe("advance");
        expect(report.marked).toBe(6);
        expect(headers(report.questions)).toEqual(
            ["bd-1", "bd-2", "bd-3", "gh-1", "gh-2", "gh-3"].toSorted(),
        );
        expect(writes).toEqual([]);
        // Reading the open tasks is the only thing the mode asks of a tracker: no readTask,
        // no listLabels, no write.
        expect(calls.toSorted()).toEqual(
            ["beads:listTasks", "github:listTasks", "linear:listTasks"].toSorted(),
        );
    });

    it("Nothing marked: the report counts no marked task and carries no question or handoff", async () => {
        const { report } = await run({
            github: [task("github", "gh-1", ["AFK", "proposal"])],
        });
        expect(report).toMatchObject({ outcome: "advance", marked: 0, questions: [], reasons: [] });
        expect(report.handoff).toBeUndefined();
        expect(renderTriageQuestionsText(report)).toBe(
            [
                `triage questions — started ${NOW.toISOString()}`,
                "outcome: advance",
                "no marked task",
            ].join("\n"),
        );
    });

    it("More questions than a round holds: the handoff carries 4 questions and remaining 2", async () => {
        const { report } = await run(sixMarked);
        expect(report.handoff?.questions).toEqual(report.questions.slice(0, 4));
        expect(report.handoff?.remaining).toBe(2);
        expect(renderTriageQuestionsText(report).split("\n").at(-1)).toBe(
            `handoff: ${JSON.stringify(report.handoff)}`,
        );
    });

    it("No question: a marked task whose groups are all present carries no handoff", async () => {
        const { report } = await run({
            github: [task("github", "gh-1", ["triage-me", "work", "AFK", "proposal"])],
        });
        expect(report.marked).toBe(1);
        expect(report.questions).toEqual([]);
        expect(report.handoff).toBeUndefined();
        expect(renderTriageQuestionsText(report)).toContain("marked: 1 task");
    });

    it("an unmarked task with a doubt contributes no question", async () => {
        const { report } = await run({
            github: [task("github", "gh-1", ["AFK", "proposal"]), task("github", "gh-2", [])],
            beads: [task("beads", "bd-1", ["triage-me", "work", "proposal"])],
        });
        expect(report.marked).toBe(1);
        expect(headers(report.questions)).toEqual(["bd-1"]);
    });

    it("a marked task lacking both scope and autonomy contributes two questions", async () => {
        const { report } = await run({ github: [task("github", "gh-1", ["triage-me"])] });
        expect(report.questions.map((q) => q.id)).toHaveLength(2);
        expect(new Set(report.questions.map((q) => q.id)).size).toBe(2);
        expect(report.questions.map((q) => q.question.split("\n")[0])).toEqual([
            'github gh-1 "Task gh-1": which scope label?',
            'github gh-1 "Task gh-1": which autonomy label?',
        ]);
    });

    it("asks a group that conflicting rule evidence leaves undecided, with the contract's reason", async () => {
        const cfg = config();
        cfg.sources.linear = {
            enabled: true,
            scope: "personal",
            aliases: { work: ["nazaries"] },
        };
        const { report } = await run(
            { linear: [task("linear", "DOT-1", ["triage-me", "nazaries", "AFK", "proposal"])] },
            cfg,
        );
        expect(report.questions).toHaveLength(1);
        expect(report.questions[0]?.question).toContain("invalid under the contract");
        expect(report.questions[0]?.question).toContain("conflicting evidence");
    });

    it("Source unreachable: the reason names Linear and the command, and no question is printed", async () => {
        const { report, writes } = await run({
            ...sixMarked,
            linear: "linear issue query --json: linear failed: unreachable",
        });
        expect(report.outcome).toBe("not-evaluable");
        expect(report.questions).toEqual([]);
        expect(report.handoff).toBeUndefined();
        expect(report.reasons).toEqual([
            "linear: linear issue query --json: linear failed: unreachable",
        ]);
        expect(writes).toEqual([]);
        const text = renderTriageQuestionsText(report);
        expect(text).toContain("reason: linear: linear issue query --json");
        expect(text).not.toContain("no marked task");
    });
});

describe("renderers", () => {
    it("emits one autonomous.triage-questions.v1 JSON document", async () => {
        const { report } = await run(sixMarked);
        const parsed = JSON.parse(renderTriageQuestionsJson(report)) as TriageQuestionsReport;
        expect(parsed).toMatchObject({
            schema: TRIAGE_QUESTIONS_SCHEMA,
            startedAt: NOW.toISOString(),
            outcome: "advance",
            marked: 6,
            reasons: [],
        });
        expect(parsed.schema).toBe("autonomous.triage-questions.v1");
        expect(parsed.questions).toHaveLength(6);
        expect(parsed.handoff?.remaining).toBe(2);
    });

    it("omits the handoff key from the JSON when there is no question", async () => {
        const { report } = await run({});
        expect(JSON.parse(renderTriageQuestionsJson(report))).not.toHaveProperty("handoff");
    });

    it("prints one block per question, then the handoff as the last line", async () => {
        const { report } = await run({
            github: [task("github", "gh-1", ["triage-me", "AFK", "proposal"])],
        });
        const lines = renderTriageQuestionsText(report).split("\n");
        expect(lines.slice(0, 3)).toEqual([
            `triage questions — started ${NOW.toISOString()}`,
            "outcome: advance",
            "marked: 1 task",
        ]);
        expect(lines[3]).toBe(`question ${report.questions[0]?.id}`);
        expect(lines).toContain('  github gh-1 "Task gh-1": which scope label?');
        expect(lines.at(-2)).toMatch(/^ {2}options: work \| personal \| Later$/);
        expect(lines.at(-1)).toMatch(/^handoff: /);
    });

    it("a configuration that cannot be loaded is one not-evaluable document with the error", () => {
        const report = unconfiguredTriageQuestions(
            "/c/config.json",
            "/c/config.json: missing",
            NOW,
        );
        expect(report).toEqual({
            schema: TRIAGE_QUESTIONS_SCHEMA,
            startedAt: NOW.toISOString(),
            outcome: "not-evaluable",
            marked: 0,
            questions: [],
            reasons: ["/c/config.json: missing"],
        });
        expect(unconfiguredTriageQuestions("/c/config.json", "unreadable", NOW).reasons).toEqual([
            "/c/config.json: unreadable",
        ]);
    });
});
