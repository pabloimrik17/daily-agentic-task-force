# OpenUsage display-name evidence

Evidence for `evaluate-active-account`, design D3. Probes on 2026-11-16,
read-only. `openusage --version` prints `openusage 0.8.0`. `openusage claude`
exits 0, prints an `openusage.limits.v2` document on stdout, and prints nothing
on stderr.

Email addresses are redacted and replaced consistently: `ana@example.com` is
the first account, `luis@example.com` the second and `eva@example.com` the
third.

## Claude accounts

Three providers have a key that starts with `claude@`.

| Key               | `displayName`               | Plan      |
| ----------------- | --------------------------- | --------- |
| `claude@9725f35a` | `Claude · ana@example.com`  | `Pro`     |
| `claude@ec02e918` | `Claude · luis@example.com` | `Pro`     |
| `claude@f33dd56e` | `Claude · eva@example.com`  | `Team 5x` |

## Exact form

- The separator is U+00B7 (middle dot). It is the only non-ASCII character in
  each display name, and each name holds exactly one.
- One space sits on each side of the separator.
- Each name starts with the word `Claude` and has no leading or trailing
  whitespace.
- All three email addresses are lowercase. None has an uppercase letter.
- A provider object has the keys `displayName`, `expiresAt`, `fetchedAt`,
  `plan`, `resources` and `stale`. There is no dedicated email field, as the
  design says.

## What the gate reads

Design D3 takes the text after the last `·`, trimmed, and counts it only when it
contains `@`.

- Claude accounts reported: 3.
- All 3 have the form D3 parses. Each yields an email address.
- The observation matches design D3.
- One of the three is the account of the active login (see
  `claude-auth-status.md`), so the two tools share an email address on this
  machine and the lowercase comparison matches exactly one account.
