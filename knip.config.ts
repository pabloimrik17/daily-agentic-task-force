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
    // external CLI the autonomous plugin requires on the consumer machine
    ignoreBinaries: ["openusage"],
    ignoreExportsUsedInFile: {
        interface: true,
        type: true,
    },
    workspaces: {
        ".": {
            entry: ["scripts/*.ts", "scripts/**/*.test.ts"],
            project: ["scripts/**/*.ts"],
        },
        // Declared ahead of need: plugins carry only Markdown today.
        "plugins/*": {
            entry: ["scripts/**/*.ts", "**/*.test.ts"],
            project: ["**/*.ts"],
        },
    },
} satisfies KnipConfig;
