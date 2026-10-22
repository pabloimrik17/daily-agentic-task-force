# Tasks

## 1. Preflight

- [x] 1.1 Verify the starting point:
    - The branch is on `origin/main`: `git log --oneline origin/main..HEAD` shows only this change's commits.
    - `bun run lint:oxfmt`, `bun run lint:eslint`, `bun run typecheck`, `bun run test`, `bun run lint:knip` and `bun run lint:marketplace` pass before any code change.
    - Leave the release-please `bun.lock` drift unstaged in every commit (`agentic-task-jisf`).
- [x] 1.2 Install mise ≥ 2026.10.0 on the machine with `brew install mise`, asking the user first if it is not installed. Verify with `mise --version`.

## 2. mise tooling and the tool helper

- [x] 2.1 Add `mise.toml` (design D6):
    - `min_version = "2026.10.0"`.
    - osv-scanner 2.6.0 and gitleaks 8.30.1.
    - zizmor and `aqua:rhysd/actionlint`, each at its newest release that is at least 14 days old.
    - `[settings] lockfile_platforms = ["linux-x64", "macos-arm64", "macos-x64"]`.

    Verify with `mise ls --current`, which shows exactly the four tools at those versions, and no `bun` or `node` entry.
- [x] 2.2 Generate `mise.lock` with `mise lock --platform linux-x64,macos-arm64,macos-x64`. Verify:
    - Every tool has a checksummed entry for all three platforms.
    - zizmor's backend is a release binary, not pipx or cargo; if it is, pin `aqua:` or `github:` explicitly and relock.
    - `mise install --locked` succeeds.
- [x] 2.3 Check mise trust in a fresh worktree (a scratch `git worktree add --detach`, removed afterwards). Run `mise install` and `mise which gitleaks` there.
    - If mise reports the config as untrusted, apply the design's mitigation: the README per-worktree trust and `trusted_config_paths` note.
    - Record the outcome in the design's Risks.
- [x] 2.4 Run every security binary as `mise x -- <bin>` in the hooks (design D1; a `scripts/hooks/mise-tool.sh` helper was built first and dropped in review). Verify each `security-tooling` "Hooks run the pinned binaries through mise" scenario by hand:
    - With another gitleaks first on `PATH`, `mise x -- gitleaks version` prints 8.30.1.
    - With `PATH` stripped of mise, a hook that needs gitleaks exits non-zero.
- [x] 2.5 Document the setup:
    - In `README.md` "Working on this repository", give the one-line install `brew install mise && mise install`, and say that mise manages only the security binaries while Bun stays on `.bun-version`.
    - Add the matching line to `AGENTS.md`'s Toolchain section.

    Verify with `bun run lint:markdown` and `bun run lint:oxfmt`.

## 3. Baseline cleanup

- [x] 3.1 Run `gitleaks git --redact --no-banner` over the full history.
    - On a finding that looks like a real secret, stop and ask the user before anything else (rotation first).
    - Record a false positive in `.gitleaksignore` with its fingerprint.

    Verify the scan exits 0.
- [x] 3.2 Run `osv-scanner scan source -L bun.lock` (design D7).
    - Fix each advisory by upgrading within the Renovate and Bun release-age rules.
    - Only when no fix exists, suppress it in `osv-scanner.toml` with `ignoreUntil` ≤ 90 days, a reason and `Owner: pfe`.

    Verify the scan exits 0, and that `bun install --frozen-lockfile`, `bun run typecheck` and `bun run test` still pass after any upgrade.
- [x] 3.3 Run `zizmor --offline .github/workflows` and `actionlint -shellcheck= -pyflakes=` on every workflow.
    - Fix each finding in the workflow.
    - Only an unfixable zizmor finding gets an ignore in `.github/zizmor.yml`, with a comment saying why.

    Verify both exit 0.

## 4. pre-commit

- [x] 4.1 Guard the branch check in `.husky/pre-commit` so it runs only when `git symbolic-ref -q HEAD` succeeds (design D3). Verify both cases:
    - In a scratch detached worktree, a commit with a harmless staged change succeeds, then the worktree is removed.
    - On a scratch branch named `wip-thing`, a commit is aborted by the branch check.
- [x] 4.2 Add `mise x -- gitleaks git --pre-commit --staged --redact -v --no-banner` after the lint-staged call (design D3). Verify the "Staged fake secret" and "Unstaged secret" scenarios with a generated fake token in a scratch file, never committed:
    - When the token is staged, the commit is aborted and the output shows the rule and file but no token.
    - When the token is only unstaged, the commit proceeds.
