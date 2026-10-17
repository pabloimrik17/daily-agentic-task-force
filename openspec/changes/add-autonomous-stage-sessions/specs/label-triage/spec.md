# Spec Delta

## ADDED Requirements

### Requirement: Trackers can remove a label

Each tracker SHALL be able to remove one named label from a task through its own CLI, leaving every other label in place, and SHALL read the task back to confirm the label is gone. Label triage and its answers SHALL never use it; only the management of stage sessions removes labels, and only `taken`.

#### Scenario: Remove taken on Beads

- **WHEN** `taken` is removed from a Beads task carrying `work`, `grill-me` and `taken`
- **THEN** the task carries `work` and `grill-me`

#### Scenario: Removal not confirmed

- **WHEN** the task read back still carries the label after the removal command succeeded
- **THEN** the removal is reported as failed with the labels found

#### Scenario: Triage never removes

- **WHEN** `label-triage` runs with `--apply`
- **THEN** no label removal command is issued
