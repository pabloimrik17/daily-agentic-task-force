## Purpose

Defines how this repository publishes Claude Code plugins to consumers: the manifest they install from, the guarantee that a plugin's advertised version is the version they actually receive, and the validation that prevents a broken or inconsistent marketplace from ever reaching the default branch.

## ADDED Requirements

### Requirement: Marketplace manifest

The repository SHALL expose a marketplace manifest at `.claude-plugin/marketplace.json` that Claude Code can add as a plugin source. The manifest SHALL declare a stable marketplace identifier, an owner, and the directory that holds plugins. Every plugin the repository publishes SHALL appear in the manifest with a name, a source path, a version, and a description.

The manifest SHALL NOT declare a version for the marketplace itself, because no process updates it and a stale value misinforms consumers.

#### Scenario: Consumer adds the marketplace

- **WHEN** a consumer adds this repository as a plugin marketplace in Claude Code
- **THEN** the marketplace resolves under its declared identifier and every plugin listed in the manifest is offered for installation

#### Scenario: Manifest omits a marketplace version

- **WHEN** the marketplace manifest is inspected
- **THEN** it carries no marketplace-level version field

### Requirement: Plugin version agreement

A plugin's version is recorded in more than one place: its own plugin manifest, its package manifest, and its entry in the marketplace manifest. These SHALL always agree. A disagreement means consumers are offered a version that differs from the one they receive, so it SHALL be treated as a defect that blocks the change.

#### Scenario: Versions agree

- **WHEN** every published plugin's version is identical in its plugin manifest, its package manifest, and its marketplace entry
- **THEN** validation succeeds

#### Scenario: A version drifts out of sync

- **WHEN** a plugin's version in any one of those manifests differs from the others
- **THEN** validation fails, names the plugin, and reports the conflicting values

### Requirement: Marketplace validation gate

The repository SHALL provide a validation check, run automatically on every proposed and integrated change, that verifies the marketplace is internally consistent before it can be published. The check SHALL fail when the marketplace manifest is absent or not parseable, when a listed plugin's source path does not resolve to a directory containing a plugin manifest, when a plugin manifest is not parseable or omits its name or version, when a plugin manifest's name disagrees with the name under which it is listed, or when a plugin directory exists under the plugin root but is not listed in the marketplace.

The check SHALL exit non-zero on any failure and report every problem it finds rather than stopping at the first.

#### Scenario: A listed plugin has no manifest

- **WHEN** the marketplace lists a plugin whose source path contains no plugin manifest
- **THEN** validation fails and identifies the unresolvable plugin

#### Scenario: A plugin exists but is unlisted

- **WHEN** a directory under the plugin root contains a plugin manifest but has no entry in the marketplace manifest
- **THEN** validation fails and identifies the unpublished plugin

#### Scenario: Multiple problems are present

- **WHEN** the marketplace has more than one inconsistency
- **THEN** validation reports all of them in a single run and exits non-zero

#### Scenario: Validation runs on every change

- **WHEN** a change is proposed or integrated into the default branch
- **THEN** marketplace validation runs and a failure blocks the change

### Requirement: Plugin name uniqueness across marketplaces

Claude Code namespaces a plugin's commands and skills by the plugin's bare name, not by the marketplace it came from. Plugins published here SHALL therefore be named so they do not collide with plugins the same user is likely to have enabled from a sibling marketplace.

#### Scenario: Staging plugin avoids a known collision

- **WHEN** the staging plugin published by this repository is named
- **THEN** its name differs from `experiments`, which a sibling marketplace already publishes, so both can be enabled at once without their command namespaces overlapping

### Requirement: Automated version publication

Releasing a plugin SHALL be driven from the commit history rather than performed by hand. When a release is published, every manifest that records that plugin's version SHALL be updated together in the same release, and the release SHALL be tagged per plugin so that plugins version independently of each other and of the repository.

The repository itself SHALL NOT carry a version or a changelog; only plugins are versioned.

#### Scenario: A plugin is released

- **WHEN** changes that warrant a release have landed for a plugin
- **THEN** a release is prepared that bumps that plugin's version in its plugin manifest, its package manifest, and its marketplace entry, and records the change in that plugin's changelog

#### Scenario: One plugin's release leaves others untouched

- **WHEN** a release is published for one plugin
- **THEN** no other plugin's version, changelog, or tag is modified

#### Scenario: Repository carries no version

- **WHEN** the repository root is inspected for a version or changelog
- **THEN** neither exists, because versioning is per plugin

### Requirement: Staging plugin lifecycle

The repository SHALL publish a staging plugin that holds skills and commands still being validated. Its contents are explicitly provisional: material that proves useful is promoted out of it into its own plugin or an existing one, and material that does not is removed. Consumers SHALL be able to tell from the plugin's description that its contents are unstable.

#### Scenario: Staging plugin is discoverable and marked provisional

- **WHEN** a consumer browses the marketplace
- **THEN** the staging plugin appears with a description identifying it as a holding area for unvalidated work

#### Scenario: Material is promoted out of staging

- **WHEN** a skill or command in the staging plugin has proven useful
- **THEN** it is moved into its own plugin or an existing one and removed from staging, and both plugins' versions reflect the change
