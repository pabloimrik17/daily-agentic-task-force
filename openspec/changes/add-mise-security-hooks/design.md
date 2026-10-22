# Design

## Context

See `proposal.md` (Why) for the motivation, and `specs/security-tooling` and `specs/change-gates` for the requirements.

**Hooks today:**

- husky 9 runs `.husky/pre-commit`: `bun run validate-branch-name`, then `lint-staged --hide-all --config lint-staged.config.ts`.
- husky 9 runs `.husky/commit-msg`: commitlint.
- There is no pre-push hook.
- `lint-staged.config.ts` runs steps in order. Its last step is a parallel group: `fallow audit`, plus the Renovate validator when `renovate.json` is staged. Two helpers build the commands: `forStaged` appends the matching staged files, and `whenStaged` runs a command once when any staged file matches.

**What `validate-branch-name` 1.3.2 does without a branch:** it reads the branch through `git-local-info`. On a detached HEAD the name is empty, and the CLI exits 1 with "Error: not a git repository". This was reproduced in a throwaway detached worktree.

**What mise 2026.10 does when a tool is missing:**

- `mise x` installs missing tools by default (`exec_auto_install`).
- With auto-install off, `mise x` only warns, then runs whatever same-named binary is on `PATH`.
- `mise which <bin>` exits non-zero when the configured version is not installed.
- `mise lock --platform …` writes the version, checksum and URL for each platform. The `lockfile_platforms` setting makes a plain `mise lock` keep the same platforms.

**Measured locally (2026-10-21):**

| Command             | Time | Result |
| ------------------- | ---- | ------ |
| `bun run typecheck` | 6 s  | green  |
| `bun run test`      | 8 s  | green  |
| `bun run lint:knip` | 1 s  | green  |

**Constraints:**

- mise is not installed on this machine yet.
- This change is the template that monolab (pnpm, Nx) and dotfiles (chezmoi, possibly without Bun) copy. Hook logic has to be portable.

## Goals / Non-Goals

**Goals:**

- Hook behaviour that a sibling repository can copy by swapping only the repo-specific commands: format and lint, typecheck, tests.
- Deterministic results. The same binary versions run everywhere, whatever else happens to be on `PATH`.
- Every hook-only check has a CI backstop, or a task that will add one (`.28`).

**Non-Goals:**

- Making the hooks un-bypassable. `--no-verify` stays available; CI is the authority.
- Computing "affected" projects for typecheck and tests. The full runs fit the pre-push budget.

## Decisions

### D1. Hooks call `mise x --` directly

Every security binary runs as `mise x -- <bin> <args>`, written straight into `.husky/pre-commit`, `lint-staged.config.ts` and `scripts/hooks/pre-push.sh`. mise is a hard requirement for committing and pushing: without it the hook fails with the shell's "command not found".

`mise x` resolves the version pinned in `mise.toml`, so a same-named binary elsewhere on `PATH` never runs. A tool that is declared but not installed yet is installed by `mise x` on first use (`exec_auto_install`); contributors normally have it already from the setup step.

Alternatives considered:

- **A helper script that refuses to auto-install and prints a one-line hint**: implemented first, then dropped in review (2026-10-22) as unneeded indirection. mise is mandatory, so the hint adds little, and an install on first use is acceptable.
- **`mise x` with auto-install off**: rejected. It falls back to an unmanaged binary on `PATH` with only a warning.

### D2. The pre-push hook is a POSIX `sh` script

`.husky/pre-push` calls `sh scripts/hooks/pre-push.sh "$@"`. The script reads git's stdin, one line per ref: `<local ref> <local sha> <remote ref> <remote sha>`.

The script collects the local sha of every ref that is not a deletion, then runs gitleaks once over all of them:

`mise x -- gitleaks git --redact -v --no-banner --log-opts="--remerge-diff <sha>… --not --remotes=<remote>"`

