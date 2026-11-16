# Design

## Context

See proposal.md, "Why", for the motivation, and ADR 0006 (`plugins/autonomous/docs/adr/0006-the-run-follows-the-active-account.md`) for the decision that the run follows the active account and for the options that were rejected.

**What the gate does today.** `src/quota-gate/step.ts` runs `openusage claude` through `ctx.io.openUsage`, validates `openusage.limits.v2`, and calls `selectAccount(limits, ctx.args.account)` in `select.ts`. The selection compares `--account` with the provider keys (`claude@<8 hex digits>`). With no `--account` it takes the only Claude account, and it fails as ambiguous when there are several. `decide.ts` then evaluates the `session` and `weekly` windows of that provider. Nothing else in the plugin reads the account: the sessions are launched with no account, on the Claude Code login.

**What Claude Code reports.** Observed on Claude Code 2.1.325, `claude auth status` prints JSON by default:

| State     | Exit | Fields the gate reads                                                    |
| --------- | ---- | ------------------------------------------------------------------------ |
| Logged in | 0    | `loggedIn: true`, `email`                                                |
| No login  | 1    | `loggedIn: false`, no `email` (probed with an empty `CLAUDE_CONFIG_DIR`) |

`CLAUDE_CONFIG_DIR` selects the login that is reported, so the command answers for the environment it runs in.

**What OpenUsage reports.** A provider has no email field. Its `displayName` is `Claude · <email>` for every account observed on this machine. The provider key is a hash that no other tool knows.

**The loop.** An iteration runs the steps of a run, so the gate already runs once per iteration and holds no state between iterations.

## Goals / Non-Goals

**Goals:**

- Evaluate the active account with no flag, on a machine with one account or with several.
- Keep the decision, the windows, the projection and the OpenUsage read as they are.
- Put the OpenUsage read behind a contract that names no tool, so that another quota source can replace it.

**Non-Goals:**

- Naming an account for a run, or keeping a launched session on an account (ADR 0006).
- Any use of an account switcher. The run needs none.
- A second quota source, or a configuration key that chooses one.
- Reading the quota that an account switcher keeps. On 2026-11-16 it was 45 minutes old for the active account when OpenUsage's was 1 minute old.

## Decisions

### D1: The active account comes from `claude auth status`

A new module, `src/quota-gate/login.ts`, runs `claude auth status` through an injected `Exec` (`ctx.io.login`, built in `src/run.ts` with `CLI_TIMEOUT_MS` and `keepOutputOnExit`). It returns the email address or a reason. It reads the output of exits 0 and 1, because exit 1 with `loggedIn: false` is the answer for "no login" and deserves its own reason. Any other exit is a CLI failure.

It validates only `loggedIn` (a boolean) and, when logged in, `email` (a non-empty string). The other fields are ignored, so a new field in a later Claude Code release does not block the gate.

Alternatives:

- Read `~/.claude.json` (`oauthAccount.emailAddress`). Rejected: it is a private file whose shape is not a contract, and it ignores `CLAUDE_CONFIG_DIR` unless the gate repeats Claude Code's own lookup.
- Ask the account switcher for its active account. Rejected in ADR 0006: every run would need a switcher.

### D2: The gate reads the quota first, then the login

`step.ts` reads the quota source, then the login, then selects. When the quota read fails, the login is not read. When the login read fails, the report still lists the accounts the quota source returned, so the user sees what the machine has.

### D3: The email address is the account's identity

The email address is the only value that Claude Code and OpenUsage share. The gate matches on it and reports it, and each tool's own id stays inside that tool's module.

The email address of an OpenUsage account is the text after the last `·` of `displayName`, trimmed, and it counts only when it contains `@`. Comparison lowercases both sides. An account with no email address in its display name can be listed but never matched.

Two accounts with the email address of the active account give `not-evaluable`. This can happen when one email address belongs to two organizations. The gate cannot tell which one the login uses, and choosing one would be a guess.

### D4: A quota source contract in front of OpenUsage

`src/quota-gate/source.ts` defines the contract:

