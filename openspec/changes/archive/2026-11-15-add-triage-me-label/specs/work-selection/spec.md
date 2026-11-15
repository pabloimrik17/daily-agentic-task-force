# Spec Delta

## ADDED Requirements

### Requirement: A marked task is excluded

A task that carries `triage-me` SHALL be excluded as **triage-me**, after the classification and taken exclusions and before every other. A task from which this run removed `triage-me` SHALL NOT be excluded for it.

#### Scenario: Stale mark

- **WHEN** a run without `--apply` reads a task that carries `personal`, `grill-me` and `triage-me`
- **THEN** the task is excluded as triage-me

#### Scenario: Marked and incomplete

- **WHEN** a task carries `personal` and `triage-me` and no autonomy or stage label
- **THEN** it is excluded under classification, not as triage-me

#### Scenario: Mark removed in this run

- **WHEN** `label-triage` removed `triage-me` from a task that carries `work`, `HITL` and `proposal`, and wrote nothing else to it
- **THEN** the task is not excluded as triage-me
