# Proposal

## Why

On a machine with several Claude accounts, every `/autonomous:run` and `/autonomous:loop` must name the account with `--account`, or the quota gate stops as `not-evaluable`. The user already has a tool that switches the Claude Code login to the account worth using, so the run asks a question whose answer the machine already knows. Claude Code reports the account it is logged in as, and the run can read it.

The flag also misleads. It chooses only which account's quota the gate reads. The sessions run on the Claude Code login, whatever the flag says, so the gate can check one account while the work spends another.

## What Changes

- The quota gate evaluates the active account: the one Claude Code is logged in as, read with `claude auth status`.
- The run never chooses an account, never changes the login, and never uses another account when the active one is exhausted (ADR 0006).
- `--account` is removed. Passing it is a usage error whose message says that the run evaluates the active account.
- The rule "several accounts need `--account`" is removed. The ambiguous-account and unknown-account outcomes no longer exist.
- The gate is `not-evaluable` when Claude Code reports no login, when its login has no email address, when `claude auth status` cannot be read, or when OpenUsage reports no account, or more than one, with that email address.
- Accounts are matched across tools by email address. OpenUsage carries it in the account's display name.
- The gate report shows the email address of the evaluated account.
- When the outcome is `wait`, the report lists the other accounts that have capacity and says that Claude Code is not logged in as them. This makes a late switch of the login visible. The run does not act on it.
- The gate reads quota through a quota source contract, with OpenUsage as its one implementation. The behavior of the OpenUsage read does not change.

The plugin ships this as a minor version. A script that passes `--account` gets a usage error (exit 1) and must drop the flag.

Keeping the launched sessions on a named account was considered and left out. ADR 0006 records why.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `quota-gate`: which account the gate evaluates, how it finds it, and what the report says about it and about the other accounts.
- `autonomous-run`: `--account` is no longer a run flag.
- `autonomous-loop`: `--account` is no longer a loop flag, and the loop reads the active account in every iteration.

## Impact

- Code: `plugins/autonomous/src/quota-gate/` (selection, step, render, a new read of the Claude Code login, the quota source contract), `src/runner.ts` and `src/run.ts` (the injected commands), `src/args.ts` (the flag, its combination rules and the usage text).
- Reports: the `quota-gate` data of `autonomous.run.v2` gains fields. No field is removed, so the schema name stays.
- Documentation: `plugins/autonomous/README.md`, `commands/run.md`, `commands/loop.md`, and the purpose of `openspec/specs/quota-gate/spec.md`. `GLOSSARY.md` and ADR 0006 are already written.
- Evals: `evals/run-nobody-to-ask` passes `--account` and has no stand-in for `claude auth status`.
- Dependencies: the gate now needs the `claude` CLI to answer `auth status`. Verified on Claude Code 2.1.325. No account switcher is needed.
- Related: Beads `agentic-task-tu1l` tracks the late switch of the login in the user's dotfiles.
