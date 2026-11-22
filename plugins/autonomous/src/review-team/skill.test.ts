// The review team skill and its reviewers' briefs (spec review-team, "The review team skill",
// "The review team only reports", "Doubts are reported apart" and "The walkthrough draft";
// design D1, D2, D9 and D13). The texts are hard-wrapped, so phrases are compared with
// whitespace collapsed.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { stripFrontmatter } from "../stages/skills.ts";
import { REGISTRY } from "./registry.ts";
import { parseReviewerFile } from "./schema.ts";
import { SEVERITY_TABLES } from "./severity.ts";
import { REVIEWER_IDS, type ReviewerId } from "./types.ts";

const SKILL_DIR = new URL("../../skills/review-team/", import.meta.url);
const SKILL_TEXT = readFileSync(new URL("SKILL.md", SKILL_DIR), "utf8");
const BODY = collapse(stripFrontmatter(SKILL_TEXT));

// The placeholders plan.ts fills in, and the briefs that alone may use the last two.
const PLACEHOLDERS = ["OUTPUT", "BASE", "MERGE_BASE", "HEAD", "REVIEWER", "NATIVE_SEVERITIES"];
const OWN_PLACEHOLDERS: Readonly<Record<string, ReviewerId>> = {
    LEVEL: "code-review",
    GUIDE_OUTPUT: "walkthrough",
};

const TEAMMATES = REVIEWER_IDS.filter((id) => REGISTRY[id].kind === "teammate");
const BUILT_INS: readonly ReviewerId[] = ["code-review", "security-review", "fallow-review"];

function collapse(text: string): string {
    return text.replace(/\s+/g, " ");
}

function frontmatter(key: string): string | undefined {
    const block = SKILL_TEXT.split("---\n")[1] ?? "";
    const line = block.split("\n").find((entry) => entry.startsWith(`${key}: `));
    return line?.slice(key.length + 2);
}

function briefText(id: ReviewerId): string {
    return readFileSync(new URL(`reviewers/${REGISTRY[id].brief}`, SKILL_DIR), "utf8");
}

function placeholders(text: string): string[] {
    return [...text.matchAll(/\{\{([^}]*)\}\}/g)].map((match) => match[1] ?? "");
}

function fill(text: string, id: ReviewerId): string {
    const values: Record<string, string> = {
        OUTPUT: `/tmp/review/reviewers/${id}.json`,
        BASE: "main",
        MERGE_BASE: "1a2b3c4",
        HEAD: "5d6e7f8",
        LEVEL: "high",
        GUIDE_OUTPUT: "/tmp/review/walkthrough.json",
        REVIEWER: id,
        NATIVE_SEVERITIES: Object.keys(SEVERITY_TABLES[id]).join(", "),
    };
    return text.replace(/\{\{([A-Z_]+)\}\}/g, (_, name: string) => values[name] ?? "");
}

function jsonBlocks(text: string): unknown[] {
    return [...text.matchAll(/```json\n([\s\S]*?)```/g)].map((match): unknown =>
        JSON.parse(match[1] ?? ""),
    );
}

function exampleFile(id: ReviewerId): unknown {
    return jsonBlocks(fill(briefText(id), id)).find(
        (block) => typeof block === "object" && block !== null && "schema" in block,
    );
}

describe("the review team skill", () => {
    it("General review request: the description claims only a request that names the review team", () => {
        expect(frontmatter("name")).toBe("review-team");
        expect(frontmatter("description")).toContain(
            "Use only when a request names the review team, or a stage or another skill says to follow the review team.",
        );
        expect(frontmatter("description")).toContain(
            "Never use it for a request to review a pull request, change or code that does not name the review team.",
        );
    });

    it("lets the skill run the review team's CLI and nothing else", () => {
        expect(frontmatter("allowed-tools")).toBe(
            "Bash(bun ${CLAUDE_PLUGIN_ROOT}/src/review-team/cli.ts *)",
        );
    });

    it("plans, starts the teammates and the CLI reviewers, collects, then summarises", () => {
        const steps = [
            "cli.ts plan [--base <ref>] [--tier <S|M|L> --reason <text>] [--dir <dir>]",
            "start one fresh, read-only teammate, with the model and effort the entry's `engine` names",
            "cli.ts run <reviewer> --dir <dir>",
            "Start all of them at the same time.",
            "Wait until every teammate has ended and every `run` has exited.",
            "cli.ts collect --dir <dir>",
            "summarise it in the chat",
        ];
        const positions = steps.map((step) => BODY.indexOf(step));
        expect(positions).not.toContain(-1);
        expect(positions).toEqual([...positions].sort((a, b) => a - b));
        expect(BODY).toContain("as its whole task, and nothing else");
    });

    it("reports a refused plan as it is instead of working around it", () => {
        expect(BODY).toContain("Exit 2 is a refused request");
        expect(BODY).toContain("tell the person the tool's message as it is and stop");
        expect(BODY).toContain("Do not retry with other options or work around the refusal.");
    });

    it("The review team only reports: no triage, no merging, no refuting, no fixing, nothing posted", () => {
        expect(BODY).toContain("The review team only reports.");
        expect(BODY).toContain(
            "Never triage a finding, merge findings by root cause, refute a finding or fix one, and post nothing to a pull request or a tracker.",
        );
    });

    it("never touches a reviewer's file and never replaces a skipped reviewer", () => {
        expect(BODY).toContain(
            "Never write or edit a reviewer's file, never re-rate a severity, and never drop or reword a finding in those files.",
        );
        expect(BODY).toContain("A skipped reviewer is reported, not replaced.");
        expect(BODY).toContain(
            "A teammate that ends without writing its file is not retried and not written for",
        );
    });

    it("Run by hand: the summary names the tier, the reviewers, the findings, the doubts and the directory", () => {
        for (const point of [
            "the tier: the measured one, the one used, and why;",
            "who ran, and who was skipped and why;",
            "the findings by severity, `CRITICAL` first, each with its location;",
            "the doubts, apart from the findings;",
            "the walkthrough's guide, or why there is none;",
            "the path of the report directory;",
            "that uncommitted changes were left out of the review",
        ]) {
            expect(BODY).toContain(point);
        }
    });

    it("tells how the built-in reviewers are run and transcribed", () => {
        expect(BODY).toContain("without adding, dropping or re-rating any");
        expect(BODY).toContain("`[low|medium|high|xhigh|max] [<branch>|<path>]`");
        expect(BODY).toContain(
            "It posts nothing without `--comment` and fixes nothing without `--fix`",
        );
        expect(BODY).toContain("`/security-review`");
        expect(BODY).toContain("`fallow:fallow-review`");
    });
});

