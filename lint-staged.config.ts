import type { Configuration } from "lint-staged";

export default {
    "*": "oxfmt --no-error-on-unmatched-pattern --ignore-path .oxfmtignore",
    "*.ts": "eslint --fix",
    "*.md": "markdownlint --fix",
    // Function form ignores the file list: fallow audit runs once per commit,
    // not once per file. It is a new-only ratchet against the merge-base, so
    // only findings the commit introduces fail. The full-repo gate
    // (`fallow dead-code --fail-on-issues`) stays exclusive to push CI.
    "*.{ts,js,cjs,mjs,json,jsonc,md}": () => "bunx fallow audit",
    "renovate.json": "bunx --package renovate@43.227.0 renovate-config-validator --strict",
} satisfies Configuration;
