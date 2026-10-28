import { defineConfig } from "lint-staged/config";
import { existsSync } from "node:fs";
import path from "node:path";

const ESLINT_FILES = /\.(?:ts|ya?ml)$/;
const YAML_FILES = /\.ya?ml$/;
const MARKDOWN_FILES = /\.md$/;
const FALLOW_FILES = /\.(?:ts|js|cjs|mjs|json|jsonc|md)$/;
const RENOVATE_FILES = /(?:^|\/)renovate\.json$/;
const WORKFLOW_FILES = /^\.github\/workflows\/.+\.ya?ml$/;

function toRelativePath(filename: string): string {
    return path.relative(process.cwd(), filename).replaceAll("\\", "/");
}

/** lint-staged splits commands with string-argv, which has no escapes: quote with the character the path lacks. */
function quoted(filename: string): string {
    if (!existsSync(filename)) {
        throw new Error(
            String.raw`lint-staged passed a path that does not exist (it rewrites "\" in names): ${filename}`,
        );
    }
    const quote = filename.includes("'") ? '"' : "'";
    if (filename.includes(quote)) {
        throw new Error(`Cannot pass a path containing both ' and " to lint-staged: ${filename}`);
    }
    return `${quote}${filename}${quote}`;
}

/** `command` with the matching staged files appended as absolute paths (never read as options), or no task when none match. */
function forStaged(pattern: RegExp, command: string, filenames: readonly string[]): string[] {
    const matched = filenames.filter((filename) => pattern.test(toRelativePath(filename)));
    if (matched.length === 0) return [];
    return [`${command} ${matched.map(quoted).join(" ")}`];
}

/** `command` once, without file arguments, when any staged file matches. */
function whenStaged(pattern: RegExp, command: string, filenames: readonly string[]): string[] {
    return filenames.some((filename) => pattern.test(toRelativePath(filename))) ? [command] : [];
}

export default defineConfig({
    // Steps run in order, so writers never overlap; an array a step returns runs in parallel.
    "**/*": [
        "oxfmt --no-error-on-unmatched-pattern",
        (filenames: readonly string[]): string[] =>
            forStaged(ESLINT_FILES, "eslint --fix --no-warn-ignored", filenames),
        // eslint-plugin-yml's block-style fixes indent by 8, which oxfmt rejects.
        (filenames: readonly string[]): string[] =>
            forStaged(YAML_FILES, "oxfmt --no-error-on-unmatched-pattern", filenames),
        (filenames: readonly string[]): string[] =>
            forStaged(MARKDOWN_FILES, "markdownlint --fix", filenames),
        (filenames: readonly string[]): string[] => [
            // New-only ratchet vs the merge-base; the full-repo gate lives in push CI.
            ...whenStaged(FALLOW_FILES, "bun run fallow audit", filenames),
            ...forStaged(
                RENOVATE_FILES,
                "bunx --package renovate@44.101.2 renovate-config-validator --strict",
                filenames,
            ),
            ...forStaged(WORKFLOW_FILES, "mise x -- zizmor --offline", filenames),
            ...forStaged(WORKFLOW_FILES, "mise x -- actionlint -shellcheck= -pyflakes=", filenames),
        ],
    ],
});
