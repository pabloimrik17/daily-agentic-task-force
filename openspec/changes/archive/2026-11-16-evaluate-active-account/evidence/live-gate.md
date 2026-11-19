# Live quota gate evidence

Evidence for `evaluate-active-account`, tasks 5.2 and 5.3. Runs on 2026-11-16 on
a machine with three Claude accounts in OpenUsage 0.8.0, with Claude Code
2.1.325. Email addresses are redacted with the mapping of
`openusage-display-name.md`: `ana@example.com` is the account of the Claude
Code login. No run used `--apply`.

## Dry run on the active account (5.2)

`claude auth status` exits 0 and reports the login `ana@example.com`.
`openusage claude` reports three accounts: `claude@9725f35a`
(`ana@example.com`), `claude@ec02e918` and `claude@f33dd56e`.

Command: `bun plugins/autonomous/src/run.ts`, with no flag. It exits 2: the run
outcome is `wait`, from the `launch` step, which found no repository for the
selected task. The `quota-gate` step advances. Its part of the report:

```text
[quota-gate] advance (code)
  account   ana@example.com — claude@9725f35a · Claude · ana@example.com · Pro
  fetched   2026-11-16T17:49:41.000Z
  session   54% / 100%  window 5h  resets 2026-11-16T19:20:00.000Z  projected 76.8%
  weekly    49% / 100%  window 7d  resets 2026-11-21T21:00:00.000Z  projected 183.6%
  fable     80% / 100%  not evaluated
  rateLimitResets 2 resets available  not evaluated
  reasons:
    - session window has capacity: 54/100 percent, resets at 2026-11-16T19:20:00.000Z
    - weekly window has capacity: 49/100 percent, resets at 2026-11-21T21:00:00.000Z
```

- The gate evaluates `claude@9725f35a`, the account whose email address is the
  login's, with no flag and with three accounts present.
- The account line starts with the email address (design D6).
- The outcome is `advance`, so the report carries no "capacity elsewhere" list
  (design D8).

## The removed flag (5.2)

Command: `bun plugins/autonomous/src/run.ts --account ana@example.com`. It
exits 1, runs no step, and prints the message of design D7 before the usage
text:

```text
--account is no longer accepted: the run evaluates the account Claude Code is logged in as
Usage: /autonomous:run [--force] [--json] [--apply] [--no-handoff]
       /autonomous:run --bootstrap-labels [--json]
       ...
```

## Dry run after a switch of the login (5.3)

The user switched the Claude Code login to another of the three accounts at
18:57 local time. Nothing else changed: no flag, no configuration, the same
three accounts in OpenUsage. `claude auth status` then exits 0 and reports the
login `eva@example.com`.

Command: `bun plugins/autonomous/src/run.ts`, with no flag. It exits 2 for the
same reason as before, the `launch` step. The `quota-gate` step advances:

```text
[quota-gate] advance (code)
  account   eva@example.com — claude@f33dd56e · Claude · eva@example.com · Team 5x
  fetched   2026-11-16T17:54:44.000Z
  session   9% / 100%  window 5h  resets 2026-11-16T19:00:00.000Z  projected 11.3%
  weekly    81% / 100%  window 7d  resets 2026-11-18T11:00:00.000Z  projected 107.2%
  fable     31% / 100%  not evaluated
  rateLimitResets 4 resets available  not evaluated
  reasons:
    - session window has capacity: 9/100 percent, resets at 2026-11-16T19:00:00.000Z
    - weekly window has capacity: 81/100 percent, resets at 2026-11-18T11:00:00.000Z
```

- The gate now evaluates `claude@f33dd56e`, the account of `eva@example.com`,
  where the run before the switch evaluated `claude@9725f35a`.
- The windows and the plan are those of the new account, so the gate read the
  quota of the account it names.
- The run did not choose the account: it followed the login.
