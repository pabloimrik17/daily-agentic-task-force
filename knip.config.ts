import type { KnipConfig } from "knip";

export default {
    // Agent scaffolding — tooling for AI hosts, not this repository's source.
    // Keep this list identical to .oxfmtignore, eslint.config.ts,
    // .fallowrc.jsonc and .markdownlintignore; divergence shows up as one tool
    // failing on files the others skip.
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
    ignoreExportsUsedInFile: {
        interface: true,
        type: true,
    },
    workspaces: {
        ".": {
            entry: ["scripts/*.ts", "scripts/**/*.test.ts"],
            project: ["scripts/**/*.ts"],
        },
        // Plugins carry Markdown today; the workspace is declared so their code
        // is analysed the moment they gain any.
        "plugins/*": {
            entry: ["scripts/**/*.ts", "**/*.test.ts"],
            project: ["**/*.ts"],
        },
    },
} satisfies KnipConfig;
