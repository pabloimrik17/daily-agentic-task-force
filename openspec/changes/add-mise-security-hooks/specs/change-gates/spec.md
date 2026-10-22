# Spec Delta

## Purpose

Defines what the repository checks before a commit and before a push, and which CI checks back up the checks that otherwise run only in local git hooks, so problems are caught early and nothing depends on a hook alone.

## ADDED Requirements

### Requirement: Pre-commit checks staged changes

The pre-commit hook SHALL check only what is staged:

- Format every staged file.
- Run ESLint on staged TypeScript files.
- Run markdownlint on staged Markdown files.
- Run the Renovate validator when `renovate.json` is staged.
- Run `fallow audit` when a file fallow analyses is staged.
- Run gitleaks over the staged changes.
- Run zizmor and actionlint when a workflow file under `.github/workflows/` is staged.

Any failing check SHALL abort the commit.

#### Scenario: Staged fake secret

- **WHEN** a contributor stages a file containing a token that matches a gitleaks rule and commits
- **THEN** the commit is aborted, and the report names the file and rule without printing the secret value

#### Scenario: Staged workflow with a finding

- **WHEN** a contributor stages a workflow file that actionlint or zizmor reports a finding for and commits
- **THEN** the commit is aborted and the finding is printed

#### Scenario: No workflow staged

- **WHEN** the staged files include no file under `.github/workflows/`
- **THEN** neither zizmor nor actionlint runs

#### Scenario: Unstaged secret

- **WHEN** a secret is present only in an unstaged change and the staged changes are clean
- **THEN** the commit succeeds

### Requirement: Pre-commit stays fast and offline

The pre-commit hook SHALL complete in under 5 seconds for a typical change of a few files on a contributor's machine. It SHALL NOT need network access. Workflow scanning SHALL run in zizmor's offline mode even when a GitHub token is present in the environment.

#### Scenario: Token in the environment

- **WHEN** `GH_TOKEN` is set and a workflow file is staged
- **THEN** zizmor runs offline and makes no GitHub API request

### Requirement: Branch name is checked only on a branch

The pre-commit hook SHALL validate the current branch name against `validate-branch-name.config.cjs` when HEAD is on a branch. When HEAD is detached, it SHALL skip that check and continue with the remaining checks.

#### Scenario: Badly named branch

- **WHEN** a contributor commits on a branch named `wip-thing`
- **THEN** the commit is aborted by the branch-name check

#### Scenario: Detached HEAD

- **WHEN** a contributor commits while HEAD is detached, for example while amending a commit during an interactive rebase
- **THEN** the branch-name check is skipped, and the commit succeeds if every other check passes

### Requirement: Pre-push checks the pushed commits

Before a push leaves the machine, the pre-push hook SHALL run these checks in order:

1. gitleaks over the commits being pushed that are not on the remote yet, including the diffs of merge commits.
2. osv-scanner on every lockfile in the pushed commits, read from those commits rather than the working tree, together with the `osv-scanner.toml` they contain.
3. knip.
4. The repository typecheck.
5. The unit tests.

knip, the typecheck and the unit tests run on the working tree; CI runs them on the pushed commit. Any failing check SHALL abort the push. A push that only deletes remote refs SHALL run no check.

#### Scenario: Secret in a pushed commit

- **WHEN** a commit being pushed adds a token that matches a gitleaks rule, for example a commit made with `--no-verify`
- **THEN** the push is aborted, and the report names the commit and rule without printing the secret value

#### Scenario: New branch

- **WHEN** a branch that does not exist on the remote is pushed
- **THEN** gitleaks scans only the commits that are not reachable from any ref of that remote

#### Scenario: Commits already on the remote

- **WHEN** a branch is pushed whose earlier commits are already on the remote
- **THEN** gitleaks scans only the new commits

#### Scenario: Secret added in a merge commit

- **WHEN** a merge commit being pushed adds a token that matches a gitleaks rule in its own changes, not in either parent
- **THEN** the push is aborted, and the report names the commit and rule without printing the secret value

#### Scenario: Vulnerable dependency

- **WHEN** a lockfile in a pushed commit resolves a package version with a known advisory, dev dependency or not, that is not suppressed
- **THEN** the push is aborted and the advisory is printed

#### Scenario: Vulnerable lockfile committed, safe copy uncommitted

- **WHEN** a pushed commit has a vulnerable lockfile, and the working tree has an uncommitted safe version of it or another branch is checked out
- **THEN** osv-scanner scans the committed lockfile and the push is aborted

#### Scenario: Ref deletion

- **WHEN** the push only deletes a remote branch
- **THEN** the hook runs no check and the push proceeds

### Requirement: knip runs at pre-push, not pre-commit

knip SHALL run in the pre-push hook and in CI. It SHALL NOT run in the pre-commit hook.

#### Scenario: Commit with an unused export

- **WHEN** a contributor commits a change that adds an unused export
- **THEN** the commit is not blocked by knip, and the next push is

### Requirement: Advisory suppressions expire

An osv-scanner advisory SHALL be suppressed only in `osv-scanner.toml`. Each suppression SHALL give an `ignoreUntil` date no more than 90 days after it was added, a reason, and `Owner: pfe`. When the date passes, the advisory SHALL fail the push again.

#### Scenario: Expired suppression

- **WHEN** an advisory's `ignoreUntil` date is in the past
- **THEN** osv-scanner reports it and the push is aborted

### Requirement: CI backs up the branch-name check

On every pull request, CI SHALL validate the pull request's head branch name against `validate-branch-name.config.cjs`, as a step inside an existing job. A name that does not match SHALL fail the job. The branch name SHALL reach the check as data, never interpolated into the script.

#### Scenario: Badly named PR branch

- **WHEN** a pull request is opened from a branch named `wip-thing`
- **THEN** the CI job fails at the branch-name step

#### Scenario: Release and Renovate branches

- **WHEN** a pull request comes from `release-please--branches--main` or `renovate/<name>`
- **THEN** the branch-name step passes

#### Scenario: Push to main

- **WHEN** CI runs for a push to `main`
- **THEN** the branch-name step does not run
