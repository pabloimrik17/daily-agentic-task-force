# Spec Delta

## Purpose

Declares, pins, installs and upgrades the security binaries that the repository's git hooks run (secret, dependency and workflow scanners), so every contributor and CI run uses the same checksum-verified versions.

## ADDED Requirements

### Requirement: Declared security binaries

The repository SHALL declare its security binaries in a root `mise.toml` with exact versions: osv-scanner 2.6.0, gitleaks 8.30.1, zizmor and actionlint. actionlint SHALL come from the `aqua:rhysd/actionlint` backend. `mise.toml` SHALL declare no language runtime; Bun stays pinned by `.bun-version`.

#### Scenario: Tool set

- **WHEN** a contributor lists the tools `mise.toml` declares
- **THEN** exactly osv-scanner, gitleaks, zizmor and actionlint are listed, each at an exact version

#### Scenario: actionlint backend

- **WHEN** mise resolves actionlint for this repository
- **THEN** it uses the `aqua:rhysd/actionlint` backend, not the registry short name

#### Scenario: Runtimes stay outside mise

- **WHEN** `mise.toml` is read
- **THEN** it declares no `bun` or `node` tool

### Requirement: Locked and verified installs

The repository SHALL commit a `mise.lock` that records, for each declared tool, the resolved version and a checksum for the linux-x64, macos-arm64 and macos-x64 platforms. `mise.toml` SHALL require mise 2026.10.0 or newer.

#### Scenario: Lockfile platforms

- **WHEN** `mise.lock` is read
- **THEN** every declared tool has a checksummed entry for linux-x64, for macos-arm64 and for macos-x64

#### Scenario: Locked install

- **WHEN** `mise install --locked` runs on a clean clone
- **THEN** it installs every declared tool at the locked version and verifies its checksum

#### Scenario: Old mise

- **WHEN** a contributor with a mise older than 2026.10.0 runs `mise install` in the repository
- **THEN** mise refuses to load the configuration and names the required version

### Requirement: One-line contributor setup

The repository's contributor documentation SHALL give a single command that installs mise and every declared tool: `brew install mise && mise install`.

#### Scenario: Fresh machine

- **WHEN** a contributor on macOS without mise runs the documented command in a clean clone
- **THEN** every declared security binary is installed and the git hooks can run

### Requirement: Missing tool fails with a hint

When a git hook needs a declared security binary and mise or that binary is not installed, the hook SHALL fail. It SHALL print one line naming the missing tool and telling the contributor to run `mise install` (or to install mise first). The hook SHALL NOT install the tool itself and SHALL NOT run a same-named binary found elsewhere on `PATH`.

#### Scenario: Tool not installed

- **WHEN** a hook needs gitleaks and mise is installed but gitleaks is not
- **THEN** the hook exits non-zero and prints a single line containing `gitleaks` and `mise install`

#### Scenario: mise not installed

- **WHEN** a hook needs a security binary and `mise` is not on `PATH`
- **THEN** the hook exits non-zero and prints a single line telling the contributor to install mise and run `mise install`

#### Scenario: Unmanaged copy on PATH

- **WHEN** the declared gitleaks is not installed through mise but another gitleaks is on `PATH`
- **THEN** the hook still fails with the hint and does not run the other copy

### Requirement: Automated upgrades

Renovate SHALL detect the tools in `mise.toml` without manager configuration in the repository. A Renovate upgrade of a tool SHALL change `mise.toml` and `mise.lock` in the same pull request.

#### Scenario: New tool release

- **WHEN** a new gitleaks release passes Renovate's minimum release age
- **THEN** Renovate opens a pull request that updates the gitleaks version in `mise.toml` and its entries in `mise.lock`