That range is every pushed commit that no remote-tracking ref of that remote already has, which covers new and updated branches alike. `git log -p` prints no diff for merge commits on its own. `--remerge-diff` (git 2.36 or newer) diffs each merge against git's automatic merge result, so a secret added while resolving a merge is scanned, and what the merged-in branch already brought is not reported again. `--diff-merges=first-parent` was tried first and dropped in review for that noise. gitleaks reports a finding in a conflict resolution with a `b/` prefix on the path (verified with gitleaks 8.30.1), which matters only for a `.gitleaksignore` fingerprint on such a finding. When every ref is a deletion, the script exits 0 before running anything.

After gitleaks, the script runs the remaining checks in order:

1. osv-scanner, once, with one `-L` per lockfile at the tip of each pushed ref. For each pushed sha (the ref tips; intermediate commits are not scanned, since what lands is the tip), lockfiles are found through `git ls-tree` matched against known names (`bun.lock`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, …) and written with `git show <sha>:<path>` into a temporary directory, together with any `osv-scanner.toml`, so the scan sees what is pushed rather than the working tree and suppressions are still discovered. When no pushed commit has a lockfile, osv-scanner is skipped.
2. `bun run lint:knip`.
3. `bun run typecheck`.
4. `bun run test`.

knip, the typecheck and the tests run on the working tree, the usual pre-push trade-off: checking out each pushed commit would need an install per push and break the time budget. CI runs them on the pushed commit.

The script stops at the first failure. Security checks run first because they are the cheapest and the most important.

Alternatives considered:

- **`--all` or full-history gitleaks on every push**: rejected. It is too slow and would duplicate the weekly cron in `.28`.
- **Affected-only typecheck and tests**: rejected for now. The measured 15 s fits the 30-60 s budget. Revisit if the total passes 60 s.

### D3. Pre-commit order: branch check, then lint-staged, then gitleaks

`.husky/pre-commit` runs three things in this order:

1. The branch check, guarded so it only runs on a branch: `git symbolic-ref -q HEAD >/dev/null && bun run validate-branch-name`, written as an `if` so the detached case continues.
2. The existing lint-staged call.
3. `mise x -- gitleaks git --pre-commit --staged --redact -v --no-banner`.

gitleaks runs after lint-staged, so it scans the final index after formatters re-stage. It stays outside lint-staged because it reads the index itself and needs no file list.

On the guard, the alternatives are equivalent. `git branch --show-current` being empty would also work, and so would patching the validator. `symbolic-ref` is plumbing with a stable exit code.

### D4. zizmor and actionlint run through lint-staged on staged workflow files

A new `WORKFLOW_FILES` pattern, `^\.github/workflows/.+\.ya?ml$`, joins the existing parallel step. Both tools are read-only and only see the staged workflow files:

- `forStaged(WORKFLOW_FILES, "mise x -- zizmor --offline", …)`
- `forStaged(WORKFLOW_FILES, "mise x -- actionlint -shellcheck= -pyflakes=", …)`

Why each flag:

- **`--offline`** keeps the hook fast and network-free even when `GH_TOKEN` is set. The online audits (known-vulnerable actions, impostor commits) belong in CI (`.28`).
- **Empty `-shellcheck=` and `-pyflakes=`** stop actionlint from picking up whatever shellcheck or pyflakes happens to be installed, which would make results differ between machines. Adding shellcheck to `mise.toml` would grow the agreed tool set. That is a possible follow-up, not this change.

The trigger is narrower than "anything under `.github/**`". CODEOWNERS and similar files are not workflows. The repository has no composite actions or `dependabot.yml`; a copy that has them widens the pattern.

### D5. The CI branch-name step reads `head_ref` through `env`

A step is added in `ci.yml`'s `main` job, right after `bun install`. It is guarded with `if: github.event_name == 'pull_request'`, sets `env: { HEAD_REF: ${{ github.head_ref }} }`, and runs `bun run validate-branch-name -t "$HEAD_REF"`.

Passing the name through `env` avoids a template-injection finding: the branch name is attacker-controlled on fork PRs. Placing the step early fails fast. Keeping it a step inside the job, not a new job, keeps Actions minutes flat, as the epic's minutes rule requires. `-t` makes the CLI ignore the detached checkout that `actions/checkout` produces.

### D6. `mise.toml` shape

