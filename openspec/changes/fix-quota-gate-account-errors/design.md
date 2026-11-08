# Design

## Context

See proposal.md, "Why", for the failure.

**How OpenUsage 0.7.16 exits.** Read from the source at tag `v0.7.16` (`Sources/OpenUsageCLI/OpenUsageCLI.swift` and `Sources/OpenUsage/Services/UsageReader.swift` in `robinebers/openusage`). `--help` documents none of this.

| Exit | When | stdout |
| ---- | ---- | ------ |
| 0 | Read succeeded with no warnings | the document |
| 4 | Read succeeded with warnings, one `"<id>: <message>"` per account error, written to stderr | the document, whose `errors` comes from the same `providerErrors` map as the warnings |
| 4 | Fatal: the app's settings domain cannot be opened, or any other thrown error | empty |
| 2 | Usage error or unknown provider | empty |

Account errors appear only when the read refreshes, that is, when a cache entry is missing or stale or `--force` is given. A plain cached read exits 0 with `errors: []`.

**Where the document is lost.** `toExecResult` in `src/exec.ts` turns every non-zero exit into `{ ok: false, error: "openusage failed: <stderr>" }` and drops stdout. `readOpenUsage` returns that failure before it parses anything. The same `Exec` serves bd, gh, linear, claude, chezmoi, wt, git and aoe. Several callers return an exec failure unchanged, for example `claude-print.ts`, `select/compare.ts` and `stages/skills.ts`.

Downstream nothing needs to change. `selectAccount` already counts accounts known only from `errors`. `evaluateAccount` already makes an account with an error `not-evaluable` with its message. The step's reasons come only from the selected account, so other accounts' errors never reach the report.

## Goals / Non-Goals

**Goals:**

- Read the document after a non-zero exit when it explains that exit with an account error, and change nothing else in the gate's decision.
- Call a Claude account an account in the gate's code and report, as the glossary does (D5).
- Leave every other CLI's exec results unchanged, at the type level and at runtime.

**Non-Goals:**

- Interpreting OpenUsage exit codes by number.
- Changing the decision in `select.ts`, `decide.ts` or `step.ts`, or the report beyond the rename in D5.

## Decisions

### D1: the document decides, not the exit code

After a non-zero exit, the gate parses stdout with the same document-wide validator it uses after exit 0. It accepts the document only if validation passes and `errors` has at least one entry. An account error in the document explains the exit. Without one, the exit is unexplained and the gate stays fail-closed. That case cannot happen in 0.7.16, where warnings and `errors` come from the same map, so it can only come from a future OpenUsage.

Alternatives rejected:

- **Accept only exit 4.** It ties the gate to an undocumented number that 0.7.16 already uses for two different things. Exit 4 with empty stdout still has to be rejected, so the number adds nothing.
- **Keep every non-zero exit fatal and drop the errors-only account rule.** One stale login would still block every account.
- **Accept any valid document whatever `errors` holds.** This passes silently on an exit nobody can explain.

### D2: the reasons after a non-zero exit

- **Output empty, not JSON, or failing validation.** The reason is the exec failure as today, `openusage failed: <stderr>`. After a failed CLI, the parse error is a symptom.
- **Valid document with empty `errors`.** The reason is that same exec failure followed by `(exit <code>, no account error in the output)`, so it names both the exit code and stderr.
- **Valid document with at least one account error.** No reason comes from the read. The gate continues as after exit 0, and the decision step supplies the reasons.

### D3: exit output is opt-in in the shared exec

`execCommand` takes an option, `keepOutputOnExit`, and `ExecResult`'s failure branch gains an optional `exit: { code: number; stdout: string }`. `toExecResult` sets `exit` only when the option is on and `error.code` is a number, which is a real exit status. A timeout (`killed`), `ENOENT`, a `maxBuffer` overflow (its `code` is a string and its stdout is truncated) and a kill by signal never carry `exit`. Only `execOpenUsage` turns the option on.

Alternatives rejected:

- **Always attach `exit`.** Callers that pass failures through unchanged would carry stdout along in every failure result. That is invisible in the types and can be large.
- **A separate exec for OpenUsage.** It would duplicate the watchdog for Bun's lost exit notification (oven-sh/bun#41024, #34069).

### D4: tests are built on the real document's shape

A fixture in `test-fixtures.ts` reproduces the DOT-104 observation: exit 4, a `claude` provider that is fresh at 49 % session and 6 % weekly, `claude@12101920` only in `errors` with the Claude Swap message, and the matching `openusage: warning: …` stderr. A fake exec returns it as a failure with `exit`. No live check is planned, because reproducing one means deliberately staling a Claude Swap login.

### D5: accounts are not candidates

The glossary defines a candidate as a work unit, and this change's **Claude account** entry tells readers to avoid the word for an account. The gate still used it: the `Candidate` type in `select.ts`, the `candidates` field of `QuotaGateData`, which the JSON report carries, the `candidates:` label in the text report, and the main spec's "Several accounts, none selected". They become `Account`, `accounts`, `accounts:` and "the account keys". The type is `Account`, not `ClaudeAccount`, because nothing in it is specific to Claude. The field `account`, the selected account's report, keeps its name, so `accounts` sits beside it as the list it was chosen from.

Alternatives rejected:

- **Keep the JSON field `candidates`.** Nothing in the plugin reads it, neither the code nor the command prompt nor the README, so keeping it saves no one. One thing would have two names.
- **Rename in a later change.** The glossary entry ships here, so the conflict would ship with it.

## Risks / Trade-offs

- [A future OpenUsage keeps the warning but drops the matching entry from `errors`] → exit 4 with empty `errors` is `not-evaluable`, with the exit code and stderr in the reason (D1).
- [An `errors` entry names a provider that is not a Claude account] → the document is still accepted. The entry selects no account, and the decision is unchanged.
- [OpenUsage 0.8 moves to `openusage.limits.v2`] → a schema mismatch, `not-evaluable` after any exit code. Supporting v2 is a separate change.
- [A refresh takes longer than the 120 s timeout] → `not-evaluable` by timeout, as today. Two slow reads observed on 2026-11-07 are recorded in `evidence/`. A task follows if it happens in a real run.

## Migration Plan

None. A `fix(autonomous)` patch with no configuration change. The report renames the quota gate's `candidates` to `accounts` (D5), and nothing in the plugin reads that field. To roll back, revert the commits.
