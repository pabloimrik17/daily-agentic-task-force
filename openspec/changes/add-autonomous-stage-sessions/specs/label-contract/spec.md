# Spec Delta

## ADDED Requirements

### Requirement: Optional configuration blocks with shipped defaults

The configuration file MAY omit the `sessions`, `workspace` and `naming` blocks or any key inside them. The plugin SHALL ship a defaults file for those blocks, and a key absent from the user's file SHALL take the shipped value, key by key. A key present in the user's file SHALL still be validated strictly, and an unknown key is still an error. Every run SHALL report the keys that took a shipped default.

#### Scenario: Block omitted

- **WHEN** the file has no `sessions` block
- **THEN** every `sessions` key takes the shipped default and the report lists them

#### Scenario: One key set

- **WHEN** the file sets `sessions.tool` only
- **THEN** that value is used and the other `sessions` keys take the shipped defaults

#### Scenario: Mistyped optional key

- **WHEN** the file sets `naming.effort` to `"fast"`
- **THEN** the configuration is rejected with the path `naming.effort`

### Requirement: Session, workspace and naming settings

The configuration SHALL hold, under `sessions`: `tool` (`claude` or `codex`), `profile` (the session manager's profile, or null for its default) and `binary` (the agent binary or wrapper to run, or null for the tool's own); under `workspace`: `root`, the directory whose git repositories are the launch targets; under `naming`: `model` and `effort` for the session name inference. The shipped defaults SHALL be `claude`, null, null, `~/WebstormProjects`, `haiku` and `low`.

#### Scenario: Shipped defaults

- **WHEN** the file carries none of the three blocks
- **THEN** sessions run `claude` on the session manager's default profile, repositories are looked up under `~/WebstormProjects`, and names are inferred with `haiku` at effort `low`

## MODIFIED Requirements

### Requirement: The taken label

The contract SHALL include a `taken` label that belongs to neither group. It is never required, never missing and never in conflict, and label triage SHALL neither derive it nor ask about it. It SHALL mean that an agent or a person is advancing the task now and that it is not selected until the label is removed. It is the only evidence that a task is taken; a tracker status is not. The runner SHALL add it when it launches a managed session for the task and SHALL remove it only when the attempt is finalised and its session is gone, or when no session was created; a retained attempt keeps it. Removing `taken` this way is the second exception to the rule that the loop never removes a label.

#### Scenario: Task without taken

- **WHEN** a task carries `work` and `AFK` and no `taken`
- **THEN** it is complete for both groups and nothing reports `taken` as missing

#### Scenario: Taken added at launch

- **WHEN** the runner launches a managed session for a task
- **THEN** the task carries `taken` before the session exists

#### Scenario: Taken kept while retained

- **WHEN** an attempt is retained after its session exited without completing
- **THEN** the task still carries `taken` until the attempt is discarded

#### Scenario: Taken removed at finalisation

- **WHEN** an attempt is finalised and its session removed
- **THEN** `taken` is removed from the task and nothing else is removed

### Requirement: User configuration file

The per-user parts of the contract SHALL live in one JSON file outside the plugin, at `~/.config/autonomous/config.json` unless the environment variable `AUTONOMOUS_CONFIG` names another path. It SHALL be identified by `schema: "autonomous.config.v1"` and SHALL hold: per source, whether it is enabled, its aliases and structural rules, the Beads directory and the GitHub repository list; the judgement settings — model, effort, confidence threshold, tasks judged per run, tasks per batch; the selection settings — model and effort; and the optional session, workspace and naming settings. It SHALL carry no credentials. The file SHALL be validated strictly: a missing file, a missing required field, a mistyped field or an unknown field is an error naming the path, never a corrected value; an optional block or key that is absent takes its shipped default, and the run reports it. The plugin SHALL ship the format, the defaults and an example, and the error for a missing file SHALL point to the example.

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
