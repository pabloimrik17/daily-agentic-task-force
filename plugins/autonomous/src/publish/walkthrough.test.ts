import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Exec, ExecResult } from "../exec.ts";
import { temporaryDirectories } from "../stages/test-fixtures.ts";
import { parseDiff } from "./anchor.ts";
import { digestOf } from "./receipt.ts";
import {
    type PlannotatorAccess,
    updateWalkthrough,
    type WalkthroughInput,
    type WalkthroughNote,
} from "./walkthrough.ts";

const FIXTURES = join(import.meta.dirname, "fixtures", "walkthrough");
const DRAFT_PATCH = readFileSync(join(FIXTURES, "draft.patch"), "utf8");
const FINAL_PATCH = readFileSync(join(FIXTURES, "final.patch"), "utf8");
const DRAFT_TEXT = readFileSync(join(FIXTURES, "draft.json"), "utf8");
const PULL_REQUEST = "https://github.com/acme/uploads/pull/7";
const FILES = ["walkthrough.json", "walkthrough.patch", "walkthrough.md"];

interface GuideNote {
    lineStart: number;
    lineEnd: number;
    side?: string;
    text: string;
}

interface Guide {
    title: string;
    intent: string;
    sections: {
        title: string;
        overview: string;
        diffs: { file: string; summary: string; notes?: GuideNote[] }[];
    }[];
    unplacedFiles: string[];
}

const directories = temporaryDirectories("walkthrough");
let dir: string;
let calls: string[][];

function note(overrides: Partial<WalkthroughNote> = {}): WalkthroughNote {
    return {
        finding: "f1",
        label: "issue (blocking)",
        statement: "A revoked token makes `retry` loop forever.",
        status: "fixed in abc1234",
        url: `${PULL_REQUEST}#discussion_r1`,
        location: { scope: "line", file: "src/retry.ts", startLine: 12, endLine: 12, side: "new" },
        ...overrides,
    };
}

function input(overrides: Partial<WalkthroughInput> = {}): WalkthroughInput {
    const patch = overrides.patch ?? FINAL_PATCH;
    return {
        attemptDir: dir,
        patch,
        files: parseDiff(patch),
        notes: [],
        pullRequestUrl: PULL_REQUEST,
        lastDigest: null,
        ...overrides,
    };
}

function plannotator(answers: Partial<Record<string, ExecResult>> = {}): PlannotatorAccess {
    const exec: Exec = (args) => {
        calls.push(args);
        return Promise.resolve(answers[args[1] ?? ""] ?? { ok: true, stdout: "" });
    };
    return { available: true, exec };
}

function writeDraft(text: string = DRAFT_TEXT): void {
    mkdirSync(join(dir, "review"), { recursive: true });
    writeFileSync(join(dir, "review", "walkthrough.json"), text);
}

const draft = () => JSON.parse(DRAFT_TEXT) as Guide;
const guide = () => JSON.parse(readFileSync(join(dir, "walkthrough.json"), "utf8")) as Guide;
const walkthroughFiles = () => readdirSync(dir).filter((name) => FILES.includes(name));
const subcommands = () => calls.map((args) => args[1]);

beforeEach(() => {
    calls = [];
    dir = directories.make("attempt");
    writeDraft();
});

afterEach(async () => {
    await directories.removeAll();
});

