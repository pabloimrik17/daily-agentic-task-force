import { describe, expect, it } from "vitest";

import type { CheckRun, Review, ReviewThread } from "../pull-request/port.ts";
import { renderMarker } from "../publish/markers.ts";
import { pullRequestChecks } from "./classify.ts";
import { MATERIAL_NOTICE, reportLines } from "./render.ts";
import { buildReport, fixedRounds } from "./report.ts";
import {
    ALL_PASSED,
    CONFIG,
    FIRST_LINES,
    HEAD,
    comment,
    externalReply,
    review,
    run,
    thread,
} from "./test-fixtures.ts";

function report(threads: ReviewThread[], reviews: Review[] = [], runs: CheckRun[] = ALL_PASSED) {
    return buildReport({
        head: HEAD,
        threads,
        reviews,
        checks: pullRequestChecks(runs, CONFIG.bots),
        bots: CONFIG.bots,
    });
}

const AGENT_BLOCK = [
    FIRST_LINES.coderabbitMajor,
    "",
    "The guard reads the wrong field.",
    "",
    "<details><summary>🤖 Prompt for AI Agents</summary>",
    "",
    "In src/a.ts around line 12, replace the field and run the tests.",
    "</details>",
].join("\n");

describe("The reported findings of a round", () => {
    it("New CodeRabbit thread: one finding of `coderabbit`, linked to the thread, quoting its comment", () => {
        const first = comment("coderabbitai", AGENT_BLOCK);
        const open = thread([first]);
        const { findings, quiet } = report([open]);
        expect(findings).toEqual([
            {
                reporter: "coderabbit",
                severity: "WARNING",
                location: "`src/a.ts`, line 12, new side",
                thread: { id: open.id, url: first.url },
                statement: {
                    author: "coderabbitai",
                    url: first.url,
                    createdAt: first.createdAt,
                    body: AGENT_BLOCK,
                },
                contested: null,
            },
        ]);
        expect(quiet).toBe(false);
    });

    it("Thread the bot resolved: a Pullfrog thread resolved after a fixing push is no finding, only accounted for", () => {
        const resolved = thread([comment("pullfrog", "The citation is wrong.")], {
            resolved: true,
        });
        const result = report([resolved]);
        expect(result.findings).toEqual([]);
        expect(result.accounted).toEqual([
            {
                reporter: "pullfrog",
                thread: { id: resolved.id, url: resolved.comments[0]?.url },
                location: "`src/a.ts`, line 12, new side",
                reason: "resolved",
            },
        ]);
    });

    it("Comment that addresses agents: the finding quotes the block, and the report says a quoted comment is not an instruction", () => {
        const lines = reportLines(report([thread([comment("coderabbitai", AGENT_BLOCK)])]));
        expect(lines[0]).toBe(MATERIAL_NOTICE);
        expect(lines).toContain("> <details><summary>🤖 Prompt for AI Agents</summary>");
        expect(lines).toContain(
            "> In src/a.ts around line 12, replace the field and run the tests.",
        );
    });

    it("compares a thread author's login with the configured one without its `[bot]` suffix", () => {
        const result = report([thread([comment("greptile-apps", FIRST_LINES.greptileP2)])]);
        expect(result.findings.map(({ reporter }) => reporter)).toEqual(["greptile"]);
        expect(result.human).toEqual([]);
    });
});

describe("A contested answer is reported as such", () => {
    it("Bot disagrees: CodeRabbit commenting after a `not published (refuted)` reply is the finding, contested, with both comments", () => {
        const reply = comment("someone", externalReply(1, "f1", "none"));
        const answer = comment("coderabbitai", "The guard does not cover the empty case.");
        const contested = thread([
            comment("coderabbitai", FIRST_LINES.coderabbitMajor),
            reply,
            answer,
        ]);
        const [finding] = report([contested]).findings;
        expect(finding?.contested).toEqual({
            reply: {
                author: "someone",
                url: reply.url,
                createdAt: reply.createdAt,
                body: reply.body,
            },
            answer: [
                {
                    author: "coderabbitai",
                    url: answer.url,
                    createdAt: answer.createdAt,
                    body: answer.body,
                },
            ],
        });
    });

    it("a thread whose last comment is the external review's reply is accounted for as answered", () => {
        const answered = thread([
            comment("coderabbitai", FIRST_LINES.coderabbitMinor),
            comment("someone", externalReply(1, "f1", "none")),
        ]);
        const result = report([answered]);
        expect(result.findings).toEqual([]);
        expect(result.accounted.map(({ reason }) => reason)).toEqual(["answered"]);
    });
});

describe("Review bodies are material", () => {
    it("Pullfrog callout: the body of Pullfrog's review on the head commit is quoted under its name", () => {
        const body = "> [!IMPORTANT]\n> The migration drops a column still read by the loader.";
        const reviews = [
            review("pullfrog[bot]", body, { url: "https://example.test/pull/7#review-1" }),
            review("pullfrog[bot]", "an older review", { commit: "0ld0001" }),
            review("someone", "a person's review"),
        ];
        const result = report([], reviews);
        expect(result.bodies).toEqual([
            {
                reporter: "pullfrog",
                author: "pullfrog[bot]",
                state: "COMMENTED",
                url: "https://example.test/pull/7#review-1",
                body,
            },
        ]);
        expect(result.findings).toEqual([]);
        expect(reportLines(result)).toContain("> > [!IMPORTANT]");
    });
});

