## MODIFIED Requirements

### Requirement: Completion needs two proofs

An attempt's stage SHALL count as completed only when a valid result marker exists for that attempt and the stage's own check against the task's tracker holds. A marker is valid when it parses, names that attempt's id and reports outcome `completed`, or `round-ended` as an ended round defines. A marker that is missing, malformed, or names another attempt SHALL count as absent and be reported.

#### Scenario: Marker from another attempt

- **WHEN** the marker in attempt 2's directory names attempt 1
- **THEN** the marker counts as absent and attempt 2 is not completed

#### Scenario: Tracker changed by hand

- **WHEN** the stage's tracker check holds but no marker was written
- **THEN** the attempt is not completed

#### Scenario: Both proofs present

- **WHEN** the marker is valid and the stage's tracker check holds
- **THEN** the attempt is eligible for finalisation

#### Scenario: Round ended in a stage that has no rounds

- **WHEN** the marker of a `verify` attempt reports `round-ended`
- **THEN** the marker counts as absent and is reported

### Requirement: Stage contract

A stage SHALL declare: its id, its emoji, its prerequisites, its prompt for a task, its agent arguments, and its completion check against the task's tracker. A stage MAY also declare a check for a round that ended without a transition; a stage that declares none never accepts the result marker outcome `round-ended`. A stage's prerequisites SHALL be checked by `launch` before anything is written, and what they read at launch MAY be given to its prompt. A stage SHALL be launchable only when an implementation is registered for its id: a declared stage with none makes `launch` wait, saying the stage has no implementation. Registering a stage SHALL require no change to `reconcile` or `launch`.

#### Scenario: Stage registered later

- **WHEN** an implementation for `grill-me` is registered
- **THEN** `launch` can launch `grill-me` units without any change to the steps

#### Scenario: Stage without prerequisites

- **WHEN** the `test` stage is launched
- **THEN** its prerequisites hold without any check

#### Scenario: Supplied task in a stage with no implementation

- **WHEN** a task is supplied with `--task` and carries `qa`, which is declared and has no implementation
- **THEN** `launch` waits with `<source>:<id> is excluded: unsupported stage` and writes nothing

#### Scenario: Declared stage without implementation reaches launch

- **WHEN** `launch` is reached with the declared stage `qa`, which has no implementation
- **THEN** `launch` waits with `stage qa has no implementation` and writes nothing

#### Scenario: Stage with rounds

- **WHEN** the `external-review` stage is registered
- **THEN** its contract declares both the completion check and the check of an ended round

## ADDED Requirements

### Requirement: An ended round completes its attempt

A marker reporting `round-ended` SHALL be valid only for a stage whose contract declares the check of an ended round. Its attempt SHALL count as completed when that check holds for the task and the attempt's directory holds a persistence receipt and a publish receipt whose digest is its record's. It SHALL then be finalised as any completed attempt, and the task keeps its stage label.

#### Scenario: Round ended

- **WHEN** the marker of `linear:DOT-121:external-review:1` reports `round-ended`, the task carries `external-review`, and the attempt holds both receipts, the publish receipt current
- **THEN** the attempt is eligible for finalisation, its slot is freed, and the task keeps `external-review`

#### Scenario: Round ended without a publish receipt

- **WHEN** the same marker exists and the attempt's directory holds no publish receipt
- **THEN** the attempt is not completed, and it is retained when its session ends
