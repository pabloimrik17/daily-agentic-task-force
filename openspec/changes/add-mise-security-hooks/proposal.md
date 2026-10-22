# Proposal

## Why

This repository is public, and nothing local stops a secret from being committed, a vulnerable dependency from being pushed, or a risky workflow change from landing. The only checks are format, lint, fallow and the branch name. Beads `agentic-task-6c2p.18` is the pilot for the personal, public archetype of the fleet security layer (epic `agentic-task-6c2p`, grill 2026-10-07..14). monolab (`.19`) and dotfiles (`.20`) copy what this change defines, and the CI side (`.28`) and the hook-runner spike (`.51`) wait for it.

The current pre-commit also refuses every commit made without a branch (detached HEAD). `validate-branch-name` reads an empty branch name and exits 1 with "not a git repository". This happens, for example, when amending a commit during an interactive rebase.

## What Changes

- **Security binaries through mise**: a root `mise.toml` that pins osv-scanner 2.6.0, gitleaks 8.30.1, zizmor and `aqua:rhysd/actionlint`, plus a committed `mise.lock` with checksums for linux-x64, macos-arm64 and macos-x64 (the Intel Mac this pilot is developed on). The file requires mise ≥ 2026.10.0. Bun stays on `.bun-version`; mise manages security binaries only.
- **One install line** for contributors: `brew install mise && mise install`.
- **Hooks call mise directly**: every security binary runs as `mise x -- <tool>`, so the pinned version runs, never another copy on `PATH`. mise is required to commit and push.
- **pre-commit gains**:
    - gitleaks over the staged changes, with redacted output.
    - zizmor (offline) and actionlint when a workflow file is staged.
- **pre-commit keeps** oxfmt, staged ESLint, markdownlint, the Renovate validator when `renovate.json` is staged, and `fallow audit`.
- **pre-commit no longer blocks commits on a detached HEAD**: the branch-name check runs only when HEAD is on a branch.
- **New pre-push hook**, the last local stop, which runs in this order:
    1. gitleaks over the commits being pushed.
    2. osv-scanner on every tracked lockfile; any advisory fails, dev dependencies included.
    3. knip.
    4. typecheck.
    5. unit tests.
- **The branch-name check gets a CI backstop**: a step inside the existing CI job validates the PR's head branch against `validate-branch-name.config.cjs`. This moves forward from `.28`, which keeps the commitlint range backstop.
- **Baseline cleanup**: existing findings from osv-scanner, zizmor and actionlint in this repository are fixed, or suppressed with an expiry (osv-scanner: `ignoreUntil` ≤ 90 days, a reason and `Owner: pfe`). The new hooks start green.
- **Docs**: `README.md` and `AGENTS.md` describe mise, both hooks and where the branch name is enforced.

**Out of scope:**

- Security steps in CI (`jdx/mise-action`, osv-scanner, gitleaks over the PR range, zizmor SARIF), the weekly scan and the commitlint range backstop. These belong to `.28`.
- Replacing husky or lint-staged (`.51`).
- hadolint: this repository has no Dockerfile.
- Moving Bun or Node under mise.

## Capabilities

### New Capabilities

- `security-tooling`: how the repository declares, pins, installs and upgrades its local security binaries, and how a missing binary is reported.
- `change-gates`: what each local git hook checks before a commit or a push, and the CI checks that back up hook-only checks such as the branch name. `.28` will extend this capability with the CI security steps and the commitlint backstop.

### Modified Capabilities

None. `plugin-marketplace` keeps its validation requirements unchanged; this change only adds gates around them.

## Impact

- **New files**: `mise.toml`, `mise.lock`, `.husky/pre-push`, helper scripts under `scripts/hooks/`, and `osv-scanner.toml` or zizmor configuration only if the baseline needs suppressions.
- **Changed files**:
    - `.husky/pre-commit`: detached-HEAD guard and gitleaks.
    - `lint-staged.config.ts`: zizmor and actionlint on staged workflows.
    - `.github/workflows/ci.yml`: branch-name step.
    - `README.md` and `AGENTS.md`.
    - Workflow files, but only if zizmor or actionlint findings need fixing.
- **Contributors** need mise ≥ 2026.10.0. Without mise, a commit or push fails.
- **Network**: pre-push needs network for osv-scanner's advisory database. Pushing needs network anyway.
- **Renovate**: its mise manager picks up `mise.toml` without configuration changes. Whether it keeps `mise.lock` in sync is checked on the first Renovate run after merge.
- **No plugin changes**: no plugin is released by this change.
