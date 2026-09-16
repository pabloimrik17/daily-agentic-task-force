## 1. Runtime and workspace foundation

- [x] 1.1 Add `.bun-version` pinned to `1.3.14` and verify `bun --version` in the repo reports the same
- [x] 1.2 Add the root `package.json` — private, `type: "module"`, `packageManager: "bun@1.3.14"`, `workspaces: ["plugins/*"]`, and the `lint:*` / `test` / `prepare` scripts — and verify `bun install` completes and writes `bun.lock`
- [x] 1.3 Add all devDependencies pinned exact (eslint 10.7.0, @eslint/js 10.0.1, typescript-eslint 8.64.0, eslint-plugin-regexp 3.1.1, globals 17.7.0, typescript 6.0.3, @types/bun 1.3.14, oxfmt 0.59.0, knip 6.27.0, fallow 3.6.0, markdownlint-cli 0.49.1, husky 9.1.7, lint-staged 17.1.0, @commitlint/cli 21.2.2, @commitlint/config-conventional 21.2.2, @commitlint/types 21.2.0, validate-branch-name 1.3.2, vitest 4.1.10) and verify no caret or tilde ranges remain in `package.json`
- [x] 1.4 Add `.gitignore` covering `node_modules/`, `.idea/`, `.worktrees/`, `.fallow/`, `.claude/settings.local.json`, and `coverage/`, and verify `git status` is clean after `bun install`
- [x] 1.5 Add the root `tsconfig.json` (`moduleResolution: "bundler"`, `types: ["bun"]`, `noEmit: true`, `strict: true`, `include: ["**/*.ts"]`, no `composite`) and verify `bunx tsc --noEmit` exits zero

## 2. Marketplace and the datf-lab plugin

- [x] 2.1 Create `.claude-plugin/marketplace.json` with `name: "daily-agentic-task-force"`, owner, `pluginRoot: "./plugins"`, no `metadata.version`, and a `plugins[]` entry for `datf-lab` at version `0.1.0`; verify it parses as JSON
- [x] 2.2 Create `plugins/datf-lab/.claude-plugin/plugin.json` at version `0.1.0` with name, description marking it as a staging area, author, license, repository, and homepage; verify the name matches its marketplace entry
- [x] 2.3 Create `plugins/datf-lab/package.json` — private, name-scoped, version `0.1.0` — and verify `bun install` resolves it as a workspace member
- [x] 2.4 Seed `plugins/datf-lab/commands/hello.md` and one example skill under `plugins/datf-lab/skills/`, and verify both carry valid frontmatter
- [x] 2.5 Add `plugins/datf-lab/README.md` and `CHANGELOG.md` documenting the promote-or-delete lifecycle
- [x] 2.6 Verify the marketplace end to end: add this repository as a plugin marketplace in Claude Code, confirm `datf-lab` is offered, install it, and confirm `/datf-lab:hello` resolves without colliding with `experiments:*`

## 3. Marketplace validation script

- [x] 3.1 Implement `scripts/validate-marketplace.ts` checking every failure listed in the `plugin-marketplace` spec — unparseable or missing marketplace manifest, unresolvable plugin source, unparseable plugin manifest, missing name or version, name mismatch, three-way version disagreement, and a plugin directory present but unlisted — accumulating all problems and exiting non-zero if any
- [x] 3.2 Write `scripts/validate-marketplace.test.ts` with a case per spec scenario, including the multi-problem case asserting all are reported in one run; verify `bunx vitest run` passes
- [x] 3.3 Verify the script rejects real drift: temporarily bump `plugin.json` out of sync, confirm a non-zero exit naming the plugin and both values, then restore

## 4. Formatting, linting and dead-code analysis

