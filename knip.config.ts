import type { KnipConfig } from "knip";

export default {
    // Agent scaffolding, not source. Mirrored in 4 sibling configs; see CLAUDE.md.
    ignore: [
        "openspec/**",
        ".agents/**",
        ".claude/**",
        ".junie/**",
        ".opencode/**",
        ".pi/**",
        "coverage/**",
        // loaded by the husky pre-commit hook, not by an import
        "validate-branch-name.config.cjs",
    ],
    // pinned per-invocation via `bunx --package renovate@<version>`, never installed
    ignoreDependencies: ["renovate"],
    // external CLIs the autonomous and stonks plugins require on the consumer machine
    ignoreBinaries: ["openusage", "bd", "gh", "linear", "claude", "gws"],
    ignoreExportsUsedInFile: {
        interface: true,
        type: true,
    },
    workspaces: {
        ".": {
            entry: ["scripts/*.ts", "scripts/**/*.test.ts"],
            project: ["scripts/**/*.ts"],
        },
        // Plugin workspaces: their tests and any scripts/ entries.
        "plugins/*": {
            entry: ["scripts/**/*.ts", "**/*.test.ts"],
            project: ["**/*.ts"],
        },
        // The stonks hooks module is loaded by Claude Code from hooks.json
        // `modules`; `claude-code` is the engine's own module, present at run
        // time and vendored as types under mod/types/ (design D17).
        "plugins/stonks": {
            entry: [
                "scripts/**/*.ts",
                "**/*.test.ts",
                "mod/register.ts",
                "src/spike-stub.ts",
                // The PostToolUse command hook, run from hooks.json (design D5).
                "src/capture.ts",
            ],
            project: ["**/*.ts", "!mod/types/claude-code.d.ts"],
            ignoreDependencies: ["claude-code"],
        },
    },
} satisfies KnipConfig;
