# Spec Delta

## Purpose

Counts the managed sessions the runner has open as slots of two kinds, compares them with configurable limits, and keeps the loop from launching into a kind that is full.

## ADDED Requirements

### Requirement: What occupies a slot

Every open attempt SHALL occupy exactly one slot, whichever command launched it, for as long as it is open. An attempt that is not open, and a session that no attempt records, SHALL occupy none.

#### Scenario: Retained attempt

- **WHEN** an attempt is `retained`
- **THEN** it occupies a slot until it is discarded

#### Scenario: Session made by hand

- **WHEN** a session of the session manager exists that no attempt records
- **THEN** it occupies no slot

#### Scenario: Attempt launched with a supplied task

- **WHEN** `/autonomous:run --apply --task linear:DOT-120` launched an attempt that is still `started`
- **THEN** the attempt occupies a slot

### Requirement: Two kinds of slot

A slot SHALL be a grill slot when its attempt's stage is `grill-me`, and a work slot for any other stage. The two kinds SHALL be counted separately.

#### Scenario: Grill attempt

- **WHEN** the attempt `linear:DOT-120:grill-me:1` is open
- **THEN** one grill slot is occupied and no work slot is

#### Scenario: Test stage attempt

- **WHEN** the attempt `linear:DOT-109:test:1` is open
- **THEN** one work slot is occupied

### Requirement: Slot limits

Each kind SHALL have a limit: `runner.grills` for grill slots and `runner.parallel` for work slots, each an integer of 0 or more. In a loop, `--grills` and `--parallel` SHALL replace the configured value for that loop. A kind SHALL be full when its occupied slots are equal to or above its limit.

#### Scenario: Shipped defaults

- **WHEN** the configuration file has no `runner` block and no flag is given
- **THEN** the limits are 1 grill slot and 2 work slots

#### Scenario: Flag over file

- **WHEN** the file sets `runner.parallel` to 2 and the loop is started with `--parallel 1`
- **THEN** the work slot limit of that loop is 1

#### Scenario: Limit of zero

- **WHEN** the grill slot limit is 0
- **THEN** the grill kind is full with no open attempt

### Requirement: The capacity step

`/autonomous:run` and every iteration SHALL run a `capacity` step after `reconcile`. It SHALL count the open attempts per kind from the attempts as `reconcile` left them, and SHALL write nothing. It SHALL be `not-evaluable` when the configuration cannot be loaded.

#### Scenario: Count after finalisation

- **WHEN** `reconcile` finalises the only open grill attempt in a run with `--apply`
- **THEN** `capacity` reports 0 occupied grill slots

#### Scenario: Configuration missing

- **WHEN** the configuration file does not exist
- **THEN** `capacity` is `not-evaluable` and names the path

### Requirement: Only the loop is bound

In an iteration, `capacity` SHALL be `wait` when every kind is full, and `advance` otherwise. Outside an iteration it SHALL be `advance` whatever the counts, and a launch SHALL NOT be refused because a kind is full.

#### Scenario: Iteration with every kind full

- **WHEN** an iteration finds 1 of 1 grill slots and 2 of 2 work slots occupied
- **THEN** `capacity` is `wait` with a reason naming both kinds, and no later step runs

#### Scenario: Iteration with one kind free

- **WHEN** an iteration finds 1 of 1 grill slots and 1 of 2 work slots occupied
- **THEN** `capacity` is `advance`

#### Scenario: Manual run over the limit

- **WHEN** `/autonomous:run --apply --task linear:DOT-120` runs with 1 of 1 grill slots occupied and the task is in `grill-me`
- **THEN** `capacity` is `advance`, the attempt is launched and 2 grill slots are occupied

### Requirement: Capacity report

The text report of `capacity` SHALL show, per kind, the occupied slots, the limit, where the limit came from (`flag`, `file` or `default`) and the attempts that occupy the slots. It SHALL say when a kind is over its limit. With `--json` the step's data SHALL carry the same information.

#### Scenario: Over the limit

- **WHEN** 3 work slots are occupied and the limit is 2
- **THEN** the report shows `3/2` for work slots and says the kind is over its limit

#### Scenario: Source of a limit

- **WHEN** the grill limit comes from `--grills 2` and the work limit from the shipped default
- **THEN** the report names `flag` for grill slots and `default` for work slots