- `min_version = "2026.10.0"`.
- `[tools]` lists the four exact versions.
- `[settings] lockfile_platforms = ["linux-x64", "macos-arm64", "macos-x64"]`, so a plain `mise lock`, as run by Renovate or a contributor, keeps all three platforms. macos-x64 is there because the pilot is developed on an Intel Mac, and `mise install --locked` needs a checksum for the platform it runs on (decided 2026-10-21 during apply).

Versions:

- **osv-scanner and gitleaks:** the versions fixed by the task.
- **zizmor and actionlint:** the newest release that is at least 14 days old when implemented, which matches Renovate's minimum release age.

Backends: actionlint is `aqua:rhysd/actionlint`. zizmor uses the registry default only if `mise.lock` shows a checksummed release-binary backend. A pipx or cargo backend would need Python or Rust, so in that case pin the release-binary backend explicitly (`aqua:` or `github:`).

### D7. Clean the baseline before enabling the gates

Before the hooks are switched on, each scanner runs once over the whole repository:

| Scan                                              | What to do with a finding                                                                                                                                                                                      |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitleaks git` over full history                  | A real secret means stop and ask the user (rotate first). A false positive gets a fingerprint in `.gitleaksignore`.                                                                                            |
| osv-scanner on `bun.lock`                         | Fix by upgrade first, within the release-age rules. Suppress in `osv-scanner.toml` only when no fix exists, with `ignoreUntil` ≤ 90 days, a reason and `Owner: pfe`.                                           |
| zizmor (offline) and actionlint on every workflow | Fix in the workflow. A zizmor finding that cannot be fixed gets an ignore in `.github/zizmor.yml` with a comment saying why.                                                                                    |

## Risks / Trade-offs

- **mise refuses an untrusted `mise.toml`**: every new worktree is a new path, and mise may refuse an untrusted config there. → Verify in a fresh worktree. If trust is required, the README documents `mise trust && mise install` per worktree and `trusted_config_paths`, or a worktrunk post-start runs it.
    - **Outcome (2026-10-22, mise 2026.10.17):** trust is required. In a fresh `git worktree add --detach`, `mise which gitleaks` fails with "Config files in … are not trusted", and mise refuses to run the tool. An explicit `mise install` trusts the config and then succeeds. Applied: README describes the per-worktree `mise trust && mise install` and `mise settings add trusted_config_paths <parent dir>`; DOT-118 adds a `mise install` to the global worktrunk post-start so new worktrees need no manual step.
- **Renovate may not regenerate `mise.lock`**: the Mend-hosted app may not run `mise lock`. → Check the first Renovate run after merge. If the lock is left stale, open a follow-up, either lock-file maintenance or a manual relock rule, and amend the `security-tooling` upgrade requirement in that follow-up.
- **osv-scanner needs the OSV API**: an outage blocks pushes. → `git push --no-verify` in an emergency. CI covers the gap once `.28` lands.
- **Push to a URL**: `--remotes=<url>` matches no ref, so gitleaks scans the whole history reachable from the pushed commit. That is slower but never weaker. Accepted.
- **Pre-commit budget**: `fallow audit` alone has been measured at 2.5-4.2 s on other repositories. → Measure the full pre-commit on a typical change. If it passes 5 s, report it rather than drop a check.
    - **Outcome (2026-10-22):** over budget. A three-file commit (one `.ts`, one `.md`, one `.json`) took 9.6-12.6 s over three runs. Most of it is type-aware `eslint --fix` on the staged `.ts` (5-10 s), which the hook already ran before this change; `fallow audit` takes about 1.1 s. This change adds gitleaks (about 0.8 s, of which about 0.6 s is mise start-up). No check was dropped. Speeding up ESLint on staged files is left for a follow-up.
- **Hooks are bypassable**: until `.28`, only the branch name has a CI backstop. Accepted for the pilot. The repository is public, and GitHub secret scanning with push protection is on.

## Migration Plan

1. Merge the change with CI green.
2. Contributors run `brew install mise && mise install` once. Until they do, the next commit or push fails.
3. Rollback is reverting the merge commit. Nothing else holds state.

## Open Questions

- Does the Mend-hosted Renovate app update `mise.lock` together with `mise.toml`? This is answered by the first Renovate run after merge; see Risks.
- The exact zizmor and actionlint versions are picked at implementation time by D6's rule.