- `QuotaAccount`: `id` (the source's own id), `email` (or `null`), `displayName`, `plan`, `fetchedAt`, `expiresAt`, `stale`, and `resources`.
- `QuotaSource`: one `read()` that returns every Claude account or a reason.

`openusage.ts` implements it: it runs the CLI, validates the document, keeps the Claude providers, and derives `email` (D3). `parse.ts` stays the OpenUsage validator. `select.ts`, `decide.ts`, `step.ts` and `render.ts` import the contract types instead of `OpenUsageProvider`. `ctx.io.openUsage: Exec` becomes `ctx.io.quota: QuotaSource`, built in `src/run.ts`.

The resource shape (`used`, `limit`, `resetsAt`, `windowSeconds`, `available`, `unit`) is already what the decision reads, so the contract adopts it unchanged. The window names `session` and `weekly` become part of the contract.

There is no configuration key and no second implementation. The contract is the seam; a key is added when a second source exists, as ADR 0003 does for the other optional blocks.

### D5: Selection has one rule

`selectAccount(accounts, email)` takes the email address of the active account:

1. no Claude account → "the quota source reported no Claude account";
2. no match → "the active account `<email>` is not reported", with the accounts listed;
3. more than one match → the reason lists their ids;
4. one match → that account.

The ambiguity branch, the unknown-account branch and the "only account" branch are deleted. A machine with one account now also goes through the login read. This is deliberate: one rule, and the gate never evaluates an account that Claude Code is not logged in as.

### D6: The report gains the email address

`AccountReport` gains `email`. The text report shows it first on the account line:

```text
  account   ana@example.com — claude@1a2b3c4d · Claude · ana@example.com · Pro
```

`key` stays as it is: it is the quota source's id and is still useful to find the account in OpenUsage. The JSON document keeps the name `autonomous.run.v2`, because fields are only added. The `accounts` list of a failed selection gains `email`.

### D7: `--account` is removed, with its own message

`RunArgs.account`, `readAccount` and the usage lines of `--account` are deleted from `src/args.ts`. The flag keeps an entry in the reader table that always fails with:

```text
--account is no longer accepted: the run evaluates the account Claude Code is logged in as
```

A generic "unrecognised argument" would leave a user of the old flag with no reason. `accountOrForce` becomes a check of `--force` alone, and the combination messages lose `--account`.

### D8: A `wait` names the accounts that have capacity

When the outcome is `wait`, `step.ts` runs `evaluateAccount` on every other account the quota source returned and keeps those whose outcome is `advance`. They go in a new data field, `accountsWithCapacity` (email address and source id), and the text report adds:

```text
  capacity elsewhere (Claude Code is not logged in as these):
    - luis@example.com
```

The quota source already returns every account, so this costs no extra call. It makes a late switch of the login visible (see the risk below) without the run acting on it, which ADR 0006 forbids.

## Risks / Trade-offs

- [OpenUsage changes the display name and drops the email address] → no account matches, and the gate is `not-evaluable` with the accounts listed. It never evaluates a wrong account. The evidence file records the format that was observed.
- [`claude auth status` changes its output in a later Claude Code release] → the gate reads two fields and reports a reason that names the missing one. The evidence file records the version.
- [The login changes between the gate and the launch] → accepted in ADR 0006. The gate stops only at an exhausted window.
- [The login is switched late] → observed on 2026-11-16: the account switcher got HTTP 429 from the usage endpoint for the active account and backed off for 3600 s, so its data for that account was 82 minutes old. The switcher keeps trusting a rate-limited reading for up to 7200 s. In that time the active account can reach an exhausted window with no switch. The gate then gives `wait` while another account has capacity. The run loses time and launches nothing wrong. D8 makes the case visible in the report. The remedy belongs to the switcher's setup, not to the run, and is tracked in Beads as `agentic-task-tu1l`.
- [The run is started in an environment whose `CLAUDE_CONFIG_DIR` points at another profile] → the gate evaluates that profile's login, which is the login of that environment. The session manager may launch sessions in a different environment. Not handled: the plugin sets `CLAUDE_CONFIG_DIR` nowhere.
- [A machine with one account gains a dependency on `claude auth status`] → `claude` is already required to launch a session, so no new tool is needed.
- [A script passes `--account`] → usage error with exit 1 and the message of D7. The README records the removal.
- [The user wants a run on a given account] → they switch the login first. ADR 0006 records when a named account can return.

## Migration Plan

No data is migrated. The `run-nobody-to-ask` eval and the README examples drop `--account` in the same change. Rollback is a revert of the change.
