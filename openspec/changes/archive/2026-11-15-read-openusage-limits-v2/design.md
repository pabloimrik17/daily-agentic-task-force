# Design

## Context

See proposal.md, "Why", for the failure, and `evidence/openusage-0.8.0.md` for the v2 contract with its sources.

**What OpenUsage 0.8.0 prints.** `openusage [provider]` prints what the app last fetched, as `openusage.limits.v2`, and never refreshes. `openusage claude` selects every Claude account.

| Exit | When                                                   | stdout                        |
| ---- | ------------------------------------------------------ | ----------------------------- |
| 0    | At least one named account has data                    | the document                  |
| 4    | Nothing fetched yet for the named accounts             | the envelope with no provider |
| 4    | The settings domain cannot be opened, or another error | empty                         |
| 2    | Bad arguments, or a provider that names no account     | empty                         |

The document has `schema`, `generatedAt` and `providers`, and no `errors`. A provider is keyed by its account id, `claude@<8 hex digits>`. An account with no data has no entry. `stale` becomes true 10 minutes after `fetchedAt`. A failed refresh keeps the last values, so the account turns stale once they expire.

**What the gate did with v1.** It ran `openusage claude`, or `openusage claude --force`, and validated v1. It counted accounts from `providers` and from `errors`, read the document after a non-zero exit when `errors` explained it, and made an account with an error `not-evaluable`.

## Goals / Non-Goals

**Goals:**

- Read v2 with the same document-wide strictness as v1.
- Keep the decision, the windows, the projection and the selection as they are, mapped onto v2's fields.
- Keep `--force` a valid run flag.

**Non-Goals:**

- Reading v1 as well.
- Interpreting exit codes beyond naming them in the reason.

## Decisions

### D1: v2 only, and v1 names the version it needs

The validator accepts only `openusage.limits.v2`. A v1 document fails with `$.schema is "openusage.limits.v1", which OpenUsage 0.7 prints; the quota gate needs OpenUsage 0.8 or later`. Any other schema keeps the generic mismatch reason.

v2 fields are validated wherever they appear, including resources the gate does not evaluate: `remaining`, `utilization` and `available` must be finite numbers, and a balance's `expiresAt` must be a list of RFC 3339 instants. The gate keeps only what it reads. `kind` stays a free string, as in v1: the gate picks windows by key, not by kind, and a new kind in a later 0.8 release should not block every run.

Alternative rejected:

- **Read v1 and v2.** Two contracts to keep strict, for an OpenUsage version the CLI itself now replaces on update.

### D2: no output is read after a non-zero exit

In 0.8 no exit code reports an account error. Exit 4 with a document means no Claude account has data yet, and its document lists none. So the gate no longer reads output after a non-zero exit. The reason is the CLI failure followed by the exit code: `openusage failed: <stderr> (exit <code>)`. `execOpenUsage` keeps `keepOutputOnExit` only to learn the exit code.

Alternatives rejected:

- **Read the exit-4 envelope.** It would give "no Claude account" or "unknown account", which hides OpenUsage's own message, "nothing fetched yet; open OpenUsage and add or refresh an account".
- **Map exit 2 to "no Claude account".** It ties the reason to a number that also means bad arguments. stderr already says `Unknown provider: claude`.

A v1 document printed with a non-zero exit, as 0.7 did on an account warning, therefore gets the CLI failure as its reason, not the D1 message. 0.7 exited 0 on a cached read, so most 0.7 runs still get D1.

### D3: an account error is a stale account

v2 has no `errors`. The app keeps a failing account's last values and marks them stale 10 minutes after the last good fetch. The gate already treats a stale account as `not-evaluable`, and only the selected account's staleness matters. So "an account error affects only the account it names" holds with no new rule. The stale reason now gives both causes v2 allows: `data is stale: fetched at <t>, expired at <t>; OpenUsage is not running or its refreshes of <id> are failing`.

`AccountReport.errors`, the "no data" reason and the selection of accounts known only from `errors` go away. An account OpenUsage has not fetched has no entry, so `--account` naming it is an unknown account.

Trade-off: for up to 10 minutes after the last good fetch, a failing account still looks fresh. v1 reported the error at once, but only on a read that refreshed.

### D4: `--force` is accepted and ignored

The run keeps `--force`, so `/autonomous:run --force` and every combination the argument parser checks keep working. The quota gate always runs `openusage claude`. The outdated-window reason says `OpenUsage refreshes on its own schedule, or refresh the account in its app` instead of `refresh with --force`.

Alternative rejected:

- **Remove `--force`.** A breaking change for any script that passes it, for no gain.

### D5: account keys

0.8 keys every account `<kind>@<8 hex digits>`. The gate still accepts a bare `claude` key as a Claude account, because a document never carries one and accepting it costs nothing. `--account claude` is therefore an unknown account, and the reason lists the real ids. Test fixtures use `claude@1a2b3c4d`.

### D6: balances in the report

A resource with no `used` and an `available` is listed as `<available> <unit> available`, not evaluated. Each entry of the step's `otherResources` gains `available`.

### D7: requirements split for length

"Gate decision" ran past 500 characters. Its rules stay; the reporting rules and the incomplete and invalid definitions move to two added requirements, "Values reported without a decision" and "Incomplete and invalid windows". The v1 rule is its own added requirement, "Output of an older OpenUsage".

## Risks / Trade-offs

- [A failing account looks fresh for up to 10 minutes] → accepted; v2 offers nothing sooner (D3).
- [A later 0.8 release adds a field] → ignored, as in v1. A changed type fails closed.
- [OpenUsage fails to encode and prints the fallback with no `generatedAt`] → a contract violation, `not-evaluable`; that fallback has no provider anyway.
- [Scripts pass `--account claude`] → an unknown account that lists the real ids. The README's examples now use `claude@1a2b3c4d`.

## Migration Plan

Update OpenUsage to 0.8.0 or later. Replace `--account claude` with the account id that `/autonomous:run` lists. No configuration change. To roll back, revert the commits and downgrade OpenUsage to 0.7.