describe("the walkthrough follows the final diff", () => {
    it("Fix added a test file: the draft's sections and a trailing section placing it", async () => {
        const outcome = await updateWalkthrough(input(), plannotator());

        expect(outcome.outcome).toBe("saved");
        const written = guide();
        expect(written.sections.slice(0, 3)).toEqual(draft().sections);
        expect(written.sections[3]).toEqual({
            title: "Code review fixes",
            overview:
                "Files the code review's fixes changed that the walkthrough does not place elsewhere.",
            diffs: [{ file: "test/retry.test.ts", summary: "Changed by a code review fix." }],
        });
        expect(readFileSync(join(dir, "walkthrough.patch"), "utf8")).toBe(FINAL_PATCH);
    });

    it("Nothing added: no Code review fixes section, the draft as written", async () => {
        const outcome = await updateWalkthrough(input({ patch: DRAFT_PATCH }), plannotator());

        expect(outcome.outcome).toBe("saved");
        expect(guide()).toEqual(draft());
    });

    it("a file the draft leaves unplaced stays unplaced, with no section of fixes", async () => {
        writeDraft(JSON.stringify({ ...draft(), unplacedFiles: ["test/retry.test.ts"] }, null, 4));

        await updateWalkthrough(input(), plannotator());

        expect(guide().sections.map((section) => section.title)).not.toContain("Code review fixes");
    });

    it("is checked against the final patch: by placement, then by Plannotator", async () => {
        await updateWalkthrough(input(), plannotator());

        expect(calls[0]).toEqual([
            "guide",
            "export",
            "--guide",
            join(dir, "walkthrough.json"),
            "--patch",
            join(dir, "walkthrough.patch"),
            "--out",
            "-",
        ]);
    });
});

describe("each published finding is a note", () => {
    it("Finding on a line: a note on its hunk naming its label, statement, state and URL", async () => {
        await updateWalkthrough(input({ notes: [note()] }), plannotator());

        expect(guide().sections[0]?.diffs[0]?.notes).toEqual([
            {
                lineStart: 12,
                lineEnd: 12,
                text: `issue (blocking): A revoked token makes \`retry\` loop forever. (fixed in abc1234, ${PULL_REQUEST}#discussion_r1)`,
            },
        ]);
        expect(guide().sections[0]?.overview).toBe(draft().sections[0]?.overview);
    });

    it("a note on a removed line carries its side", async () => {
        const removed = note({
            location: {
                scope: "line",
                file: "src/retry.ts",
                startLine: 40,
                endLine: 40,
                side: "old",
            },
        });

        await updateWalkthrough(input({ notes: [removed] }), plannotator());

        expect(guide().sections[0]?.diffs[0]?.notes?.[0]).toMatchObject({
            lineStart: 40,
            lineEnd: 40,
            side: "old",
        });
    });

    it("a line no single hunk holds goes to its section's overview", async () => {
        const across = note({
            location: {
                scope: "line",
                file: "src/retry.ts",
                startLine: 13,
                endLine: 42,
                side: "new",
            },
        });

        await updateWalkthrough(input({ notes: [across] }), plannotator());

        const section = guide().sections[0];
        expect(section?.diffs[0]?.notes).toBeUndefined();
        expect(section?.overview).toBe(
            [
                "The loop stops once the token is revoked.",
                "",
                `- issue (blocking) on \`src/retry.ts:13-42\`: A revoked token makes \`retry\` loop forever. (fixed in abc1234, ${PULL_REQUEST}#discussion_r1)`,
            ].join("\n"),
        );
    });

    it("Finding on a file: the overview of the section placing the file names it", async () => {
        const onFile = note({
            label: "suggestion",
            statement: "The upload import is\nunused.",
            status: "passed on to QA #qa",
            location: { scope: "file", file: "src/client.ts" },
        });

        await updateWalkthrough(input({ notes: [onFile] }), plannotator());

        expect(guide().sections[1]?.overview).toBe(
            [
                "The client wires the retry loop in.",
                "",
                `- suggestion on \`src/client.ts\`: The upload import is unused. (passed on to QA #qa, ${PULL_REQUEST}#discussion_r1)`,
            ].join("\n"),
        );
        expect(guide().sections[1]).toHaveProperty("diagram");
    });

    it("a finding on the whole change, or on a file no section places, goes to the first section", async () => {
        const onChange = note({ finding: "f2", location: { scope: "change" } });
        const elsewhere = note({ finding: "f3", location: { scope: "file", file: "src/gone.ts" } });

        await updateWalkthrough(input({ notes: [onChange, elsewhere] }), plannotator());

        const lines = guide().sections[0]?.overview.split("\n").slice(2);
        expect(lines).toEqual([
            `- issue (blocking): A revoked token makes \`retry\` loop forever. (fixed in abc1234, ${PULL_REQUEST}#discussion_r1)`,
            `- issue (blocking) on \`src/gone.ts\`: A revoked token makes \`retry\` loop forever. (fixed in abc1234, ${PULL_REQUEST}#discussion_r1)`,
        ]);
    });

    it("a line in a file the fixes added is a note in the Code review fixes section", async () => {
        const inTest = note({
            location: {
                scope: "line",
                file: "test/retry.test.ts",
                startLine: 3,
                endLine: 3,
                side: "new",
            },
        });

        await updateWalkthrough(input({ notes: [inTest] }), plannotator());

        expect(guide().sections[3]?.diffs[0]?.notes).toHaveLength(1);
    });
});

