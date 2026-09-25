# Spec Delta

## ADDED Requirements

### Requirement: Label bootstrap mode

With `--bootstrap-labels`, the run SHALL execute only the label bootstrap of the label contract and exit; no step runs. The flag MAY be combined with `--json` only; any other flag with it is a usage error. The exit code SHALL be 0 when every enabled source has every contract label present or created, 3 when any source was not evaluable, and 1 for a usage error or a failure of the runner itself. The report SHALL list, per source, the labels created, present and failed.

#### Scenario: Bootstrap only

- **WHEN** the run is invoked with `--bootstrap-labels`
- **THEN** no step runs and the bootstrap report is printed

#### Scenario: Bootstrap with apply

- **WHEN** the run is invoked with `--bootstrap-labels --apply`
- **THEN** the run prints a usage message and exits with code 1

### Requirement: Explicit apply flag

The run SHALL accept `--apply` and pass it to every step. A step SHALL NOT write to a tracker unless `--apply` was given; without it, a run has no side effects beyond the CLIs' own caches.

#### Scenario: Run without apply

- **WHEN** the run is invoked without `--apply`
- **THEN** no step issues a write to any tracker

#### Scenario: Run with apply

- **WHEN** the run is invoked with `--apply`
- **THEN** steps that write do so under their own rules
