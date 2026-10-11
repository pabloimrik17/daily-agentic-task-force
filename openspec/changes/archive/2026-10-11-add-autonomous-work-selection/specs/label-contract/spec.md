## ADDED Requirements

### Requirement: The taken label

The contract SHALL include a `taken` label that belongs to neither group. It is never required, never missing and never in conflict, and label triage SHALL neither derive it nor ask about it. It SHALL mean that an agent or a person is advancing the task now and that it is not selected until the label is removed. It is the only evidence that a task is taken; a tracker status is not.

#### Scenario: Task without taken

- **WHEN** a task carries `work` and `AFK` and no `taken`
- **THEN** it is complete for both groups and nothing reports `taken` as missing

### Requirement: Taken has no aliases and is bootstrapped

The configuration SHALL NOT declare aliases for `taken`. The label bootstrap SHALL create `taken` like every other contract label.

#### Scenario: Alias for taken

- **WHEN** the configuration declares a Beads alias for `taken`
- **THEN** the configuration is rejected with the alias's path

#### Scenario: Bootstrap on GitHub

- **WHEN** a configured GitHub repository lacks `taken` and the bootstrap runs
- **THEN** `taken` is created with colour `#95a2b3` and reported as created

## MODIFIED Requirements

### Requirement: Meaning of each label

The contract SHALL fix one meaning per label: `work` is Nazaries work; `personal` is the user's own work; `AFK` means an agent may advance the task without a human; `HITL` means an agent may advance the task but a human intervenes during or at the end of each stage; `grill-me` means the task must be refined with a human before anyone works on it, and it takes precedence over `AFK` and `HITL` when combined; `taken` means an agent or a person is advancing the task now. No scope has priority over the other in the contract. What each label implies for selecting work, including the preference for the machine's scope, is defined by the capability that selects work, not by this contract.

#### Scenario: grill-me with AFK

- **WHEN** a task carries `AFK` and `grill-me`
- **THEN** the contract reads it as needing refinement before any agent works on it

#### Scenario: Meaning of work in a triage question

- **WHEN** triage offers `work` as an option
- **THEN** its description says it is Nazaries work and does not claim priority over personal work

### Requirement: One spelling and one colour per label

Each label SHALL have exactly one spelling, used verbatim on every tracker: `work`, `personal`, `AFK`, `HITL`, `grill-me`, `taken`. Matching SHALL be exact and case-sensitive; a label that differs only in case or spacing (for example `Grill Me`) is not the contract label. Each label SHALL have one colour, applied on trackers that support colour: `AFK` `#5e6ad2`, `HITL` `#eb5757`, `grill-me` `#f2994a`, `work` `#2f80ed`, `personal` `#27ae60`, `taken` `#95a2b3`. A tracker without label colours carries the name only.

#### Scenario: Near-miss spelling

- **WHEN** a Linear task carries `Grill Me` and the configuration declares no alias for it
- **THEN** the task is untagged for the entry group

#### Scenario: Tracker without colours

- **WHEN** the contract is applied to Beads
- **THEN** labels are matched by name and no colour is involved

#### Scenario: Near-miss taken

- **WHEN** a task carries `Taken`
- **THEN** it is not taken

### Requirement: User configuration file

The per-user parts of the contract SHALL live in one JSON file outside the plugin, at `~/.config/autonomous/config.json` unless the environment variable `AUTONOMOUS_CONFIG` names another path. It SHALL be identified by `schema: "autonomous.config.v1"` and SHALL hold: per source, whether it is enabled, its aliases and structural rules, the Beads directory and the GitHub repository list; the judgement settings — model, effort, confidence threshold, tasks judged per run, tasks per batch; and the selection settings — model and effort. It SHALL carry no credentials. The file SHALL be validated strictly: a missing file, a missing required field, a mistyped field or an unknown field is an error naming the path, never a default. The plugin SHALL ship the format and an example, and the error for a missing file SHALL point to the example.

#### Scenario: Missing file

- **WHEN** no configuration file exists at the resolved path
- **THEN** any behaviour that needs the contract reports it as not evaluable, naming the path and the example

#### Scenario: Unknown field

- **WHEN** the file contains a field the schema does not define
- **THEN** it is rejected with the field's path

#### Scenario: Missing selection settings

- **WHEN** the file has no `selection` block
- **THEN** it is rejected with the path `selection`
