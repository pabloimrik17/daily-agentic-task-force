## Purpose

Decides whether the autonomous loop may spend Claude quota now, from OpenUsage data for one explicitly selected account, and explains the decision with values that can be checked by hand.

## ADDED Requirements

### Requirement: Read quota from OpenUsage

The gate SHALL obtain quota by running the `openusage` CLI for the Claude provider, using its shared cache unless `--force` is given, and SHALL validate the output against the `openusage.limits.v1` contract. Validation SHALL cover the whole document, not only the evaluated account and windows. A missing CLI, a non-zero exit, a timeout (120 s), unparseable output or a schema mismatch SHALL produce `not-evaluable` with the reason; a contract violation anywhere in the output, including in an account or resource the gate does not evaluate, SHALL produce `not-evaluable` with a reason that names the offending path.

#### Scenario: CLI unavailable

- **WHEN** `openusage` cannot be executed
- **THEN** the outcome is `not-evaluable` and the reason names the failure

#### Scenario: Forced refresh

- **WHEN** the run is invoked with `--force`
- **THEN** OpenUsage is asked to bypass its cache

#### Scenario: Malformed data outside the evaluated windows

- **WHEN** a resource or account the gate does not evaluate violates the `openusage.limits.v1` contract
- **THEN** the outcome is `not-evaluable` and the reason names the offending path

### Requirement: Unambiguous account selection

The gate SHALL consider every provider whose key is `claude` or starts with `claude@` as a Claude account, and SHALL also count, under the same rule, every key that appears only as a `providerId` in OpenUsage's `errors`; such an account is evaluated as having no data and carries its error, so its outcome is `not-evaluable`. With `--account <key>` it SHALL use exactly that account. Without it, it SHALL use the only Claude account when there is exactly one. It SHALL NOT aggregate accounts or switch the active account.

#### Scenario: Several accounts, none selected

- **WHEN** two Claude accounts are present and `--account` is absent
- **THEN** the outcome is `not-evaluable`, the reason is an ambiguous account, and the candidate keys and display names are listed

#### Scenario: Unknown account

- **WHEN** `--account` names a key that is not present
- **THEN** the outcome is `not-evaluable` and the available keys are listed

#### Scenario: Single account

- **WHEN** exactly one Claude account is present and `--account` is absent
- **THEN** that account is evaluated

### Requirement: Evaluated windows

The gate SHALL evaluate the `session` and `weekly` resources of the selected account, reporting for each its used amount, limit, reset time and window duration. Any other resource SHALL be listed with its current usage and marked as not evaluated.

#### Scenario: Extra resource

- **WHEN** the account also reports a well-formed `fable` resource
- **THEN** it appears in the report as not evaluated and does not affect the outcome

### Requirement: Projected usage

For each evaluated window, the gate SHALL compute projected usage as OpenUsage does: with `elapsed = now − (resetsAt − windowSeconds)`, `projected = used / elapsed × windowSeconds`. It SHALL NOT compute a projection for a window that is missing, incomplete or invalid (see "Gate decision"). Otherwise it SHALL report no projection, with the reason, when nothing has been used, when `now` is at or after `resetsAt`, or when `elapsed` is below `max(60 s, 1% of the window)`.

#### Scenario: Session example

- **WHEN** a 5-hour window has 20% used, 2 hours elapsed
- **THEN** the projected usage is 50%

#### Scenario: Weekly example

- **WHEN** a weekly window has 30% used, 3 days elapsed
- **THEN** the projected usage is 70%

#### Scenario: Too early in the window

- **WHEN** a 5-hour window has 2 minutes elapsed
- **THEN** no projection is reported and the reason is insufficient elapsed time

#### Scenario: No consumption

- **WHEN** a window has 0 used
- **THEN** no projection is reported and the reason is no consumption

### Requirement: Gate decision

The gate outcome SHALL be:

1. `wait` when any evaluated window with complete, valid, fresh data has `used ≥ limit`, where data is fresh when the account is not stale and OpenUsage reports no error for it;
2. otherwise `not-evaluable` when the account is stale, OpenUsage reports an error for it, or a required window is missing, incomplete or invalid;
3. otherwise `advance`.

Projected usage SHALL be reported but SHALL NOT affect the outcome. Missing or stale data SHALL never be treated as zero usage or available capacity, and valid values SHALL still be reported alongside a `not-evaluable` outcome. A window is invalid when its `used` is negative or its `limit` or `windowSeconds` is not positive. A window is incomplete when its resource is present but lacks `used`, `limit`, `resetsAt` or `windowSeconds`.

#### Scenario: Exhausted window

- **WHEN** the weekly window reports 100 used of 100
- **THEN** the outcome is `wait` and the reason names the weekly window and its reset time

#### Scenario: Exhausted beats missing data

- **WHEN** the session window is exhausted and the weekly window is missing
- **THEN** the outcome is `wait`, and the missing weekly window is still reported

#### Scenario: Exhausted window with an OpenUsage error

- **WHEN** a window is exhausted and OpenUsage reports an error for the account
- **THEN** the outcome is `not-evaluable` and the reason carries the error

#### Scenario: Projection above capacity

- **WHEN** both windows are below their limit but the session projection is 130%
- **THEN** the outcome is `advance` and the projection is reported

#### Scenario: At capacity

- **WHEN** a window reports exactly `used = limit`
- **THEN** the outcome is `wait`

#### Scenario: Stale data

- **WHEN** OpenUsage marks the selected account as stale
- **THEN** the outcome is `not-evaluable`, the reason says the data is stale, and the last known values are shown flagged as stale

#### Scenario: Incomplete window

- **WHEN** the weekly window is present but has no `resetsAt`, and the session window is complete, valid and below its limit
- **THEN** the outcome is `not-evaluable` and the reason names the weekly window and the missing field

#### Scenario: Invalid window

- **WHEN** the session window reports a limit of 0, a negative used amount, or a window duration of 0, and the weekly window is valid and below its limit
- **THEN** the outcome is `not-evaluable`, never `wait` or `advance`, and the reason names the session window and the invalid value
