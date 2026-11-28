import {
    type DoubtEntry,
    type FindingEntry,
    FINDINGS_SCHEMA,
    type FindingsRecord,
    type RecordEntry,
} from "./record.ts";

export const ATTEMPT = "linear:DOT-121:code-review:1";

export const CHANGE = "add-code-review-stage";

export function finding(overrides: Partial<FindingEntry> = {}): FindingEntry {
    return {
        id: "f1",
        round: 1,
        kind: "finding",
        reporters: [
            { reviewer: "code-review", ids: ["code-review-3"], engine: "Claude Code 2.1.330" },
        ],
        title: "The retry loop never stops when the token is revoked.",
        statement: "A revoked token makes `retry` loop forever.",
        location: { scope: "line", file: "src/retry.ts", startLine: 12, endLine: 12, side: "new" },
        severity: "WARNING",
        label: "issue",
        destination: "fix",
        reason: "A reproduction shows it.",
        refutation: { outcome: "survived", reproduction: 'test/retry.test.ts "stops"' },
        publication: { state: "fixed", commit: "abc1234" },
        thread: null,
        ...overrides,
    };
}

export function doubt(overrides: Partial<DoubtEntry> = {}): DoubtEntry {
    return {
        id: "d1",
        round: 1,
        kind: "doubt",
        reporters: [{ reviewer: "codex", ids: ["codex-2"], engine: "codex 0.171.0" }],
        title: "Should a revoked token be retried at all?",
        statement: "The definition does not say.",
        location: { scope: "change" },
        destination: "publish",
        reason: "Only the human can answer it.",
        publication: { state: "none" },
        thread: null,
        ...overrides,
    };
}

export const ROUND_ONE: readonly RecordEntry[] = [
    finding({
        id: "f1",
        severity: "CRITICAL",
        reporters: [
            { reviewer: "code-review", ids: ["code-review-1"], engine: "Claude Code 2.1.330" },
            { reviewer: "codex", ids: ["codex-1"], engine: "codex 0.171.0" },
        ],
    }),
    finding({
        id: "f2",
        refutation: { outcome: "refuted", reproduction: null },
        publication: { state: "none" },
    }),
    finding({ id: "f3", severity: "SUGGESTION", label: "suggestion" }),
    finding({
        id: "f4",
        destination: "pass-on",
        refutation: { outcome: "not-refuted", reproduction: null },
        publication: { state: "passed-on", stage: "qa" },
    }),
    finding({
        id: "f5",
        destination: "defer",
        publication: {
            state: "deferred",
            followUp: "https://linear.app/monolab/issue/DOT-170",
        },
    }),
    doubt(),
];

export function findingsRecord(entries: readonly RecordEntry[] = ROUND_ONE): FindingsRecord {
    return {
        schema: FINDINGS_SCHEMA,
        attempt: ATTEMPT,
        review: { tier: "M", skipped: [{ reviewer: "coderabbit", reason: "rate limited" }] },
        entries: [...entries],
    };
}

// `findings.json` as the agent writes it; `entries` may hold invalid entries for a test, and
// `fields` replaces or adds top-level fields, such as another attempt or `quiet`.
export function recordText(
    entries: readonly unknown[] = ROUND_ONE,
    fields: Readonly<Record<string, unknown>> = {},
): string {
    return JSON.stringify({ ...findingsRecord([]), entries, ...fields }, null, 2);
}

// A final diff with a modified, an added, a renamed, a deleted and a binary file, as
// `git diff --src-prefix=a/ --dst-prefix=b/` writes it.
export const DIFF = [
    "diff --git a/src/retry.ts b/src/retry.ts",
    "index 1111111..2222222 100644",
    "--- a/src/retry.ts",
    "+++ b/src/retry.ts",
    "@@ -10,4 +10,5 @@ export function retry() {",
    "     const token = read();",
    "-    while (true) {",
    "+    while (!token.revoked) {",
    "+        wait();",
    "         send(token);",
    "     }",
    "@@ -40,3 +41,3 @@ function wait() {",
    "-    -- an old comment",
    "+    // a new comment",
    "     return;",
    " }",
    "\\ No newline at end of file",
    `diff --git a/openspec/changes/${CHANGE}/proposal.md b/openspec/changes/${CHANGE}/proposal.md`,
    "new file mode 100644",
    "index 0000000..3333333",
    "--- /dev/null",
    `+++ b/openspec/changes/${CHANGE}/proposal.md`,
    "@@ -0,0 +1,2 @@",
    "+## Why",
    "+",
    "diff --git a/src/old-name.ts b/src/new-name.ts",
    "similarity index 100%",
    "rename from src/old-name.ts",
    "rename to src/new-name.ts",
    "diff --git a/src/gone.ts b/src/gone.ts",
    "deleted file mode 100644",
    "index 4444444..0000000",
    "--- a/src/gone.ts",
    "+++ /dev/null",
    "@@ -1,2 +0,0 @@",
    "-export const gone = 1;",
    "--- not a header",
    "diff --git a/assets/logo.png b/assets/logo.png",
    "index 5555555..6666666 100644",
    "Binary files a/assets/logo.png and b/assets/logo.png differ",
    "",
].join("\n");
