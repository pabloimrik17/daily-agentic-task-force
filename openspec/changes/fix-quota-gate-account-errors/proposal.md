## Why

One Claude account with an account error makes the quota gate `not-evaluable` for every account, even when the selected account's data is fresh. OpenUsage exits 4 whenever it reports an account error, yet still prints a valid `openusage.limits.v1` document that names the failing account. The gate discards that document on any non-zero exit. So a stale Claude Swap login on `claude@12101920` blocked `/autonomous:run --account claude` while `claude` was at 49 % session and 6 % weekly (found in the DOT-104 check, 2026-10-02).

The quota-gate spec contradicts itself here. "Read quota from OpenUsage" maps every non-zero exit to `not-evaluable`. "Unambiguous account selection" and "Gate decision" define per-account errors, which can only be read from a document that OpenUsage prints with a non-zero exit. Linear DOT-112, under DOT-82, settles which rule wins.

## What Changes

- **A valid document is read whatever the exit code.** When OpenUsage exits non-zero but its output is a valid `openusage.limits.v1` document with at least one entry in `errors`, the gate reads it, and per-account errors decide as the spec already defines. An account error for another account no longer affects the selected account.
- **Fail closed on unexplained exits.** If OpenUsage exits non-zero with a valid document and no entry in `errors`, the result is `not-evaluable`, and the reason names the exit code and stderr.
- **The CLI failure stays the reason for unusable output.** If OpenUsage exits non-zero and stdout is empty, is not JSON, or does not match the contract, the reason is the CLI failure (`openusage failed: <stderr>`), not the parse error.
- **Unchanged.** A missing CLI, a timeout, a `maxBuffer` overflow and output that fails validation after exit 0 are still `not-evaluable` as today. Validation still covers the whole document.
- **The report stays about one account.** Other accounts' errors, stderr and the exit code do not appear in the report when the selected account is fine.
- **Docs.** The plugin README records OpenUsage 0.7.16 as the verified version and describes how a non-zero exit is read. The glossary's **Quota** section (Claude account, Account error), written during the DOT-112 grill, ships with this change.
- **Release.** A `fix(autonomous):` patch. The configuration and the run report format are unchanged.

**Out of scope**:

- Slow OpenUsage reads. One cached read took more than 120 s and another 55 s, because OpenUsage refreshes when an account's cache is missing or stale. This is recorded as evidence only. A task follows if it trips the timeout in a real run.
- OpenUsage 0.8 and `openusage.limits.v2`. Until the gate supports it, a v2 document is a schema mismatch and the gate stays fail-closed.
- Mentioning other accounts' errors in the report.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `quota-gate`: "Read quota from OpenUsage" reads a valid document after a non-zero exit when it carries an account error. A non-zero exit stays `not-evaluable` when the output is unusable or has no account error.

## Impact

- `plugins/autonomous/src/exec.ts`: an opt-in mode in which a non-zero exit also carries the exit code and stdout. Other CLIs (bd, gh, linear, claude, chezmoi, wt, git, aoe) do not opt in and are unaffected.
- `plugins/autonomous/src/quota-gate/openusage.ts`: `readOpenUsage` and `execOpenUsage`.
- Tests: `src/exec.test.ts`, `src/quota-gate/openusage.test.ts`, `src/quota-gate/step.test.ts` and a fixture shaped like the real exit-4 document in `src/quota-gate/test-fixtures.ts`.
- `plugins/autonomous/README.md` and `plugins/autonomous/GLOSSARY.md`.
- `openspec/specs/quota-gate/spec.md` on archive.
