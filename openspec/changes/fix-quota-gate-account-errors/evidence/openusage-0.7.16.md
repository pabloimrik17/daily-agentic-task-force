# OpenUsage 0.7.16 evidence

Evidence for `fix-quota-gate-account-errors` (DOT-112). The source is
`robinebers/openusage` at tag `v0.7.16`, read through `gh api` on 2026-11-07.
`<cli>` is `Sources/OpenUsageCLI/OpenUsageCLI.swift` and `<reader>` is
`Sources/OpenUsage/Services/UsageReader.swift`. Both are linked below as
permalinks at the tag. `--help` documents none of the exit codes.

## Exit codes of OpenUsage 0.7.16

| Exit | When                                                                                                                             | stdout                                     | Source                                                                                                                                                                                                                                                                                                                                                                                            |
| ---- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | The read succeeded and `warnings` is empty.                                                                                      | The document, then a newline.              | [`<cli>` L24-L33](https://github.com/robinebers/openusage/blob/v0.7.16/Sources/OpenUsageCLI/OpenUsageCLI.swift#L24-L33)                                                                                                                                                                                                                                                                           |
| 4    | The read succeeded and `warnings` is not empty. One `openusage: warning: <id>: <message>` line per account error goes to stderr. | The document, written before the warnings. | [`<cli>` L28-L33](https://github.com/robinebers/openusage/blob/v0.7.16/Sources/OpenUsageCLI/OpenUsageCLI.swift#L28-L33)                                                                                                                                                                                                                                                                           |
| 4    | Fatal: the app's settings domain cannot be opened.                                                                               | Empty. Nothing was written to stdout.      | [`<cli>` L21-L23](https://github.com/robinebers/openusage/blob/v0.7.16/Sources/OpenUsageCLI/OpenUsageCLI.swift#L21-L23) and [L36-L37](https://github.com/robinebers/openusage/blob/v0.7.16/Sources/OpenUsageCLI/OpenUsageCLI.swift#L36-L37)                                                                                                                                                       |
| 4    | Fatal: any other thrown error.                                                                                                   | Empty.                                     | [`<cli>` L40-L41](https://github.com/robinebers/openusage/blob/v0.7.16/Sources/OpenUsageCLI/OpenUsageCLI.swift#L40-L41)                                                                                                                                                                                                                                                                           |
| 2    | Usage error, or an unknown provider.                                                                                             | Empty.                                     | [`<cli>` L34-L35](https://github.com/robinebers/openusage/blob/v0.7.16/Sources/OpenUsageCLI/OpenUsageCLI.swift#L34-L35) and [L38-L39](https://github.com/robinebers/openusage/blob/v0.7.16/Sources/OpenUsageCLI/OpenUsageCLI.swift#L38-L39), the latter thrown at [`<reader>` L75-L77](https://github.com/robinebers/openusage/blob/v0.7.16/Sources/OpenUsage/Services/UsageReader.swift#L75-L77) |

Where the warnings and `errors` come from:

- The warnings on stderr and the document's `errors` come from the same
  `providerErrors` map. `errors = dataStore.providerErrors` and `warnings` is
  that map formatted as `"<id>: <message>"`
  ([`<reader>` L128-L130](https://github.com/robinebers/openusage/blob/v0.7.16/Sources/OpenUsage/Services/UsageReader.swift#L128-L130)).
  The map is passed to the document as `errors`
  ([`<reader>` L133-L139](https://github.com/robinebers/openusage/blob/v0.7.16/Sources/OpenUsage/Services/UsageReader.swift#L133-L139)).
- Both are set only inside the refresh branch, which starts at
  [`<reader>` L105](https://github.com/robinebers/openusage/blob/v0.7.16/Sources/OpenUsage/Services/UsageReader.swift#L105).
  Without a refresh, `warnings` and `errors` stay empty
  ([`<reader>` L102-L103](https://github.com/robinebers/openusage/blob/v0.7.16/Sources/OpenUsage/Services/UsageReader.swift#L102-L103)),
  so a cached read exits 0 with `errors: []`.
- A refresh happens when `--force` is given, when a cache entry for an enabled
  provider is missing, or when its account stamp is stale
  ([`<reader>` L98-L100](https://github.com/robinebers/openusage/blob/v0.7.16/Sources/OpenUsage/Services/UsageReader.swift#L98-L100)).
  The `--force` option is documented as "Refresh even when the shared cache is
  still fresh" ([`<cli>` L57-L60](https://github.com/robinebers/openusage/blob/v0.7.16/Sources/OpenUsageCLI/OpenUsageCLI.swift#L57-L60)).
  Whether `cache.snapshot` returns nothing for an entry past the five-minute
  time to live is decided in the cache class, which this file does not read.

The DOT-104 check of 2026-10-02 saw exit 4 with a valid document. `claude` was
at 49 % session and 6 % weekly, and `claude@12101920` appeared only in `errors`.
Source: the description of Linear DOT-112. A first attempt at that check ended
`not-evaluable` for this reason, as the archived
[interactive-check.md](../../archive/2026-10-04-add-interactive-handoff/evidence/interactive-check.md#L197-L201)
records, lines 197 to 201.

## Slow reads on 2026-11-07

Source: the DOT-112 grill session `419fb132-3e37-4142-9461-5c6736243b87`,
transcript
`~/.claude/projects/-Users-etherless-WebstormProjects-daily-agentic-task-force-worktrees-feature-DOT-112-quota-gate-account-errors/419fb132-3e37-4142-9461-5c6736243b87.jsonl`.
Both reads ran `openusage claude` on OpenUsage 0.7.16 in this worktree.

| Read | Command and start                                                                                                            | Time                                                                                                                                   | Outcome                                                                                                                                                                                           |
| ---- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `openusage claude >/tmp/claude-501/ou.json 2>/tmp/claude-501/ou.err`, started at 2026-11-07T20:40:03Z (transcript line 262). | More than 120 s. The tool result at 20:42:06Z says the command "did not complete within its 120s timeout" and moved to the background. | Completed with exit 0 (task notification, 20:42:20Z). `ou.err` was empty. The providers were `claude`, `claude@12101920` and `claude@63ff2ad7`, and `errors` was `[]` (tool result at 20:42:30Z). |
| 2    | `openusage claude >/dev/null 2>&1`, started at 2026-11-07T20:53:29Z (transcript line 383).                                   | 55 s, measured with `date +%s` before and after. The result was logged at 20:54:34Z.                                                   | `exit=0 seconds=55`. The output went to `/dev/null`, so the transcript shows neither the accounts nor `errors` for this read.                                                                     |

The gate's timeout is 120 s, so read 1 would have been `not-evaluable` by
timeout. Read 2 would have passed. In the same session the assistant reads the
slowness as a refresh (an account's cache missing or stale) and records it as
evidence only. That reading is an inference from the source above, not a
measurement.

## Live run (task 5.2)

Two runs of `bun plugins/autonomous/src/run.ts --account claude --json`, without
`--apply`, against the live OpenUsage 0.7.16, back to back on 2026-11-07. The
first ran this branch from its worktree, from 21:26:33Z to 21:29:51Z. The second
ran `main` at `0723cba` from the main checkout, from 21:29:57Z to 21:32:37Z. Both
used the same configuration and the shared OpenUsage cache.

| Field              | Branch                                                                                                  | `main`               |
| ------------------ | ------------------------------------------------------------------------------------------------------- | -------------------- |
| Exit, stderr       | 0, empty                                                                                                | 0, empty             |
| Run outcome        | `advance`                                                                                               | `advance`            |
| Quota-gate outcome | `advance`                                                                                               | `advance`            |
| Reasons            | session 66/100 percent, resets 2026-11-08T00:19:59Z; weekly 35/100 percent, resets 2026-11-13T06:59:59Z | the same             |
| Account            | `claude`, not stale, `errors: []`                                                                       | the same             |
| Candidates         | `claude`, `claude@12101920`, `claude@63ff2ad7`                                                          | the same             |
| `fetchedAt`        | 2026-11-07T21:24:20Z                                                                                    | 2026-11-07T21:29:24Z |

No account error was present. The quota gate's outcome and reasons match
between the branch and `main`. Only `fetchedAt` differs, because OpenUsage
refreshed its cache between the two runs.
