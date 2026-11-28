## MODIFIED Requirements

### Requirement: User configuration file

The per-user parts of the contract SHALL live in one JSON file outside the plugin, at `~/.config/autonomous/config.json` unless the environment variable `AUTONOMOUS_CONFIG` names another path. It SHALL be identified by `schema: "autonomous.config.v1"` and SHALL hold: per source, whether it is enabled, its aliases and structural rules, the Beads directory and the GitHub repository list; the judgement settings — model, effort, confidence threshold, tasks judged per run, tasks per batch; the selection settings — model and effort; and the optional session, workspace, naming, runner and review settings. It SHALL carry no credentials. The file SHALL be validated strictly: a missing file, a missing required field, a mistyped field or an unknown field is an error naming the path, never a corrected value; an optional block or key that is absent takes its shipped default, and the run reports it. The plugin SHALL ship the format, the defaults and an example, and the error for a missing file SHALL point to the example.

#### Scenario: Missing file

- **WHEN** no configuration file exists at the resolved path
- **THEN** any behaviour that needs the contract reports it as not evaluable, naming the path and the example

#### Scenario: Unknown field

- **WHEN** the file contains a field the schema does not define
- **THEN** it is rejected with the field's path

#### Scenario: Missing selection settings

- **WHEN** the file has no `selection` block
- **THEN** it is rejected with the path `selection`

#### Scenario: Missing sessions settings

- **WHEN** the file has no `sessions` block
- **THEN** it is accepted and the `sessions` keys take the shipped defaults

### Requirement: Optional configuration blocks with shipped defaults

The configuration file MAY omit the `sessions`, `workspace`, `naming`, `runner` and `review` blocks or any key inside them. The plugin SHALL ship a defaults file for those blocks, and a key absent from the user's file SHALL take the shipped value, key by key. A key present in the user's file SHALL still be validated strictly, and an unknown key is still an error. Every run SHALL report the keys that took a shipped default.

#### Scenario: Block omitted

- **WHEN** the file has no `sessions` block
- **THEN** every `sessions` key takes the shipped default and the report lists them

#### Scenario: One key set

- **WHEN** the file sets `sessions.tool` only
- **THEN** that value is used and the other `sessions` keys take the shipped defaults

#### Scenario: Mistyped optional key

- **WHEN** the file sets `naming.effort` to `"fast"`
- **THEN** the configuration is rejected with the path `naming.effort`

#### Scenario: Runner block omitted

- **WHEN** the file has no `runner` block
- **THEN** every `runner` key takes the shipped default and the report lists them

#### Scenario: Review block omitted

- **WHEN** the file has no `review` block
- **THEN** every `review` key takes the shipped default and the report lists them
