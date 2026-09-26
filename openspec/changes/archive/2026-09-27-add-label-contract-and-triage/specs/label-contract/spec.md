# Spec Delta

## Purpose

The label vocabulary shared by every tracker the autonomous loop reads — which labels exist, what they mean, how they are spelled and coloured, which legacy labels count as evidence — the user configuration that carries its per-user parts, and the bootstrap that creates missing labels on a tracker.

## ADDED Requirements

### Requirement: Two mandatory label groups

Every task SHALL carry at least one label from each of two groups. The **scope** group is `work` and `personal`, mutually exclusive: a task carrying both is in conflict. The **entry** group is `AFK`, `HITL` and `grill-me`; a task carrying both `AFK` and `HITL` is in conflict. A task without a label of a group is untagged for that group. Missing groups and conflicts SHALL be detected and reported per group, and SHALL NOT be resolved by the system removing or replacing a label.

#### Scenario: Complete task

- **WHEN** a task carries `personal` and `AFK`
- **THEN** it is complete for both groups

#### Scenario: Missing entry group

- **WHEN** a task carries `work` and no entry label
- **THEN** it is reported as untagged for the entry group only

#### Scenario: Both scopes

- **WHEN** a task carries `work` and `personal`
- **THEN** it is reported as a scope conflict and neither label is removed

#### Scenario: AFK with HITL

- **WHEN** a task carries `AFK` and `HITL`
- **THEN** it is reported as an entry conflict for a human to resolve

### Requirement: Meaning of each label

The contract SHALL fix one meaning per label: `work` is Nazaries work and has priority over personal work; `personal` is the user's own work; `AFK` means an agent may advance the task without a human; `HITL` means an agent may advance the task but a human intervenes during or at the end of each stage; `grill-me` means the task must be refined with a human before anyone works on it, and it takes precedence over `AFK` and `HITL` when combined. What each label implies for selecting work is defined by the capability that selects work, not by this contract.

#### Scenario: grill-me with AFK

- **WHEN** a task carries `AFK` and `grill-me`
- **THEN** the contract reads it as needing refinement before any agent works on it

### Requirement: One spelling and one colour per label

Each label SHALL have exactly one spelling, used verbatim on every tracker: `work`, `personal`, `AFK`, `HITL`, `grill-me`. Matching SHALL be exact and case-sensitive; a label that differs only in case or spacing (for example `Grill Me`) is not the contract label. Each label SHALL have one colour, applied on trackers that support colour: `AFK` `#5e6ad2`, `HITL` `#eb5757`, `grill-me` `#f2994a`, `work` `#2f80ed`, `personal` `#27ae60`. A tracker without label colours carries the name only.

#### Scenario: Near-miss spelling

- **WHEN** a Linear task carries `Grill Me` and the configuration declares no alias for it
- **THEN** the task is untagged for the entry group

#### Scenario: Tracker without colours

- **WHEN** the contract is applied to Beads
- **THEN** labels are matched by name and no colour is involved

### Requirement: Aliases are evidence, never removed

The configuration MAY declare, per source, alias labels that count as evidence for one contract label (for example Beads `nazaries` for `work`, `human` for `HITL`). An alias SHALL NOT count as the contract label being present. The system SHALL NOT remove, rename or replace an alias or any other label; the only write the contract allows is adding a contract label.

#### Scenario: Alias present

- **WHEN** a Beads task carries `nazaries` and no scope label
- **THEN** it is untagged for the scope group, with `nazaries` recorded as evidence for `work`

### Requirement: Structural rules

The configuration MAY declare that every task of a source has a given scope. A structural rule SHALL count as evidence for that scope for every task of that source.

#### Scenario: Whole source rule

- **WHEN** the configuration declares that every Linear task is `personal`
- **THEN** every Linear task without a scope label carries evidence for `personal`

### Requirement: User configuration file

The per-user parts of the contract SHALL live in one JSON file outside the plugin, at `~/.config/autonomous/config.json` unless the environment variable `AUTONOMOUS_CONFIG` names another path. It SHALL be identified by `schema: "autonomous.config.v1"` and SHALL hold: per source, whether it is enabled, its aliases and structural rules, the Beads directory and the GitHub repository list; and the judgement settings — model, effort, confidence threshold, tasks judged per run, tasks per batch. It SHALL carry no credentials. The file SHALL be validated strictly: a missing file, a missing required field, a mistyped field or an unknown field is an error naming the path, never a default. The plugin SHALL ship the format and an example, and the error for a missing file SHALL point to the example.

#### Scenario: Missing file

- **WHEN** no configuration file exists at the resolved path
- **THEN** any behaviour that needs the contract reports it as not evaluable, naming the path and the example

#### Scenario: Unknown field

- **WHEN** the file contains a field the schema does not define
- **THEN** it is rejected with the field's path

### Requirement: Label bootstrap

On request, the system SHALL make every contract label exist on every enabled source: it lists the source's labels, creates each missing contract label with its colour where the tracker supports colour, and leaves every existing label untouched, including one that already exists with a different colour, which it reports. On Linear, labels SHALL be created at workspace level, and a same-name label that already exists in a team SHALL count as present, so no workspace duplicate is created; on GitHub, per configured repository; on Beads, labels exist by use and nothing is created. It SHALL report, per source, the labels created, the labels already present and any that could not be created. A source whose CLI is missing, not authenticated or failing SHALL be reported as not evaluable with the command that failed, and the other sources SHALL still be processed.

#### Scenario: Label missing on Linear

- **WHEN** Linear lacks `work` and the bootstrap runs
- **THEN** `work` is created at workspace level with colour `#2f80ed` and reported as created

#### Scenario: Label present in a Linear team

- **WHEN** Linear has `AFK` only in team `DOT` and the bootstrap runs
- **THEN** no workspace `AFK` is created and `AFK` is reported as present in team `DOT`

#### Scenario: Label present with another colour

- **WHEN** GitHub repository `dotfiles` has `AFK` in colour `#000000`
- **THEN** the label is left as is and reported as present with a differing colour

#### Scenario: Beads

- **WHEN** the bootstrap processes Beads
- **THEN** it reports that Beads needs no label creation

#### Scenario: Unauthenticated CLI

- **WHEN** `linear` reports that no credentials are configured
- **THEN** Linear is reported as not evaluable, naming `linear auth login`, and GitHub and Beads are still processed
