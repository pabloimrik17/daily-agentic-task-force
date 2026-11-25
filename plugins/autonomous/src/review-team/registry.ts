// The seven reviewers as plain data (spec review-team, "Reviewers per tier" and
// "The plugin's own reviewers are required"; design D2). Tier rows only name an entry; a new
// reviewer is a new entry here, its brief or runner, and a row in the configuration.

import { SEVERITY_TABLES } from "./severity.ts";
import type { ReviewerId } from "./types.ts";

export interface RegistryEntry {
    id: ReviewerId;
    angle: string;
    kind: "cli" | "teammate";
    required: boolean;
    brief?: string; // under skills/review-team/reviewers/, teammates only
    tool: string; // the engine tool the report names
    severity: (typeof SEVERITY_TABLES)[ReviewerId];
}

function teammate(id: ReviewerId, angle: string, required = false): RegistryEntry {
    return {
        id,
        angle,
        kind: "teammate",
        required,
        brief: `${id}.md`,
        tool: "claude-code",
        severity: SEVERITY_TABLES[id],
    };
}

function cli(id: ReviewerId, angle: string, tool: string): RegistryEntry {
    return { id, angle, kind: "cli", required: false, tool, severity: SEVERITY_TABLES[id] };
}

export const REGISTRY: Readonly<Record<ReviewerId, RegistryEntry>> = {
    walkthrough: teammate("walkthrough", "comprehension", true),
    "code-review": teammate("code-review", "correctness"),
    codex: cli("codex", "correctness from another model family", "codex"),
    coderabbit: cli("coderabbit", "what the CodeRabbit bot would say, earlier", "coderabbit"),
    "fallow-review": teammate("fallow-review", "structure: boundaries, public API, dependencies"),
    "tests-lens": teammate("tests-lens", "tests and silent failures", true),
    "security-review": teammate("security-review", "security"),
};
