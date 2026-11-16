# Spec Delta

## REMOVED Requirements

### Requirement: Unambiguous account selection

**Reason**: The user no longer names an account. The gate evaluates the active account, and it identifies accounts by email address, not by the OpenUsage account id. "Account selection" replaces this requirement.

**Migration**: Drop `--account`. To evaluate another account, switch the Claude Code login to it before the run.

## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Account selection

The gate SHALL count as a Claude account every provider whose key is `claude` or starts with `claude@`. It SHALL evaluate the active account and no other. It SHALL NOT aggregate accounts, evaluate another account in place of the active one, or switch the active account.

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

- **WHEN** OpenUsage exits 0 with a document that has no Claude account
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

When the outcome is `wait`, the report SHALL list every other Claude account whose own data would give `advance`, by email address, and SHALL say that Claude Code is not logged in as any of them. The list SHALL be information only: it SHALL NOT change the outcome, and the run SHALL NOT use those accounts. With any other outcome, or when no other account would advance, the report SHALL carry no such list.

#### Scenario: Active account exhausted, another has capacity

- **WHEN** the active account `ana@example.com` has an exhausted session window, and the account `luis@example.com` has fresh, complete windows below their limits
- **THEN** the outcome is `wait`, and the report lists `luis@example.com` as an account with capacity that Claude Code is not logged in as

#### Scenario: Every account exhausted

- **WHEN** the active account is exhausted and every other Claude account is exhausted or stale
- **THEN** the outcome is `wait` and the report lists no other account

#### Scenario: Gate advances

- **WHEN** the active account has capacity
- **THEN** the report lists no other account