- [x] 4.3 Add `WORKFLOW_FILES` and the zizmor `--offline` and actionlint `-shellcheck= -pyflakes=` entries to the parallel step of `lint-staged.config.ts` (design D4). Verify:
    - Staging a scratch edit to a workflow that introduces an actionlint error (an unknown `runs-on` expression) aborts the commit.
    - A zizmor finding (an unpinned action) aborts it too.
    - A commit touching only `README.md` runs neither tool.
    - `fallow audit` stays within the complexity budget.
- [x] 4.4 Measure the pre-commit on a typical three-file change with `time git commit` on a scratch commit, reset afterwards. Verify it stays under 5 s; if it does not, report the breakdown instead of dropping a check.
- [x] 4.5 Update the documentation:
    - The `README.md` hooks paragraph and `AGENTS.md` "Commits": pre-commit checks, that the branch check is skipped on a detached HEAD, and that CI enforces the branch name on PRs.
    - The comment in `.husky/pre-commit`, if its wording changes.

    Verify with `bun run lint:markdown`.

## 5. pre-push

- [x] 5.1 Add `.husky/pre-push` and `scripts/hooks/pre-push.sh` (design D2): one gitleaks call over the pushed shas `--not --remotes=<remote>`, osv-scanner over the lockfiles extracted from the tip of each pushed ref, then `bun run lint:knip`, `bun run typecheck` and `bun run test`, stopping at the first failure.
    - Verify the range by hand: a new branch scans only its new commits, a second push of the same branch scans only the added commit, and two refs in one push are covered by a single gitleaks call.
    - Verify that a deletion-only push runs nothing.
- [x] 5.2 Verify the push scenarios against a scratch bare remote (`git init --bare` in the scratchpad, added as a temporary remote and removed afterwards):
    - A clean branch pushes.
    - A commit made with `--no-verify` that adds a generated fake token is refused, and the output shows no token.
    - Pushing again after an amend that removes the token succeeds.
    - A merge commit whose resolution adds a token is refused ("Secret added in a merge commit"), with no token in the output.
    - A pushed commit with a vulnerable lockfile is refused while the working tree has a safe uncommitted copy, and when another branch is checked out ("Vulnerable lockfile committed, safe copy uncommitted").
    - Total pre-push time stays under 60 s.
- [x] 5.3 Verify the osv-scanner gate fails on an advisory: point the script's osv-scanner call at a scratch copy of a lockfile that resolves a package version with a known advisory. Verify a non-zero exit with the advisory printed, and that the real `bun.lock` passes.
- [x] 5.4 Document pre-push in `README.md` and `AGENTS.md`:
    - The five checks.
    - That knip runs at pre-push and in CI, not at pre-commit.
    - The `osv-scanner.toml` suppression rule.

    Verify with `bun run lint:markdown`.

## 6. CI branch-name backstop

- [x] 6.1 Add the branch-name step to `ci.yml`'s `main` job right after "Install dependencies" (design D5): `if: github.event_name == 'pull_request'`, `HEAD_REF` from `github.head_ref` through `env`, and `bun run validate-branch-name -t "$HEAD_REF"`. Verify:
    - Locally, `bun run validate-branch-name -t wip-thing` fails.
    - `-t renovate/x` and `-t release-please--branches--main` pass.
    - zizmor and actionlint report nothing for `ci.yml`.

## 7. Integration

- [x] 7.1 On a clean clone of the branch in the scratchpad, run `brew install mise && mise install` (mise already present) and `bun install --frozen-lockfile`, then make one commit and one push to a scratch bare remote. Verify that both hooks run every check green; remove the clone afterwards.
- [x] 7.2 Run the full local gate:
    - `bun run lint:oxfmt`, `bun run lint:eslint`, `bun run lint:markdown`, `bun run lint:knip`, `bun run lint:fallow`, `bun run lint:marketplace`, `bun run typecheck` and `bun run test`.
    - `bunx @fission-ai/openspec@1.11.0 validate --changes --no-interactive`.

    Verify all pass.
- [ ] 7.3 With the user's authority to commit and push, commit with conventional messages (scope `chore` or `ci`, no plugin scope, so release-please releases nothing). Stage `bun.lock` only with the dependency fixes from 3.2, leaving out the release-please version drift (`agentic-task-jisf`). Push with the new pre-push hook active and open the PR.
    - Verify CI is green, including the branch-name step.
    - Verify the PR checklist maps to the task's acceptance criteria.

## Workflow follow-up

- After merge, check the first Renovate run: the Dependency Dashboard lists the four mise tools, and an upgrade PR touches both `mise.toml` and `mise.lock`. If the lock is left stale, open a follow-up and amend the `security-tooling` upgrade requirement (design Risks).
- Archive the change once the PR is merged and the review requirements are met, then close `agentic-task-6c2p.18`.
- Note in `agentic-task-6c2p.19` and `.20` what the template is (`mise.toml`, `scripts/hooks/*.sh`, the hook order) and which lines are repo-specific.
