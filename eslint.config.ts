import eslint from "@eslint/js";
import regexpPlugin from "eslint-plugin-regexp";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
    {
        ignores: [
            "node_modules/**",
            "coverage/**",
            // Agent scaffolding, not source. Mirrored in 4 sibling configs; see CLAUDE.md.
            "openspec/**",
            ".agents/**",
            ".claude/**",
            ".junie/**",
            ".opencode/**",
            ".pi/**",
            "**/CHANGELOG.md",
            // Vendored Claude Code mod API declarations, third-party code pinned to
            // the tested Claude Code version (stonks design D17).
            "plugins/stonks/mod/types/claude-code.d.ts",
            // Written by Claude Code beside a plugin manifest on every load; git-ignored.
            "plugins/*/.claude-plugin/types/**",
        ],
    },
    eslint.configs.recommended,
    tseslint.configs.recommended,
    regexpPlugin.configs.recommended,
    {
        files: ["**/*.{cjs,mjs}"],
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
    },
    // Type-aware linting reaches the root config files too: tsconfig's
    // `include: ["**/*.ts"]` has no exclusions.
    {
        files: ["**/*.ts"],
        extends: [tseslint.configs.recommendedTypeChecked],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
    // .mjs and .cjs are outside the TypeScript project; type-checked rules
    // would trip the parser rather than lint them.
    {
        files: ["**/*.{js,cjs,mjs}"],
        extends: [tseslint.configs.disableTypeChecked],
    },
    {
        rules: {
            "@typescript-eslint/no-unused-vars": [
                "error",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                    caughtErrorsIgnorePattern: "^_",
                },
            ],
            "no-constant-binary-expression": ["error", { checkRelationalComparisons: true }],
            "preserve-caught-error": "warn",
        },
    },
);
