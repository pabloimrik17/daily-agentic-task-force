# Tasks

## 1. Contracts observed

- [x] 1.1 Record in `evidence/claude-auth-status.md` what `claude auth status` prints on the installed Claude Code: the version, the exit code and the fields for a login, and the same for no login (probe with an empty `CLAUDE_CONFIG_DIR`, never with a logout). Redact the email address and the organization. Verify that the file names every field design D1 reads.
- [x] 1.2 Record in `evidence/openusage-display-name.md` the display-name format of every Claude account that `openusage claude` reports on this machine, with the email addresses redacted. Verify that each one has the form design D3 parses.

## 2. Quota source contract

- [x] 2.1 Add `src/quota-gate/source.ts` with `QuotaAccount` and `QuotaSource` (design D4), and make `openusage.ts` implement it, deriving `email` from the display name (design D3). Verify with `openusage.test.ts`: an account with `Claude · ana@example.com` has that email address; one with `Claude` has `null`; a non-Claude provider is left out; the failures of the read keep their reasons.
- [x] 2.2 Move `decide.ts`, `select.ts`, `step.ts`, `render.ts` and the test fixtures to the contract types, and replace `ctx.io.openUsage` with `ctx.io.quota` in `src/runner.ts` and `src/run.ts`. Verify that `bun run typecheck` passes and that the existing `decide`, `project` and `render` tests pass with no change of expectation.

## 3. Active account

- [x] 3.1 Add `src/quota-gate/login.ts` and `ctx.io.login` (design D1). Verify with `login.test.ts`: exit 0 with an email address returns it; exit 1 with `loggedIn: false` gives the "no login" reason; a login with no `email` gives its reason; a missing CLI, a timeout, another exit code and output that is not JSON each give a reason that names the failure.
- [x] 3.2 Rewrite `selectAccount` to the one rule of design D5, comparing email addresses without regard to case. Verify with `select.test.ts`: every scenario of "Account selection" and "Accounts matched by email address" in the `quota-gate` delta, including two accounts with the same email address and a single account that is not the active one.
- [x] 3.3 In `step.ts`, read the quota source, then the login, then select (design D2). Verify with `step.test.ts`: a failed quota read does not run the login command; a failed login read is `not-evaluable` and the accounts are still listed; an exhausted active account is `wait` while another account has capacity.
- [x] 3.4 Add `email` to the account report and to the listed accounts, and show it in the text report (design D6). Verify with `render.test.ts`, and with `report.test.ts` that the JSON document keeps the name `autonomous.run.v2`.
- [x] 3.5 On a `wait`, evaluate the other accounts and report those that would advance (design D8). Verify with `step.test.ts` and `render.test.ts`: the three scenarios of "Other accounts with capacity are reported", and that the outcome and the reasons do not change.
- [x] 3.6 Verify with a test in `src/loop/loop.test.ts` that two iterations with a different login evaluate two different accounts (the `autonomous-loop` delta).

## 4. Flag removal and documentation

- [x] 4.1 Remove `--account` from `src/args.ts`: `RunArgs.account`, the usage lines, the combination rules and their messages, keeping a reader that fails with the message of design D7. Verify with `args.test.ts`: `--account` alone, with `--loop`, and with `--task` each exit 1 with that message; the rules of `--force` are unchanged. Verify that `bun run lint:knip` reports no unused export.
- [x] 4.2 Update `plugins/autonomous/README.md`: the step list, the flag table (no `--account` row), the usage block, the examples, the exit-code table (no "ambiguous or unknown"), and a paragraph on the active account that links ADR 0006 and says how to run on another account. Verify with `bun run lint:markdownlint` and against the delta specs.
- [x] 4.3 Update `commands/run.md` and `commands/loop.md`: the `argument-hint`, the shell example, the sentence "If the report says an account must be chosen", and the mention of `--account` in the answer step. Verify by reading both files against the delta specs.
- [x] 4.4 Change the purpose of `openspec/specs/quota-gate/spec.md` to say that the gate evaluates the active account. Verify with `openspec validate --specs --strict`.
- [x] 4.5 Move the `run-nobody-to-ask` eval: its stand-in `openusage` prints a display name with an email address, a stand-in `claude` answers `auth status` with that email address and passes every other call to the real `claude`, and `prompt.md` passes no `--account`. Verify by running the scaffold and feeding it to the quota gate: it advances and reports that email address.

## 5. Integration

- [x] 5.1 Run the full gate set and confirm each passes: `bun run typecheck`, `bun run test`, `bun run lint:eslint`, `bun run lint:knip`, `bun run lint:fallow`, `bun run fallow audit`, `bun run lint:oxfmt`, `bun run lint:markdownlint`, `bun run lint:marketplace` and `openspec validate evaluate-active-account --strict`.
- [x] 5.2 Run `bun plugins/autonomous/src/run.ts` with no `--apply` on this machine, which has three Claude accounts. Confirm that `[quota-gate]` evaluates the account `claude auth status` reports. Run it with `--account <email>` and confirm the usage error. Record both redacted outputs in `evidence/live-gate.md`.
- [x] 5.3 Switch the Claude Code login to another account and run the dry run again. Confirm that the gate evaluates the new account. Record it in `evidence/live-gate.md`. This step changes the login of the machine, so ask the user before it.

## Workflow follow-up

- Commit as `feat(autonomous): …`, never `feat!`, with `GLOSSARY.md` and ADR 0006, which are already written.
- Archive the change after review, so that the main specs take the deltas.
