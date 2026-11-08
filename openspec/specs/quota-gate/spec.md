# quota-gate Specification

## Purpose

Decides whether the autonomous loop may spend Claude quota now, from OpenUsage data for one unambiguously selected account, and explains the decision with values that can be checked by hand.

## Requirements

### Requirement: Read quota from OpenUsage

The gate SHALL obtain quota by running the `openusage` CLI for the Claude provider, using its shared cache unless `--force` is given, and SHALL validate the output against the `openusage.limits.v1` contract. Validation SHALL cover the whole document, not only the evaluated account and windows. A missing CLI, a timeout (120 s), unparseable output or a schema mismatch SHALL produce `not-evaluable` with the reason; a contract violation anywhere in the output, including in an account or resource the gate does not evaluate, SHALL produce `not-evaluable` with a reason that names the offending path. A non-zero exit SHALL be handled as "Read output after a non-zero exit" defines, which takes precedence over this requirement for the reason.

#### Scenario: CLI unavailable

- **WHEN** `openusage` cannot be executed
- **THEN** the outcome is `not-evaluable` and the reason names the failure

#### Scenario: Forced refresh

- **WHEN** the run is invoked with `--force`
- **THEN** OpenUsage is asked to bypass its cache

#### Scenario: Malformed data outside the evaluated windows

- **WHEN** OpenUsage exits 0 and a resource or account the gate does not evaluate violates the `openusage.limits.v1` contract
- **THEN** the outcome is `not-evaluable` and the reason names the offending path

### Requirement: Unambiguous account selection

The gate SHALL consider every provider whose key is `claude` or starts with `claude@` as a Claude account, and SHALL also count, under the same rule, every key that appears only as a `providerId` in OpenUsage's `errors`; such an account is evaluated as having no data and carries its error, so its outcome is `not-evaluable`. With `--account <key>` it SHALL use exactly that account. Without it, it SHALL use the only Claude account when there is exactly one. It SHALL NOT aggregate accounts or switch the active account.

#### Scenario: Several accounts, none selected

- **WHEN** two Claude accounts are present and `--account` is absent
- **THEN** the outcome is `not-evaluable`, the reason is an ambiguous account, and the account keys and display names are listed

#### Scenario: Unknown account

- **WHEN** `--account` names a key that is not present
- **THEN** the outcome is `not-evaluable` and the available keys are listed

#### Scenario: Single account

- **WHEN** exactly one Claude account is present and `--account` is absent
- **THEN** that account is evaluated

#### Scenario: No Claude account

- **WHEN** OpenUsage reports no Claude account and `--account` is absent
- **THEN** the outcome is `not-evaluable` and the reason says no Claude account was reported

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

1. `wait` when any evaluated window with complete, valid, fresh data has `used ≥ limit` and its `resetsAt` is still after `now`, where data is fresh when the account is not stale and OpenUsage reports no error for it;
2. otherwise `not-evaluable` when the account is stale, OpenUsage reports an error for it, a required window is missing, incomplete or invalid, or a window has `used ≥ limit` with its `resetsAt` at or before `now`, because that exhaustion predates a reset that has already happened and the data must be refreshed (for example with `--force`);
3. otherwise `advance`.

Projected usage SHALL be reported but SHALL NOT affect the outcome. Missing or stale data SHALL never be treated as zero usage or available capacity, and valid values SHALL still be reported alongside a `not-evaluable` outcome of this decision; output that fails validation reports no values (see "Read quota from OpenUsage"). A window is invalid when its `used` is negative or its `limit` or `windowSeconds` is not positive. A window is incomplete when its resource is present but lacks `used`, `limit`, `resetsAt` or `windowSeconds`.

#### Scenario: Exhausted window

- **WHEN** the weekly window reports 100 used of 100, with its reset still ahead
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

- **WHEN** a window reports exactly `used = limit`, with its reset still ahead
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

#### Scenario: Exhausted window past its reset time

- **WHEN** fresh data reports the weekly window at 100 used of 100 with a `resetsAt` before `now`, and the session window is complete, valid and below its limit
- **THEN** the outcome is `not-evaluable`, never `wait`, and the reason says the weekly window's reset time has passed and suggests refreshing with `--force`

### Requirement: Read output after a non-zero exit

When OpenUsage exits with a non-zero code, the gate SHALL read its output if it is a valid `openusage.limits.v1` document with at least one `errors` entry, and SHALL decide as for any other document, so an account error affects only the account it names. Otherwise the outcome SHALL be `not-evaluable`, with the CLI failure and its stderr as the reason when the output is empty or fails validation, and with the exit code and stderr when it is valid but `errors` is empty.

#### Scenario: Account error for another account

- **WHEN** OpenUsage exits non-zero, its output is valid and its `errors` names only `claude@b`, and `--account claude` selects an account whose windows are complete, valid, fresh and below their limits
- **THEN** the outcome is `advance`, and no reason mentions `claude@b`, the exit code or stderr

#### Scenario: Account error for the selected account

- **WHEN** OpenUsage exits non-zero, its output is valid, and its `errors` names the selected account
- **THEN** the outcome is `not-evaluable` and the reason carries that account's error message

#### Scenario: Non-zero exit without an account error

- **WHEN** OpenUsage exits non-zero and its output is a valid document whose `errors` is empty
- **THEN** the outcome is `not-evaluable` and the reason names the exit code and stderr

#### Scenario: Non-zero exit with unusable output

- **WHEN** OpenUsage exits non-zero and its output is empty, is not JSON, or violates the `openusage.limits.v1` contract
- **THEN** the outcome is `not-evaluable` and the reason is the CLI failure with its stderr, not the parse or contract error