describe("no walkthrough without a draft or Plannotator", () => {
    it("Plannotator missing: no walkthrough, and the reason says Plannotator is not available", async () => {
        const outcome = await updateWalkthrough(input({ notes: [note()] }), {
            available: false,
            reason: "plannotator CLI not found on PATH",
        });

        expect(outcome).toEqual({
            outcome: "none",
            reason: "Plannotator is not available (plannotator CLI not found on PATH)",
        });
        expect(walkthroughFiles()).toEqual([]);
    });

    it("has no walkthrough when the review team wrote no draft", async () => {
        const empty = directories.make("empty");

        const outcome = await updateWalkthrough(input({ attemptDir: empty }), plannotator());

        expect(outcome).toEqual({
            outcome: "none",
            reason: "the review team wrote no walkthrough draft (review/walkthrough.json)",
        });
        expect(calls).toEqual([]);
    });

    it("an invalid draft is no walkthrough, and leaves no walkthrough files behind", async () => {
        const { intent: _intent, ...withoutIntent } = draft();
        writeDraft(JSON.stringify(withoutIntent));
        for (const name of FILES) {
            writeFileSync(join(dir, name), "from an earlier run\n");
        }

        const outcome = await updateWalkthrough(input(), plannotator());

        expect(outcome).toEqual({
            outcome: "none",
            reason: "review/walkthrough.json is not a guide: $.intent must be a string",
        });
        expect(walkthroughFiles()).toEqual([]);
        expect(calls).toEqual([]);
    });

    it("a draft placing a file the final patch lacks fails validation, and leaves nothing", async () => {
        const { sections, ...rest } = draft();
        const extra = {
            title: "Gone",
            overview: "Removed.",
            diffs: [{ file: "src/gone.ts", summary: "x" }],
        };
        writeDraft(JSON.stringify({ ...rest, sections: [...sections, extra] }));

        const outcome = await updateWalkthrough(input(), plannotator());

        expect(outcome).toEqual({
            outcome: "none",
            reason: "walkthrough.json is not valid: src/gone.ts is not in the patch",
        });
        expect(walkthroughFiles()).toEqual([]);
        expect(calls).toEqual([]);
    });

    it("Plannotator rejecting the walkthrough is no walkthrough, with its message", async () => {
        const rejecting = plannotator({
            export: { ok: false, error: "plannotator failed: Guide is not valid" },
        });

        const outcome = await updateWalkthrough(input(), rejecting);

        expect(outcome).toEqual({
            outcome: "none",
            reason: "plannotator guide export: plannotator failed: Guide is not valid",
        });
        expect(walkthroughFiles()).toEqual([]);
    });

    it("a failed save is no walkthrough, with its message, and leaves nothing", async () => {
        const failing = plannotator({
            import: { ok: false, error: "plannotator failed: no repo" },
        });

        const outcome = await updateWalkthrough(input(), failing);

        expect(outcome).toEqual({
            outcome: "none",
            reason: "plannotator guide import: plannotator failed: no repo",
        });
        expect(walkthroughFiles()).toEqual([]);
    });

    it("never rejects: a file that cannot be written is no walkthrough", async () => {
        mkdirSync(join(dir, "walkthrough.json", "taken"), { recursive: true });

        const outcome = await updateWalkthrough(input(), plannotator());

        expect(outcome.outcome).toBe("none");
        expect(outcome.outcome === "none" && outcome.reason).toMatch(/^updating the walkthrough: /);
    });
});

