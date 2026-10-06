import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// Only the frontmatter keeps `/stonks:sync` the user's to start and limits what
// it runs without a prompt (spec stonks-sync "User-only command", "Pre-approved
// tools"), so a widened entry has to fail here.

const COMMAND = readFileSync(new URL("../commands/sync.md", import.meta.url), "utf8");

const PRE_APPROVED = [
    "mcp__ibkr__get_account_positions",
    "mcp__ibkr__get_account_orders",
    "Bash(bun:*)",
];

/** The lines between the first two `---` lines, as `key: value` fields. */
function frontmatter(markdown: string): { start: number; fields: Map<string, string> } {
    const lines = markdown.split("\n").map((line) => line.trimEnd());
    const start = lines.indexOf("---");
    const end = lines.indexOf("---", start + 1);
    const fields = new Map<string, string>();
    for (const line of lines.slice(start + 1, end === -1 ? start + 1 : end)) {
        const colon = line.indexOf(":");
        if (colon > 0) {
            fields.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
        }
    }
    return { start, fields };
}

describe("commands/sync.md frontmatter", () => {
    const { start, fields } = frontmatter(COMMAND);

    it("opens the file", () => {
        expect(start).toBe(0);
    });

    it("leaves the command to the user", () => {
        expect(fields.get("disable-model-invocation")).toBe("true");
    });

    it("pre-approves the two IBKR reads and bun, and nothing else", () => {
        const tools = (fields.get("allowed-tools") ?? "").split(",").map((tool) => tool.trim());
        expect([...tools].sort()).toEqual([...PRE_APPROVED].sort());
    });
});
