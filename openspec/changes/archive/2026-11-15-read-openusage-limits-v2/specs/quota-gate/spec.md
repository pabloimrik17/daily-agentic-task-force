# Spec Delta

## MODIFIED Requirements

### Requirement: Read quota from OpenUsage

The gate SHALL obtain quota by running `openusage claude`, which prints what the OpenUsage app last fetched for every Claude account, and SHALL NOT pass the run's `--force` to it. It SHALL validate the whole output against the `openusage.limits.v2` contract. A missing CLI, a timeout (120 s), unparseable output or a schema mismatch SHALL produce `not-evaluable` with the reason, and a contract violation SHALL name the offending path. A non-zero exit SHALL be handled as "Read output after a non-zero exit" defines.

#### Scenario: CLI unavailable

- **WHEN** `openusage` cannot be executed
- **THEN** the outcome is `not-evaluable` and the reason names the failure

#### Scenario: Forced refresh

- **WHEN** the run is invoked with `--force`
- **THEN** OpenUsage is run as without it, with no `--force`, because OpenUsage 0.8 never refreshes from the CLI

#### Scenario: Malformed data outside the evaluated windows

- **WHEN** OpenUsage exits 0 and a resource or account the gate does not evaluate violates the `openusage.limits.v2` contract
- **THEN** the outcome is `not-evaluable` and the reason names the offending path

### Requirement: Unambiguous account selection

The gate SHALL consider every provider whose key starts with `claude@`, or is `claude`, as a Claude account. An account that OpenUsage has not fetched yet is absent from the document and SHALL NOT be counted. With `--account <key>` the gate SHALL use exactly that account. Without it, it SHALL use the only Claude account when there is exactly one. It SHALL NOT aggregate accounts or switch the active account.

#### Scenario: Several accounts, none selected

- **WHEN** two Claude accounts are present and `--account` is absent
- **THEN** the outcome is `not-evaluable`, the reason is an ambiguous account, and the account keys and display names are listed

#### Scenario: Unknown account

- **WHEN** `--account` names a key that is not present
- **THEN** the outcome is `not-evaluable` and the available keys are listed

#### Scenario: Provider kind given as the account

- **WHEN** `--account claude` is given and the only Claude account is `claude@1a2b3c4d`
- **THEN** the outcome is `not-evaluable`, the reason is an unknown account, and `claude@1a2b3c4d` is listed

#### Scenario: Single account

- **WHEN** exactly one Claude account is present and `--account` is absent
- **THEN** that account is evaluated

#### Scenario: No Claude account

- **WHEN** OpenUsage exits 0 with a document that has no Claude account, and `--account` is absent
- **THEN** the outcome is `not-evaluable` and the reason says no Claude account was reported

### Requirement: Evaluated windows

The gate SHALL evaluate the `session` and `weekly` resources of the selected account, reporting for each its used amount, limit, reset time and window duration. Any other resource SHALL be listed with its current usage, or with its available amount when it is a balance, and marked as not evaluated.

#### Scenario: Extra resource

- **WHEN** the account also reports a well-formed `fable` resource
- **THEN** it appears in the report as not evaluated and does not affect the outcome

#### Scenario: Balance resource

- **WHEN** the account also reports a `rateLimitResets` balance with 2 available
- **THEN** it appears in the report with 2 available, as not evaluated, and does not affect the outcome

### Requirement: Gate decision

The gate outcome SHALL be:

1. `wait` when any evaluated window with complete, valid, fresh data has `used ≥ limit` and its `resetsAt` is still after `now`, where data is fresh when the account is not stale;
2. otherwise `not-evaluable` when the account is stale, a required window is missing, incomplete or invalid, or a window has `used ≥ limit` with its `resetsAt` at or before `now`, because that exhaustion predates a reset that has already happened;
3. otherwise `advance`.

#### Scenario: Exhausted window

- **WHEN** the weekly window reports 100 used of 100, with its reset still ahead
- **THEN** the outcome is `wait` and the reason names the weekly window and its reset time

#### Scenario: Exhausted beats missing data

