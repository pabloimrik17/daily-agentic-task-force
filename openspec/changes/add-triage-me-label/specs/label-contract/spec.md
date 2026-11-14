# Spec Delta

## ADDED Requirements

### Requirement: The triage label

The contract SHALL include a `triage-me` label that belongs to no group. It is never required, never missing and never in conflict. It SHALL mean that the task's scope or autonomy could not be decided without the human, and that the task is neither judged again nor selected until the label is removed. The label names no group: the group in doubt SHALL be the scope or autonomy group that has no label on the task.

#### Scenario: Task without the label

- **WHEN** a task carries `work`, `AFK` and `proposal` and no `triage-me`
- **THEN** it is complete for every group and nothing reports `triage-me` as missing

#### Scenario: Group in doubt

- **WHEN** a task carries `personal` and `triage-me` and no autonomy or stage label
- **THEN** its group in doubt is autonomy

### Requirement: Who sets the triage label

Only `label-triage` and the answers to its questions SHALL add or remove `triage-me` on behalf of the runner. A person MAY add or remove it in the tracker, and the runner SHALL treat the label the same whoever set it.

#### Scenario: Label set by a person

- **WHEN** a person adds `triage-me` in the tracker to a task that lacks a scope label
- **THEN** the task is treated as marked, as if a run had added the label

### Requirement: The triage label has no aliases and is bootstrapped

The configuration SHALL NOT declare aliases for `triage-me`. The label bootstrap SHALL create `triage-me` like every other contract label, with colour `#f2c94c`.

#### Scenario: Alias for the triage label

- **WHEN** the configuration declares a Beads alias for `triage-me`
- **THEN** the configuration is rejected with the alias's path

#### Scenario: Bootstrap on Linear

- **WHEN** Linear lacks `triage-me` and the bootstrap runs
- **THEN** `triage-me` is created at workspace level with colour `#f2c94c` and reported as created
