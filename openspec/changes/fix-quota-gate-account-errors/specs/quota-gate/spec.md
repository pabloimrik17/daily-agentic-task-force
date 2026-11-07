# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
