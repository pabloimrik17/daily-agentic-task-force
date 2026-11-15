# OpenUsage 0.8.0 evidence

Evidence for `read-openusage-limits-v2` (DOT-137). Two sources:

- **Probes** of the installed CLI on 2026-11-15, read-only. `openusage --version`
  prints `openusage 0.8.0`, and `/usr/local/bin/openusage` links to
  `/Applications/OpenUsage.app/Contents/Helpers/openusage`. The app bundle ships
  no schema or documentation file, only the helper binary.
- **Source** of `robinebers/openusage` at tag `v0.8.0` (commit `35e88e9`), read
  through `gh api` on 2026-11-15. Links below are permalinks at the tag.

Display names carry e-mail addresses, so every one below is redacted.

## Command line

| Fact                                                                                                           | Probe                                                                                                | Source                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Usage is `openusage [provider]`. It prints what the app last fetched and never refreshes or signs in.          | `openusage --help`                                                                                   | [`OpenUsageCLI.swift` L48-L62](https://github.com/robinebers/openusage/blob/v0.8.0/Sources/OpenUsageCLI/OpenUsageCLI.swift#L48-L62), [`docs/cli.md` L1-L5](https://github.com/robinebers/openusage/blob/v0.8.0/docs/cli.md#L1-L5)                                    |
| `provider` is an account id or a provider kind, matched lowercased. A kind selects every account of that kind. | `openusage claude` and `openusage claude@ec02e918` both exit 0                                       | [`CLIArguments.swift` L23](https://github.com/robinebers/openusage/blob/v0.8.0/Sources/OpenUsageCLI/CLIArguments.swift#L23), [`UsageReader.swift` L15-L19](https://github.com/robinebers/openusage/blob/v0.8.0/Sources/OpenUsage/Services/UsageReader.swift#L15-L19) |
| An account id is `<kind>@<first 8 hex digits of its UUID>`. A bare `claude` is never an account id.            | the three Claude accounts are `claude@9725f35a`, `claude@ec02e918` and `claude@f33dd56e`             | [`Account.swift` L100-L102](https://github.com/robinebers/openusage/blob/v0.8.0/Sources/OpenUsage/Models/Account.swift#L100-L102)                                                                                                                                    |
| `--force` is accepted, does nothing, and says so on stderr. The document still prints, exit 0.                 | `openusage claude --force`: exit 0, 907 bytes on stdout, stderr `openusage: --force does nothing; …` | [`CLIArguments.swift` L15](https://github.com/robinebers/openusage/blob/v0.8.0/Sources/OpenUsageCLI/CLIArguments.swift#L15), [`OpenUsageCLI.swift` L22-L24](https://github.com/robinebers/openusage/blob/v0.8.0/Sources/OpenUsageCLI/OpenUsageCLI.swift#L22-L24)     |

### Exit codes

| Exit | When                                                                         | stdout                               | Probe                                                                                                            | Source                                                                                                                                                                                                                                                                               |
| ---- | ---------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0    | At least one named account has fetched data.                                 | The document, then a newline.        | `openusage`, `openusage claude`, `openusage claude@ec02e918`                                                     | [`OpenUsageCLI.swift` L28-L33](https://github.com/robinebers/openusage/blob/v0.8.0/Sources/OpenUsageCLI/OpenUsageCLI.swift#L28-L33)                                                                                                                                                  |
| 4    | Nothing fetched yet for the named accounts.                                  | The envelope with no provider in it. | Not observed: every account had data. Upstream test `testNothingFetchedYetPrintsTheEmptyEnvelope`.               | [`OpenUsageCLI.swift` L31-L33](https://github.com/robinebers/openusage/blob/v0.8.0/Sources/OpenUsageCLI/OpenUsageCLI.swift#L31-L33), [`UsageReaderTests.swift` L103-L116](https://github.com/robinebers/openusage/blob/v0.8.0/Tests/OpenUsageTests/UsageReaderTests.swift#L103-L116) |
| 4    | The app's settings domain cannot be opened, or any other thrown error.       | Empty.                               | Not observed.                                                                                                    | [`OpenUsageCLI.swift` L25-L27](https://github.com/robinebers/openusage/blob/v0.8.0/Sources/OpenUsageCLI/OpenUsageCLI.swift#L25-L27) and [L38-L39](https://github.com/robinebers/openusage/blob/v0.8.0/Sources/OpenUsageCLI/OpenUsageCLI.swift#L38-L39)                               |
| 2    | Unknown option, more than one provider, or a provider that names no account. | Empty.                               | `openusage claude@00000000`, `openusage nope`, `openusage claude extra` and `openusage --bogus`: exit 2, 0 bytes | [`OpenUsageCLI.swift` L34-L37](https://github.com/robinebers/openusage/blob/v0.8.0/Sources/OpenUsageCLI/OpenUsageCLI.swift#L34-L37), [`CLIArguments.swift` L17-L22](https://github.com/robinebers/openusage/blob/v0.8.0/Sources/OpenUsageCLI/CLIArguments.swift#L17-L22)             |

So `openusage claude` exits 2 when no Claude account is set up, and 4 when none
of them has been fetched yet. No exit code reports an account error.
[`docs/cli.md` L26-L32](https://github.com/robinebers/openusage/blob/v0.8.0/docs/cli.md#L26-L32)
documents the same three codes.

## The document

`openusage.limits.v2` is encoded with sorted keys
([`LimitsEnvelope.swift` L23-L31](https://github.com/robinebers/openusage/blob/v0.8.0/Sources/OpenUsage/Services/LimitsEnvelope.swift#L23-L31)).
Its fields are documented in
[`docs/cli.md` L34-L91](https://github.com/robinebers/openusage/blob/v0.8.0/docs/cli.md#L34-L91).

- **Root.** `schema`, `generatedAt` and `providers`, nothing else. There is no
  `errors` list
  ([`LimitsEnvelope.swift` L34-L38](https://github.com/robinebers/openusage/blob/v0.8.0/Sources/OpenUsage/Services/LimitsEnvelope.swift#L34-L38)).
  If encoding fails, the fallback is `{"providers":{},"schema":"openusage.limits.v2"}`,
  without `generatedAt`
  ([L30-L31](https://github.com/robinebers/openusage/blob/v0.8.0/Sources/OpenUsage/Services/LimitsEnvelope.swift#L30-L31)).
  The gate rejects that fallback as a contract violation.
- **Provider.** Keyed by account id: `displayName`, `plan` (left out when the
  provider reports none), `fetchedAt`, `expiresAt`, `stale` and `resources`
  ([L40-L53](https://github.com/robinebers/openusage/blob/v0.8.0/Sources/OpenUsage/Services/LimitsEnvelope.swift#L40-L53)).
  An account with no fetched data has no entry
  ([L14-L15](https://github.com/robinebers/openusage/blob/v0.8.0/Sources/OpenUsage/Services/LimitsEnvelope.swift#L14-L15)).
  Probe: `claude@f33dd56e` had no `plan` key at all, not a null.
- **Resource.** `kind` is `consumption` or `balance`
  ([`LimitResourceDescriptor.swift` L4-L7](https://github.com/robinebers/openusage/blob/v0.8.0/Sources/OpenUsage/Models/LimitResourceDescriptor.swift#L4-L7)).
  `unit` is always present. `used`, `available`, `limit`, `remaining`,
  `utilization`, `resetsAt`, `windowSeconds` and `expiresAt` are optional and
  left out when absent, never null. A consumption has `used`; a balance has
  `available`; `expiresAt` is a sorted list of instants
  ([L68-L111](https://github.com/robinebers/openusage/blob/v0.8.0/Sources/OpenUsage/Services/LimitsEnvelope.swift#L68-L111)).
  Claude's resource keys are `session`, `weekly`, `sonnet`, `fable`,
  `extraUsage` and `rateLimitResets`
  ([`docs/cli.md` L95-L97](https://github.com/robinebers/openusage/blob/v0.8.0/docs/cli.md#L95-L97)).

The document `openusage claude` printed at 2026-11-15T17:53:24Z, exit 0, empty
stderr, pretty-printed, display name redacted:

```json
{
    "generatedAt": "2026-11-15T17:53:24.000Z",
    "providers": {
        "claude@ec02e918": {
            "displayName": "<redacted>",
            "expiresAt": "2026-11-15T18:00:55.000Z",
            "fetchedAt": "2026-11-15T17:50:55.000Z",
            "plan": "Pro",
            "resources": {
                "fable": {
                    "kind": "consumption",
                    "limit": 100,
                    "remaining": 65,
                    "resetsAt": "2026-11-20T07:00:00.000Z",
                    "unit": "percent",
                    "used": 35,
                    "utilization": 0.35,
                    "windowSeconds": 604800
                },
                "rateLimitResets": {
                    "available": 2,
                    "expiresAt": ["2026-11-17T07:59:00.000Z", "2026-12-10T22:00:00.000Z"],
                    "kind": "balance",
                    "unit": "resets"
                },
                "session": {
                    "kind": "consumption",
                    "limit": 100,
                    "remaining": 100,
                    "resetsAt": "2026-11-15T19:20:00.000Z",
                    "unit": "percent",
                    "used": 0,
                    "utilization": 0,
                    "windowSeconds": 18000
                },
                "weekly": {
                    "kind": "consumption",
                    "limit": 100,
                    "remaining": 68,
                    "resetsAt": "2026-11-20T07:00:00.000Z",
                    "unit": "percent",
                    "used": 32,
                    "utilization": 0.32,
                    "windowSeconds": 604800
                }
            },
            "stale": false
        }
    },
    "schema": "openusage.limits.v2"
}
```

At 18:02:19Z the same command listed three Claude accounts, `claude@9725f35a`,
`claude@ec02e918` and `claude@f33dd56e`, each with the same four resources and
`stale: false`. The app had fetched the other two in between.

## Staleness and account errors

- `expiresAt` is `fetchedAt` plus two refresh intervals of 5 minutes, and
  `stale` is true once `generatedAt` reaches it
  ([`ProviderSnapshot.swift` L38-L40](https://github.com/robinebers/openusage/blob/v0.8.0/Sources/OpenUsage/Models/ProviderSnapshot.swift#L38-L40),
  [`RefreshSetting.swift` L4-L8](https://github.com/robinebers/openusage/blob/v0.8.0/Sources/OpenUsage/Stores/RefreshSetting.swift#L4-L8),
  [`LimitsEnvelope.swift` L51-L53](https://github.com/robinebers/openusage/blob/v0.8.0/Sources/OpenUsage/Services/LimitsEnvelope.swift#L51-L53)).
  Probe: every `expiresAt` above is `fetchedAt` plus 10 minutes. Upstream test:
  [`UsageReaderTests.swift` L60-L77](https://github.com/robinebers/openusage/blob/v0.8.0/Tests/OpenUsageTests/UsageReaderTests.swift#L60-L77).
- A failed refresh keeps the last good values and does not change the output.
  `stale` means "the app isn't running, or its refreshes of that account are
  failing"
  ([`docs/cli.md` L76](https://github.com/robinebers/openusage/blob/v0.8.0/docs/cli.md#L76)
  and [L90-L91](https://github.com/robinebers/openusage/blob/v0.8.0/docs/cli.md#L90-L91),
  [`docs/refreshing.md` L42-L45](https://github.com/robinebers/openusage/blob/v0.8.0/docs/refreshing.md#L42-L45)
  and [L66-L67](https://github.com/robinebers/openusage/blob/v0.8.0/docs/refreshing.md#L66-L67)).
- So v2 reports an account error only as staleness, per account, and only
  once that account's `expiresAt` passes. For the first 10 minutes after the
  last good fetch, a failing account looks fresh. A stale account was not
  observed live: making one means stopping the app or breaking a login.

## Dry run of the gate (task 4.2)

`bun plugins/autonomous/src/run.ts`, from this worktree, without `--apply`,
2026-11-15. Only the `[quota-gate]` section was read; the later steps' output
was discarded unread. Display names are redacted.

Without `--account`, at 18:02:14Z, the three accounts made the selection
ambiguous:

```text
[quota-gate] not-evaluable (code)
  accounts:
    - claude@9725f35a — <redacted>
    - claude@ec02e918 — <redacted>
    - claude@f33dd56e — <redacted>
  reasons:
    - ambiguous account: 3 Claude accounts present, pass --account <provider-key>
```

With `--account claude@ec02e918`, started at 18:02:28Z, the gate passed:

```text
[quota-gate] advance (code)
  account   claude@ec02e918 — <redacted> · Pro
  fetched   2026-11-15T18:00:56.000Z
  session   0% / 100%  window 5h  resets 2026-11-15T19:20:00.000Z  no projection: no consumption yet
  weekly    32% / 100%  window 7d  resets 2026-11-20T07:00:00.000Z  projected 91.1%
  fable     35% / 100%  not evaluated
  rateLimitResets 2 resets available  not evaluated
  reasons:
    - session window has capacity: 0/100 percent, resets at 2026-11-15T19:20:00.000Z
    - weekly window has capacity: 32/100 percent, resets at 2026-11-20T07:00:00.000Z
```