- **WHEN** the session window is exhausted and the weekly window is missing
- **THEN** the outcome is `wait`, and the missing weekly window is still reported

#### Scenario: Exhausted window with an OpenUsage error

- **WHEN** a window is exhausted and OpenUsage marks the account stale because its refreshes of that account fail
- **THEN** the outcome is `not-evaluable` and the reason says the data is stale, that OpenUsage is not running or its refreshes of that account are failing

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
- **THEN** the outcome is `not-evaluable`, never `wait`, and the reason says the weekly window's reset time has passed, that OpenUsage refreshes on its own schedule, and that the account can be refreshed in the OpenUsage app

### Requirement: Read output after a non-zero exit

When OpenUsage exits with a non-zero code, the gate SHALL NOT read its output, and the outcome SHALL be `not-evaluable` with the CLI failure, its stderr and the exit code as the reason. OpenUsage 0.8 reports an account whose refreshes fail as stale, never through its exit code, so an account error affects only the account it names.

#### Scenario: Account error for another account

- **WHEN** OpenUsage exits 0, its document marks `claude@b` stale, and `--account claude@a` selects an account whose windows are complete, valid, fresh and below their limits
- **THEN** the outcome is `advance`, and no reason mentions `claude@b` or staleness

#### Scenario: Account error for the selected account

- **WHEN** OpenUsage exits 0 and its document marks the selected account stale because its refreshes fail
- **THEN** the outcome is `not-evaluable` and the reason says that account's data is stale

#### Scenario: Non-zero exit without an account error

- **WHEN** OpenUsage exits 4 because nothing has been fetched yet, and prints a valid document
- **THEN** the outcome is `not-evaluable`, the document is not read, and the reason names the exit code and stderr

#### Scenario: Non-zero exit with unusable output

- **WHEN** OpenUsage exits non-zero and its output is empty, is not JSON, or violates the `openusage.limits.v2` contract
- **THEN** the outcome is `not-evaluable` and the reason is the CLI failure with its stderr and exit code, not the parse or contract error

#### Scenario: No Claude account set up

- **WHEN** OpenUsage exits 2 because no Claude account is set up in it
- **THEN** the outcome is `not-evaluable` and the reason carries its stderr and exit 2

## ADDED Requirements

### Requirement: Output of an older OpenUsage

When the output's `schema` is `openusage.limits.v1`, which OpenUsage 0.7 prints, the gate SHALL produce `not-evaluable` with a reason that says the gate needs OpenUsage 0.8 or later.

#### Scenario: OpenUsage 0.7 output

- **WHEN** OpenUsage exits 0 and prints an `openusage.limits.v1` document
- **THEN** the outcome is `not-evaluable` and the reason names OpenUsage 0.8 or later

### Requirement: Values reported without a decision

Projected usage SHALL be reported but SHALL NOT affect the outcome. Missing or stale data SHALL never be treated as zero usage or available capacity, and valid values SHALL still be reported alongside a `not-evaluable` outcome of "Gate decision"; output that fails validation reports no values (see "Read quota from OpenUsage").

#### Scenario: Valid window beside an incomplete one

- **WHEN** the weekly window has no `resetsAt` and the session window is complete and valid
- **THEN** the outcome is `not-evaluable` and the session window's values and projection are still reported

#### Scenario: Missing window is not capacity

- **WHEN** the weekly window is missing and the session window has capacity
- **THEN** the outcome is `not-evaluable`, never `advance`, and the weekly window is reported as missing with no values

### Requirement: Incomplete and invalid windows

A window SHALL be incomplete when its resource is present but lacks `used`, `limit`, `resetsAt` or `windowSeconds`. A window SHALL be invalid when its `used` is negative or its `limit` or `windowSeconds` is not positive.

#### Scenario: Window without its duration

- **WHEN** the session resource is present with no `windowSeconds`
- **THEN** the session window is incomplete and the reason names `windowSeconds`

#### Scenario: Window with a non-positive limit

- **WHEN** the session resource reports a `limit` of 0
- **THEN** the session window is invalid and the reason names `limit = 0`