- [x] 4.1 Add `oxfmt.config.ts` (tabWidth 4, useTabs false, singleAttributePerLine true) and `.oxfmtignore`, then run `bun run lint:oxfmt:fix` and verify `bun run lint:oxfmt` exits zero
- [x] 4.2 Add `eslint.config.ts` — flat config with `@eslint/js` recommended, `typescript-eslint` recommended, `eslint-plugin-regexp`, `globals.node` for `.mjs`/`.cjs`, type-aware via `projectService: true` and `tsconfigRootDir`, a `disableTypeChecked` block for `.mjs`/`.cjs`, and ignores for `openspec/`, `.agents/`, `.claude/`, `.junie/`, `.opencode/`, `.pi/`, `node_modules/`, `**/CHANGELOG.md` — and verify `bunx eslint .` exits zero
- [x] 4.3 Verify type-aware linting is actually active: introduce a floating promise in a scratch `.ts` file, confirm `@typescript-eslint/no-floating-promises` reports it, then remove the file
- [x] 4.4 Add `knip.config.ts` with `--max-issues 40`, workspace awareness for `plugins/*`, and the same ignore list; verify `bun run lint:knip` exits zero
- [x] 4.5 Add `.fallowrc.jsonc` written from scratch (not copied — `monolab` ignores its plugin directory entirely) declaring the tool-loaded configs as entries and the same ignore list; verify `bunx fallow audit` and `bunx fallow dead-code --fail-on-issues` both exit zero
- [x] 4.6 Add `.markdownlintrc` (monolab's rules) and `.markdownlintignore` covering the agent scaffolding, `**/CHANGELOG.md`, `CLAUDE.md`, `AGENTS.md`; verify `bunx markdownlint .` exits zero
- [x] 4.7 Verify the five ignore lists (eslint, knip, fallow, markdownlint, oxfmt) cover the same agent-scaffolding paths, since divergence surfaces as one tool failing on files the others skip

## 5. Tests

- [x] 5.1 Add the root `vitest.config.ts` using `projects` — an inline project for `scripts/**/*.test.ts` plus the `plugins/*` glob — and verify `bunx vitest run` discovers and passes the validation-script tests
- [x] 5.2 Verify discovery is not silently empty: confirm the run reports a non-zero test count, and that `--passWithNoTests` is not set anywhere

## 6. Git hooks and commit conventions

- [x] 6.1 Add `commitlint.config.ts` extending `@commitlint/config-conventional` and verify a non-conventional message is rejected by `bunx commitlint`
- [x] 6.2 Add `validate-branch-name.config.cjs` with pattern `^(main|develop)$|^(feature|fix|hotfix|chore|renovate)/.+$|^release-please--branches--.+$` and verify the current `feature/init-repo` branch passes
- [x] 6.3 Add `lint-staged.config.ts` running oxfmt on all files, eslint on `.ts`, markdownlint on `.md`, and a once-per-commit `fallow audit`, plus the pinned `bunx` renovate-config validator on `renovate.json`
- [x] 6.4 Add `.husky/pre-commit` (validate-branch-name then lint-staged) and `.husky/commit-msg` (commitlint), run `bun run prepare`, and verify both hooks are executable and fire on a test commit

## 7. Release automation

- [x] 7.1 Add `release-please-config.json` for `plugins/datf-lab` with `release-type: "simple"`, `tag-separator: "--"`, `include-v-in-tag: true`, `bootstrap-sha` set to the OpenSpec scaffolding commit `17fb8fd`, and `extra-files` syncing `.claude-plugin/plugin.json`, `package.json`, and the `datf-lab` entry in the root marketplace manifest
- [x] 7.2 Add `.release-please-manifest.json` with `plugins/datf-lab` at `0.1.0`, and confirm no root package is configured so the repository itself stays unversioned
- [x] 7.3 Verify the config parses and targets the right paths by running release-please in dry-run mode, confirming it proposes updates to all three manifests and no root changelog

## 8. CI/CD

- [x] 8.1 Add `.github/workflows/ci.yml` — triggered on pull request and push to `main`, using `oven-sh/setup-bun` with `bun-version-file: .bun-version`, running install, oxfmt check, eslint, markdownlint, knip, vitest, `validate-marketplace`, and OpenSpec validation; plus `fallow dead-code --fail-on-issues` gated to `push` only
- [x] 8.2 Add `.github/workflows/fallow.yml` running the official fallow action on pull requests with `gate: new-only` and compact PR comments
- [x] 8.3 Add `.github/workflows/release-please.yml` triggered on push to `main`
- [x] 8.4 Add `.github/workflows/renovate-config-validator.yml` triggered when `renovate.json` changes
- [x] 8.5 Verify every third-party action across all four workflows is pinned to a full commit SHA with a version comment, and that no Codecov step exists anywhere
- [x] 8.6 Add `renovate.json` modelled on `dotfiles` — pinned ranges, 14-day `minimumReleaseAge` re-asserted for npm, `Europe/Madrid`, and custom managers for `bunx` pins in workflows and `lint-staged.config.ts` — and verify it passes `renovate-config-validator --strict`

## 9. Documentation and close-out

- [x] 9.1 Add `README.md` explaining the repository's purpose, how to add the marketplace, and the plugin lifecycle
- [x] 9.2 Add repo-level `CLAUDE.md` and `AGENTS.md` covering plugin conventions, the toolchain, and the version-sync invariant; confirm no beads database and no `.mcp.json` are created
- [x] 9.3 Run the full gate set locally in one pass (oxfmt, eslint, markdownlint, knip, fallow, vitest, validate-marketplace, `openspec validate --changes`) and verify every command exits zero
- [x] 9.4 Verify `git status` shows only intended files and report the changed-file list, validation results, and proposed commit for approval — do not commit or push without it
