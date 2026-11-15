# Spec Delta

## ADDED Requirements

### Requirement: The attempt keeps its agent arguments

The attempt's record SHALL hold the agent arguments its stage declared when the attempt was launched, so a later change to a stage does not change what an attempt reports. A record written before this requirement holds none and SHALL still be read.

#### Scenario: Grill-me attempt launched

- **WHEN** a grill-me attempt is launched with the `claude` tool
- **THEN** its record holds `--model opus --effort high`

#### Scenario: Older record

- **WHEN** a record without agent arguments is read
- **THEN** it parses, and its agent arguments read as not recorded

### Requirement: A completed attempt without a logbook entry is noted

When `reconcile` finalises an attempt whose directory holds no logbook receipt, it SHALL finalise it as any other and report a note naming the attempt and the missing entry. The note SHALL NOT change the step's outcome.

#### Scenario: Task closed in the grill

- **WHEN** a grill-me attempt completes because the human closed the task, with no logbook receipt
- **THEN** the attempt is finalised and the report notes that it left no logbook entry

#### Scenario: Entry published

- **WHEN** a completed attempt's directory holds a logbook receipt
- **THEN** the attempt is finalised and no note is reported
