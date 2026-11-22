// Each reviewer's own severity words mapped onto the report's scale (spec
// review-team, "Severity comes from fixed tables"; design D3). Code derives
// the severity; a model never chooses one on this scale.

import type { ReviewerId, Severity } from "./types.ts";

type SeverityTable = Readonly<Record<string, Severity>>;

const IDENTITY: SeverityTable = {
    CRITICAL: "CRITICAL",
    WARNING: "WARNING",
    SUGGESTION: "SUGGESTION",
};

export const SEVERITY_TABLES: Readonly<Record<ReviewerId, SeverityTable>> = {
    walkthrough: IDENTITY,
    "tests-lens": IDENTITY,
    "code-review": { important: "CRITICAL", pre_existing: "WARNING", nit: "SUGGESTION" },
    codex: { P0: "CRITICAL", P1: "CRITICAL", P2: "WARNING", P3: "SUGGESTION" },
    coderabbit: {
        critical: "CRITICAL",
        major: "WARNING",
        minor: "SUGGESTION",
        trivial: "SUGGESTION",
        info: "SUGGESTION",
        none: "SUGGESTION",
    },
    "security-review": { High: "CRITICAL", Medium: "WARNING", Low: "SUGGESTION" },
    "fallow-review": {
        block: "CRITICAL",
        address: "WARNING",
        consider: "SUGGESTION",
        fyi: "SUGGESTION",
    },
};

// Undefined for a native severity the reviewer's table does not list.
export function deriveSeverity(reviewer: ReviewerId, native: string): Severity | undefined {
    return Object.hasOwn(SEVERITY_TABLES[reviewer], native)
        ? SEVERITY_TABLES[reviewer][native]
        : undefined;
}
