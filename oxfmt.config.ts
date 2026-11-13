import type { OxfmtConfig } from "oxfmt";

export default {
    ignorePatterns: [
        "node_modules/",
        // Agent scaffolding, not source. Mirrored in 4 sibling configs; see AGENTS.md.
        "openspec/",
        ".agents/",
        ".claude/",
        ".junie/",
        ".opencode/",
        ".pi/",
        ".agent/",
        ".amazonq/",
        ".codex/",
        ".cursor/",
        ".gemini/",
        ".github/agents/",
        ".github/prompts/",
        ".github/skills/",
        ".github/copilot-instructions.md",
        // husky's generated shim directory
        ".husky/_/",
        // Read with `markdownlint --config`, whose parser rejects the trailing commas the formatter would add.
        ".markdownlint.jsonc",

        // release-please round-trips JSON through JSON.parse/stringify, expanding
        // compact arrays. Upstream WONTFIX (release-please#2319), so formatting
        // what it writes turns every release PR red on the first CI step.
        "**/CHANGELOG.md",
        "plugins/*/.claude-plugin/plugin.json",

        // Vendored Claude Code mod API declarations, third-party code pinned to the
        // tested Claude Code version (stonks design D17).
        "plugins/stonks/mod/types/claude-code.d.ts",
        // Written by Claude Code beside a plugin manifest on every load; git-ignored.
        "plugins/*/.claude-plugin/types/",
    ],
    tabWidth: 4,
    useTabs: false,
    singleAttributePerLine: true,
} satisfies OxfmtConfig;