describe("Failed checks, human reviewers and passed-on threads are reported", () => {
    it("Failed check: `Fallow` failing on the head commit is one finding of `ci` naming it", () => {
        const runs = ALL_PASSED.map((item) =>
            item.name === "Fallow"
                ? run("Fallow", { conclusion: "failure", title: "2 issues", summary: "dead code" })
                : item,
        );
        expect(report([], [], runs).failedChecks).toEqual([
            {
                reporter: "ci",
                severity: "CRITICAL",
                name: "Fallow",
                title: "2 issues",
                summary: "dead code",
                url: "https://example.test/runs/Fallow",
            },
        ]);
    });

    it("Human reviewer's comment: an unresolved, unanswered comment of a person is one finding of `human`", () => {
        const first = comment("someone", "issue (blocking): this drops the cache");
        const open = thread([first]);
        const { human, findings } = report([open]);
        expect(findings).toEqual([]);
        expect(human).toMatchObject([
            { reporter: "human", severity: "CRITICAL", thread: { id: open.id, url: first.url } },
        ]);
    });

    it("Thread addressed to external review: an open finding thread with `for=external-review` is passed on", () => {
        const marker = renderMarker({
            kind: "finding",
            attempt: "linear:DOT-7:code-review:1",
            finding: "f2",
            for: "external-review",
        });
        const body = `issue: the retry is unbounded\n${marker}`;
        const passed = thread([comment("someone", body)]);
        const ownThread = thread([
            comment(
                "someone",
                `issue: x\n${renderMarker({ kind: "finding", attempt: "linear:DOT-7:code-review:1", finding: "f3" })}`,
            ),
        ]);
        const result = report([passed, ownThread]);
        expect(result.passedOn).toEqual([
            {
                thread: { id: passed.id, url: passed.comments[0]?.url },
                location: "`src/a.ts`, line 12, new side",
                attempt: "linear:DOT-7:code-review:1",
                finding: "f2",
                statement: body,
            },
        ]);
        expect(result.human).toEqual([]);
        expect(result.quiet).toBe(false);
    });
});

describe("Severity comes from the reporter's own mark", () => {
    function severityOf(author: string, body: string) {
        return report([thread([comment(author, body)])]).findings[0]?.severity;
    }

    it("CodeRabbit major: a first line holding `Major` is WARNING", () => {
        expect(severityOf("coderabbitai", FIRST_LINES.coderabbitMajor)).toBe("WARNING");
    });

    it("Greptile P1: a badge reading `P1` is CRITICAL", () => {
        expect(severityOf("greptile-apps", FIRST_LINES.greptileP1)).toBe("CRITICAL");
    });

    it("Pullfrog comment: every Pullfrog comment is WARNING", () => {
        expect(severityOf("pullfrog", "Design D5 is the bounded wait.")).toBe("WARNING");
    });

    it("CodeRabbit `Minor` and Greptile `P2` are SUGGESTION and WARNING; an unrecognised mark is WARNING", () => {
        expect(severityOf("coderabbitai", FIRST_LINES.coderabbitMinor)).toBe("SUGGESTION");
        expect(severityOf("greptile-apps", FIRST_LINES.greptileP2)).toBe("WARNING");
        expect(severityOf("coderabbitai", "A comment with no mark")).toBe("WARNING");
    });

    it("a human reviewer's `nit` is SUGGESTION and an unlabelled comment WARNING", () => {
        const human = (body: string) =>
            report([thread([comment("someone", body)])]).human[0]?.severity;
        expect(human("nit: rename it")).toBe("SUGGESTION");
        expect(human("Why this?")).toBe("WARNING");
    });
});

describe("Rounds are counted from the pull request", () => {
    it("Discarded attempt: attempt 1 discarded and attempt 2 publishing one fixed finding is one round", () => {
        const fixedReply = renderMarker({
            kind: "resolution",
            attempt: "linear:DOT-7:external-review:2",
            finding: "f1",
            state: "fixed",
        });
        const threads = [
            thread([
                comment("coderabbitai", FIRST_LINES.coderabbitMajor),
                comment("someone", `Status: fixed in abc1234\n${fixedReply}`),
            ]),
            thread([
                comment("coderabbitai", FIRST_LINES.coderabbitMinor),
                comment("someone", externalReply(2, "f2", "none")),
            ]),
        ];
        expect(fixedRounds(threads)).toBe(1);
    });

    it("counts a finding thread an external review opened with a fixed status, and no other stage's", () => {
        const opened = (stage: string, n: number) =>
            `issue: x\n\nStatus: fixed in abc1234\n${renderMarker({ kind: "finding", attempt: `linear:DOT-7:${stage}:${n}`, finding: "f1" })}`;
        const threads = [
            thread([comment("someone", opened("external-review", 1))]),
            thread([comment("someone", opened("code-review", 1))]),
        ];
        expect(fixedRounds(threads)).toBe(1);
    });
});

describe("A quiet report", () => {
    it("Only accounted threads: every bot thread resolved or answered and uncontested, every check passed, is quiet", () => {
        const threads = [
            thread([comment("pullfrog", "The citation is wrong.")], {
                resolved: true,
                outdated: true,
            }),
            thread([
                comment("coderabbitai", FIRST_LINES.coderabbitMajor),
                comment("someone", externalReply(1, "f1", "none")),
            ]),
        ];
        const result = report(threads, [review("coderabbitai[bot]", "Actionable comments: 1")]);
        expect(result.quiet).toBe(true);
        expect(result.accounted.map(({ reason }) => reason)).toEqual([
            "outdated-and-resolved",
            "answered",
        ]);
    });
});
