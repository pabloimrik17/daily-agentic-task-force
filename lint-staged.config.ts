import type { Configuration } from "lint-staged";

export default {
    "*": "oxfmt --no-error-on-unmatched-pattern --ignore-path .oxfmtignore",
    "*.ts": "eslint --fix",
    "*.md": "markdownlint --fix",
    // Function form drops the file list: audit runs once per commit, as a
    // new-only ratchet against the merge-base. Full-repo gate lives in push CI.
    "*.{ts,js,cjs,mjs,json,jsonc,md}": () => "bun run fallow audit",
    "renovate.json": "bunx --package renovate@43.227.0 renovate-config-validator --strict",
} satisfies Configuration;