describe.each(TEAMMATES)("the %s brief", (id) => {
    const text = briefText(id);
    const brief = collapse(text);

    it("uses only the placeholders plan.ts fills in, and names its output", () => {
        for (const name of placeholders(text)) {
            const allowed = PLACEHOLDERS.includes(name) || OWN_PLACEHOLDERS[name] === id;
            expect(allowed, `{{${name}}}`).toBe(true);
        }
        expect(text).toContain("{{OUTPUT}}");
        expect(text).toContain("{{NATIVE_SEVERITIES}}");
    });

    it("names the subject as committed work from the merge base", () => {
        expect(brief).toContain("The subject is the committed work `{{MERGE_BASE}}..{{HEAD}}`");
        expect(brief).toContain("base with `{{BASE}}`");
        expect(brief).toContain("git diff {{MERGE_BASE}} {{HEAD}}");
    });

    it("states every rule: only report, change no file, nothing posted, doubts apart, the output path", () => {
        expect(brief).toContain("You only report.");
        expect(brief).toContain("Change no file of the repository");
        expect(brief).toContain("Post nothing anywhere");
        expect(brief).toContain(
            "as a doubt, apart from the findings: kind `doubt`, label `question`, and no severity",
        );
        expect(brief).toMatch(/to `\{\{OUTPUT\}\}`[^.]* and nothing else/);
        expect(brief).toContain("An empty `items` array is a valid review");
    });

    it("describes the file shape: scopes, relative paths and the native severities", () => {
        for (const scope of ['"scope": "line"', '"scope": "file"', '"scope": "change"']) {
            expect(brief).toContain(scope);
        }
        expect(brief).toContain("relative to the repository root, with forward slashes");
        expect(brief).toContain("`nativeSeverity` is one of {{NATIVE_SEVERITIES}}");
        expect(brief).toContain("It has no `nativeSeverity` and no `suggestedFix`.");
    });

    it("shows an example file with one finding and one doubt that the schema accepts", () => {
        const parsed = parseReviewerFile(exampleFile(id));
        expect(parsed.ok ? "" : parsed.error).toBe("");
        if (!parsed.ok || parsed.value.outcome !== "reported") {
            return;
        }
        expect(parsed.value.reviewer).toBe(id);
        expect(parsed.value.items.map((item) => item.kind)).toEqual(["finding", "doubt"]);
    });
});

describe.each(BUILT_INS)("the %s brief, which runs a skill", (id) => {
    const brief = collapse(briefText(id));

    it("transcribes every reported finding and adds none", () => {
        expect(brief).toContain("no finding of your own");
        expect(brief).toContain("If the skill");
        expect(brief).toContain("write no file");
    });
});

describe("the briefs of the built-in skills", () => {
    it("runs /code-review at the tier's level from the merge base, posting and fixing nothing", () => {
        const brief = collapse(briefText("code-review"));
        expect(brief).toContain("/code-review {{LEVEL}} {{MERGE_BASE}}");
        expect(brief).toContain("Pass no `--comment`");
        expect(brief).toContain("no `--fix`");
    });

    it("runs /security-review and fallow:fallow-review", () => {
        expect(collapse(briefText("security-review"))).toContain(
            "Invoke the built-in skill `/security-review`",
        );
        expect(collapse(briefText("fallow-review"))).toContain(
            "Invoke the `fallow:fallow-review` skill",
        );
    });
});

describe("the walkthrough brief", () => {
    const text = briefText("walkthrough");
    const brief = collapse(text);

    it("Guide written: asks for a Plannotator guide that places every changed file once", () => {
        expect(brief).toContain("the guide to `{{GUIDE_OUTPUT}}`");
        expect(brief).toContain("Place every changed file exactly once");
        const guide = jsonBlocks(fill(text, "walkthrough")).find(
            (block) => typeof block === "object" && block !== null && "sections" in block,
        );
        expect(Object.keys(guide ?? {})).toEqual(["title", "intent", "sections", "unplacedFiles"]);
    });
});

describe("the tests lens brief", () => {
    const brief = collapse(briefText("tests-lens"));

    it("looks for weak tests and silent failures, on the review team's own scale", () => {
        for (const angle of [
            "Tests that do not test what they claim.",
            "Missing cases for changed behaviour.",
            "Assertions that cannot fail.",
            "Silent failures.",
        ]) {
            expect(brief).toContain(angle);
        }
        for (const severity of ["`CRITICAL`:", "`WARNING`:", "`SUGGESTION`:"]) {
            expect(brief).toContain(severity);
        }
    });
});
