import eslint from "@eslint/js";
import regexpPlugin from "eslint-plugin-regexp";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
    {
        ignores: [
            "node_modules/**",
            "coverage/**",
            // Agent scaffolding — tooling for AI hosts, not this repository's
            // source. Keep this list identical to .oxfmtignore, knip.config.ts,
            // .fallowrc.jsonc and .markdownlintignore; divergence shows up as
            // one tool failing on files the others skip.
            "openspec/**",
            ".agents/**",
            ".claude/**",
            ".junie/**",
            ".opencode/**",
            ".pi/**",
            "**/CHANGELOG.md",
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
    // Type-aware linting. Every .ts file in the repository is inside the root
    // tsconfig's `include: ["**/*.ts"]`, root config files included — excluding
    // them the way monolab does would leave type-aware linting covering nearly
    // nothing here, since root configs are most of the TypeScript that exists.
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
    // .mjs and .cjs cannot participate in the TypeScript project, so the
    // type-checked rules would trip the parser rather than lint them.
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
