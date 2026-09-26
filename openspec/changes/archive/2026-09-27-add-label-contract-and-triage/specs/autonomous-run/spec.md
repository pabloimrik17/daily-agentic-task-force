# Spec Delta

## ADDED Requirements

### Requirement: Label bootstrap mode

With `--bootstrap-labels`, the run SHALL execute only the label bootstrap of the label contract and exit; no step runs. The flag MAY be combined with `--json` only; any other flag with it is a usage error. The exit code SHALL be 0 when every enabled source has every contract label present or created, 3 when the configuration cannot be loaded, any source was not evaluable, or any label could not be created, and 1 for a usage error or a failure of the runner itself. The report SHALL list, per source, the labels created, present and failed.

#### Scenario: Bootstrap only

- **WHEN** the run is invoked with `--bootstrap-labels`
- **THEN** no step runs and the bootstrap report is printed

#### Scenario: Bootstrap with apply

- **WHEN** the run is invoked with `--bootstrap-labels --apply`
- **THEN** the run prints a usage message and exits with code 1

#### Scenario: Label creation fails

- **WHEN** a label cannot be created
- **THEN** it is reported as failed and the process exits with code 3

### Requirement: Explicit apply flag

The run SHALL accept `--apply` and pass it to every step. A step SHALL NOT write to a tracker unless `--apply` was given; without it, a run has no side effects beyond the CLIs' own caches.

#### Scenario: Run without apply

- **WHEN** the run is invoked without `--apply`
- **THEN** no step issues a write to any tracker

#### Scenario: Run with apply

- **WHEN** the run is invoked with `--apply`
- **THEN** steps that write do so under their own rules

## MODIFIED Requirements

### Requirement: Run report

With `--json`, the run SHALL print a single JSON document identified by `schema: "autonomous.run.v1"`, containing the start time, the result of every executed step (step id, tier, outcome, reasons, data) and the run outcome. Without `--json`, it SHALL print a pre-rendered text report of the same information. The report MAY include a `handoff` field, reserved for future steps that require an agent to act; this iteration never emits it.

With `--bootstrap-labels`, the run SHALL instead print the bootstrap report. With `--json`, it is a single JSON document identified by `schema: "autonomous.bootstrap.v1"`, containing the start time, the outcome and, per source, the labels created, present and failed; when the configuration cannot be loaded, it contains no sources and holds the configuration path and the error instead. Without `--json`, it is a text report of the same information, except that a configuration that cannot be loaded is reported on stderr only.

#### Scenario: JSON report

- **WHEN** the run is invoked with `--json` and without `--bootstrap-labels`
- **THEN** stdout contains exactly one JSON document with `schema` equal to `autonomous.run.v1`

#### Scenario: Text report

- **WHEN** the run is invoked without `--json` and without `--bootstrap-labels`
- **THEN** stdout contains a readable report listing each executed step, its outcome and its reasons

#### Scenario: Bootstrap JSON report

- **WHEN** the run is invoked with `--bootstrap-labels --json`
- **THEN** stdout contains exactly one JSON document with `schema` equal to `autonomous.bootstrap.v1`, listing per enabled source the labels created, present and failed
