## Why

This repository exists but is empty apart from OpenSpec scaffolding: no manifest, no toolchain, no CI, no way to publish anything. It is meant to be the agentic counterpart to `monolab` — exclusively Claude Code plugins, with no application or library code — and it cannot host a single plugin until the distribution contract and the quality gates around it exist.

Doing this now, before any plugin content lands, means the first plugin arrives on top of working gates rather than retrofitting them onto content that already drifted.

## What Changes

**Distribution**

- Add a Claude Code marketplace manifest at `.claude-plugin/marketplace.json` named `daily-agentic-task-force`, with `plugins/` as the plugin root.
- Add the first plugin, `datf-lab` v0.1.0: a staging holder for skills under validation. What proves out is promoted to its own plugin; what does not is deleted. It is deliberately **not** named `experiments` — `monolab` already publishes a plugin by that name, and while installs are keyed `<plugin>@<marketplace>`, the command invocation namespace is the bare plugin name, so two enabled `experiments` plugins would collide at `/experiments:*`.
- Seed `datf-lab` with `commands/hello.md` and one example skill, so the marketplace has something real to validate and install.
- Add `scripts/validate-marketplace.ts`, run in CI, which fails when a plugin's `version` in `.claude-plugin/plugin.json` disagrees with its entry in the root `marketplace.json`, or when a listed plugin's manifest is missing or malformed.
- Automate versioning with release-please, scoped to plugins only (no root version), syncing each plugin's version across `plugin.json`, `package.json`, and the root `marketplace.json` in one release commit.

**Toolchain** (transversal, ported from `monolab` and `dotfiles`)

- Bun 1.3.14 as runtime and package manager, with a `.bun-version` file and bun workspaces over `plugins/*`.
- Formatting with oxfmt; linting with ESLint flat config including type-aware rules; dead-code analysis with both knip and fallow; Markdown linting with markdownlint.
- Git hooks via husky: branch-name validation and lint-staged on pre-commit, commitlint on commit-msg.
- Tests with vitest, a single root config covering repo scripts and every plugin workspace.
- CI on GitHub Actions: `ci.yml` (format, lint, markdown, dead code, tests, marketplace validation, OpenSpec validation), `fallow.yml` (PR audit, new-only ratchet), `release-please.yml`, `renovate-config-validator.yml`. Renovate for dependency updates.
- Repo-level `CLAUDE.md` and `AGENTS.md`.

**Explicitly out of scope**: Codecov (no code to cover yet, and a coverage gate on a Markdown-dominated repo blocks PRs for reasons unrelated to quality), a per-repo beads database, `.mcp.json`, and any migration of `monolab`'s existing plugins.

## Capabilities

### New Capabilities

- `plugin-marketplace`: how this repository publishes Claude Code plugins — the manifest contract consumers install from, the invariant that every published version agrees across all three manifests that record it, and the validation that enforces that invariant before a change can land.

### Modified Capabilities

None. This is the repository's first change; `openspec/specs/` is empty.

## Impact

- **New at repo root**: `.claude-plugin/marketplace.json`, `plugins/datf-lab/`, `scripts/`, `package.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.ts`, `oxfmt.config.ts`, `knip.config.ts`, `commitlint.config.ts`, `lint-staged.config.ts`, `validate-branch-name.config.cjs`, `.fallowrc.jsonc`, `.markdownlintrc`, `.markdownlintignore`, `.oxfmtignore`, `.bun-version`, `.gitignore`, `renovate.json`, `release-please-config.json`, `.release-please-manifest.json`, `.husky/`, `.github/workflows/`, `CLAUDE.md`, `AGENTS.md`, `README.md`.
- **Untouched**: the existing OpenSpec scaffolding (`openspec/`, `.agents/`, `.claude/`, `.junie/`, `.opencode/`, `.pi/`). Linters and analyzers must exclude these — they are agent tooling, not this repository's source.
- **Not affected**: `monolab`. Its `experiments` plugin keeps its name, version, and release tags; nothing moves out of it.
- **New dependencies** (all pinned exact): eslint, typescript-eslint, `@eslint/js`, eslint-plugin-regexp, globals, typescript, `@types/bun`, oxfmt, knip, fallow, markdownlint-cli, husky, lint-staged, `@commitlint/*`, validate-branch-name, vitest.
- **Workflow impact**: every commit is gated by branch-name and conventional-commit validation, so existing local branches that do not match the pattern will be rejected until renamed.
