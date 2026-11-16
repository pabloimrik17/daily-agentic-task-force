# quota-gate Specification

## Purpose

Decides whether the autonomous loop may spend Claude quota now, from OpenUsage data for the active account, the one Claude Code is logged in as, and explains the decision with values that can be checked by hand.

## Requirements

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

### Requirement: Evaluated windows

The gate SHALL evaluate the `session` and `weekly` resources of the selected account, reporting for each its used amount, limit, reset time and window duration. Any other resource SHALL be listed with its current usage, or with its available amount when it is a balance, and marked as not evaluated.

#### Scenario: Extra resource

- **WHEN** the account also reports a well-formed `fable` resource
- **THEN** it appears in the report as not evaluated and does not affect the outcome

#### Scenario: Balance resource

- **WHEN** the account also reports a `rateLimitResets` balance with 2 available
- **THEN** it appears in the report with 2 available, as not evaluated, and does not affect the outcome

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

- **WHEN** OpenUsage exits 0, its document marks the account of `luis@example.com` stale, and the active account `ana@example.com` has windows that are complete, valid, fresh and below their limits
- **THEN** the outcome is `advance`, and no reason mentions the account of `luis@example.com` or staleness

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

### Requirement: Account selection

The gate SHALL count as a Claude account every provider whose key is `claude` or starts with `claude@`. The outcome SHALL come from the active account and from no other. The gate MAY evaluate another account only to report it (see "Other accounts with capacity are reported"). It SHALL NOT aggregate accounts, decide from another account in place of the active one, or switch the active account.

#### Scenario: Several accounts

- **WHEN** OpenUsage reports three Claude accounts and Claude Code is logged in as `ana@example.com`
- **THEN** the account with the email address `ana@example.com` is evaluated

#### Scenario: Single account

- **WHEN** OpenUsage reports one Claude account, with the email address `ana@example.com`, and Claude Code is logged in as `ana@example.com`
- **THEN** that account is evaluated

#### Scenario: Single account that is not the active one

- **WHEN** OpenUsage reports one Claude account, with the email address `luis@example.com`, and Claude Code is logged in as `ana@example.com`
- **THEN** the outcome is `not-evaluable`, and the account of `luis@example.com` is not evaluated

#### Scenario: Active account exhausted while another has capacity

- **WHEN** the active account has an exhausted weekly window and another Claude account has capacity
- **THEN** the outcome is `wait` for the active account

#### Scenario: Active account not reported by OpenUsage

- **WHEN** no Claude account in the OpenUsage document has the email address of the active account
- **THEN** the outcome is `not-evaluable`, the reason names that email address, and the Claude accounts are listed with their email addresses

#### Scenario: Account not fetched yet

- **WHEN** OpenUsage has not fetched an account yet, so its document has no entry for it
- **THEN** that account is not counted as a Claude account

#### Scenario: No Claude account

- **WHEN** OpenUsage exits 0 with a document that has no Claude account, and Claude Code is logged in
- **THEN** the outcome is `not-evaluable` and the reason says no Claude account was reported

### Requirement: Active account from Claude Code

The gate SHALL read the active account by running `claude auth status`, and SHALL take the email address of the login it reports. It SHALL read the output of an exit code of 0 or 1. A missing CLI, a timeout, another exit code, output that is not the expected JSON, a report of no login, or a login with no email address SHALL produce `not-evaluable` with the reason.

#### Scenario: Logged in

- **WHEN** `claude auth status` exits 0 and reports a login with the email address `ana@example.com`
- **THEN** the active account is `ana@example.com`

#### Scenario: No login

- **WHEN** `claude auth status` exits 1 and reports that nobody is logged in
- **THEN** the outcome is `not-evaluable` and the reason says Claude Code has no login

#### Scenario: Login with no email address

- **WHEN** `claude auth status` reports a login that carries no email address, such as an API key
- **THEN** the outcome is `not-evaluable` and the reason says the login has no email address to match

#### Scenario: CLI unavailable

- **WHEN** `claude` cannot be executed
- **THEN** the outcome is `not-evaluable` and the reason names the failure

#### Scenario: Exit 1 with no answer

- **WHEN** `claude auth status` exits 1 and prints nothing, or text that is not the expected JSON
- **THEN** the outcome is `not-evaluable` and the reason is the CLI failure with its exit code, not a parse error

#### Scenario: Unexpected output

- **WHEN** `claude auth status` exits 0 and prints text that is not JSON
- **THEN** the outcome is `not-evaluable` and the reason says the output could not be read

### Requirement: Accounts matched by email address

The gate SHALL identify a Claude account by its email address, which is the text after the last `·` separator of the account's OpenUsage display name. It SHALL compare email addresses without regard to letter case. An account whose display name carries no email address SHALL never match. When more than one account has the email address of the active account, the outcome SHALL be `not-evaluable`, and the reason SHALL list those accounts.

#### Scenario: Display name with an email address

- **WHEN** an account has the display name `Claude · ana@example.com`
- **THEN** its email address is `ana@example.com`

#### Scenario: Different letter case

- **WHEN** the active account is `Ana@Example.com` and an account has the display name `Claude · ana@example.com`
- **THEN** that account is evaluated

#### Scenario: Two accounts with the same email address

- **WHEN** two Claude accounts have the display name `Claude · ana@example.com` and the active account is `ana@example.com`
- **THEN** the outcome is `not-evaluable` and the reason lists both account ids

#### Scenario: Display name without an email address

- **WHEN** the only Claude account has the display name `Claude`
- **THEN** no email address matches it, and the outcome is `not-evaluable`

### Requirement: Report of the evaluated account

The gate report SHALL show the email address of the evaluated account. The JSON report SHALL carry it as a field of the account, beside the fields it already has. When the active account could not be read or matched, the report SHALL carry no evaluated account.

#### Scenario: Text report

- **WHEN** the gate evaluates `ana@example.com`
- **THEN** the text report shows `ana@example.com` on the account line

#### Scenario: JSON report

- **WHEN** the gate evaluates `ana@example.com` and the run prints JSON
- **THEN** the account in the `quota-gate` data has the email address `ana@example.com`

#### Scenario: Active account that could not be read

- **WHEN** `claude auth status` reports no login
- **THEN** the report carries no evaluated account, and the reason says why

### Requirement: Other accounts with capacity are reported

When the outcome is `wait`, the report SHALL list every other Claude account whose own data would give `advance`, by email address, or by OpenUsage account id when it has none, and SHALL say that Claude Code is not logged in as any of them. The list SHALL be information only: it SHALL NOT change the outcome, and the run SHALL NOT use those accounts. With any other outcome, or when no other account would advance, the report SHALL carry no such list.

#### Scenario: Active account exhausted, another has capacity

- **WHEN** the active account `ana@example.com` has an exhausted session window, and the account `luis@example.com` has fresh, complete windows below their limits
- **THEN** the outcome is `wait`, and the report lists `luis@example.com` as an account with capacity that Claude Code is not logged in as

#### Scenario: Account with capacity and no email address

- **WHEN** the active account is exhausted, and the account `claude@9f8e7d6c`, with the display name `Claude`, has fresh, complete windows below their limits
- **THEN** the outcome is `wait`, and the report lists `claude@9f8e7d6c` as an account with capacity

#### Scenario: Every account exhausted

- **WHEN** the active account is exhausted and every other Claude account is exhausted or stale
- **THEN** the outcome is `wait` and the report lists no other account

#### Scenario: Gate advances

- **WHEN** the active account has capacity
- **THEN** the report lists no other account
