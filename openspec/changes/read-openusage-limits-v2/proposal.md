## Why

OpenUsage 0.8.0 prints `openusage.limits.v2` and no longer prints `openusage.limits.v1`. The quota gate validates only v1, so every run now ends `not-evaluable`:

`openusage output does not match openusage.limits.v1: $.schema is "openusage.limits.v2", expected "openusage.limits.v1"`

The autonomous loop cannot pass its first gate on a machine with the current OpenUsage. Linear DOT-137.

0.8 also changed how the CLI works. It prints what the OpenUsage app last fetched and never refreshes, so `--force` does nothing. Account ids are now `claude@<8 hex digits>`, and a bare `claude` is a provider kind. The document has no `errors` list: an account whose refreshes fail keeps its last values and turns stale. See `evidence/openusage-0.8.0.md`.

## What Changes

- **Read v2 only.** The gate validates the whole output against `openusage.limits.v2`. A v1 document is `not-evaluable`, with a reason that says the gate needs OpenUsage 0.8 or later.
- **`--force` stays, and does nothing.** The run still accepts it, so no invocation breaks, but it is not passed to OpenUsage. Reasons and docs that suggested `--force` now say that OpenUsage refreshes on its own schedule, or that the account can be refreshed in the app.
- **Account errors become staleness.** v2 reports a failing account only by marking it stale. Staleness is per account, so one account's failing refreshes still affect only that account. Accounts are counted only from `providers`; the rule for accounts known only from `errors` goes away.
- **Non-zero exits are not read.** No 0.8 exit carries an account error: exit 2 is a bad argument or no Claude account, and exit 4 is nothing fetched yet. Every non-zero exit is `not-evaluable` with stderr and the exit code.
- **Balances are listed.** A balance resource, such as `rateLimitResets`, is listed with its available amount, not evaluated.
- **Unchanged.** The evaluated windows (`session` and `weekly`), the decision rules, the projection, and account selection with `--account <id>`.
- **Eval.** The hand-run `run-nobody-to-ask` eval's stand-in `openusage` prints v2 with the account `claude@1a2b3c4d`, and its prompt passes that id to `--account`.
- **Docs.** The README records 0.8.0 as the verified version, the account id format, the meaning of `--force`, and how staleness and exits are read. The glossary's **Claude account** and **Account error** follow v2.
- **Release.** A `fix(autonomous):` patch. The configuration is unchanged.

**Out of scope**:

- Supporting OpenUsage 0.7 and v1 alongside v2.
- Telling a stale account that is failing from an app that is not running. v2 does not distinguish them.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `quota-gate`: reads `openusage.limits.v2` from `openusage claude`, never passes `--force`, counts accounts only from `providers`, reads a failing account as stale, and reads no output after a non-zero exit. A v1 document names OpenUsage 0.8 or later. Two requirements are split for length; their rules are unchanged.

## Impact

- `plugins/autonomous/src/quota-gate/`: `parse.ts`, `openusage.ts`, `select.ts`, `decide.ts`, `render.ts`, `step.ts`, their tests and `test-fixtures.ts`.
- `plugins/autonomous/README.md` and `plugins/autonomous/GLOSSARY.md`.
- `plugins/autonomous/evals/run-nobody-to-ask/scaffold.sh` and `prompt.md`.
- The step's JSON data: `account.errors` is gone, and each entry of `otherResources` gains `available`. Nothing in the plugin reads either.
- `openspec/specs/quota-gate/spec.md` on archive.