describe("the walkthrough is saved for the pull request", () => {
    it("saves it with the walkthrough, its patch and the pull request", async () => {
        const outcome = await updateWalkthrough(input(), plannotator());

        const json = readFileSync(join(dir, "walkthrough.json"), "utf8");
        const digest = digestOf(JSON.stringify([json, FINAL_PATCH]));
        expect(outcome).toEqual({ outcome: "saved", digest });
        expect(calls[1]).toEqual([
            "guide",
            "import",
            "--guide",
            join(dir, "walkthrough.json"),
            "--patch",
            join(dir, "walkthrough.patch"),
            "--pr",
            PULL_REQUEST,
        ]);
    });

    it("Saved once: a second run with nothing changed is not saved again", async () => {
        const access = plannotator();
        const first = await updateWalkthrough(input({ notes: [note()] }), access);
        const digest = first.outcome === "saved" ? first.digest : null;

        const second = await updateWalkthrough(
            input({ notes: [note()], lastDigest: digest }),
            access,
        );

        expect(second).toEqual({ outcome: "unchanged", digest });
        expect(subcommands()).toEqual(["export", "import", "export"]);
        expect(walkthroughFiles().sort()).toEqual([...FILES].sort());
    });

    it("saves it again when only the patch's content changed", async () => {
        const access = plannotator();
        const first = await updateWalkthrough(input(), access);
        const digest = first.outcome === "saved" ? first.digest : null;
        const before = readFileSync(join(dir, "walkthrough.json"), "utf8");
        const patch = FINAL_PATCH.replace("+        wait();", "+        pause();");
        expect(patch).not.toBe(FINAL_PATCH);

        const second = await updateWalkthrough(input({ patch, lastDigest: digest }), access);

        expect(readFileSync(join(dir, "walkthrough.json"), "utf8")).toBe(before);
        expect(second.outcome).toBe("saved");
        expect(second).not.toEqual(first);
        expect(subcommands()).toEqual(["export", "import", "export", "import"]);
    });

    it("Changed by a human round: the new walkthrough is saved", async () => {
        const access = plannotator();
        const first = await updateWalkthrough(input({ notes: [note()] }), access);
        const digest = first.outcome === "saved" ? first.digest : null;
        const human = note({
            finding: "f9",
            label: "issue",
            status: "fixed in def5678",
            url: `${PULL_REQUEST}#discussion_r9`,
            location: { scope: "file", file: "README.md" },
        });

        const second = await updateWalkthrough(
            input({ notes: [note(), human], lastDigest: digest }),
            access,
        );

        expect(second.outcome).toBe("saved");
        expect(second).not.toEqual(first);
        expect(subcommands()).toEqual(["export", "import", "export", "import"]);
    });
});

describe("the walkthrough files for the session and the logbook", () => {
    it("Rendering: the title, the intent, and each section with its count of findings", async () => {
        const across = note({
            finding: "f2",
            location: {
                scope: "line",
                file: "src/retry.ts",
                startLine: 13,
                endLine: 42,
                side: "new",
            },
        });

        await updateWalkthrough(
            input({ patch: DRAFT_PATCH, notes: [note(), across] }),
            plannotator(),
        );

        expect(readFileSync(join(dir, "walkthrough.md"), "utf8")).toBe(
            [
                "**Retry failed uploads**",
                "",
                "Uploads that fail on a network error are retried three times before the user sees an error.",
                "",
                "- The retry loop: 2 findings",
                "- The upload client: 0 findings",
                "- Documentation: 0 findings",
                "",
            ].join("\n"),
        );
        expect(existsSync(join(dir, "walkthrough.patch"))).toBe(true);
    });
});
