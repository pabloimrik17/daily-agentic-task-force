---
description: Run the autonomous loop's gate and triage steps, or bootstrap the label contract, and report the outcome
argument-hint: "[--account <provider-key>] [--force] [--json] [--apply] | --bootstrap-labels [--json]"
allowed-tools: Bash(bun:*)
---

# autonomous-run

Entry point of the autonomous loop. Every decision is made by the script; this
command only runs it and relays what it prints. `--apply` lets the
`label-triage` step write labels; `--bootstrap-labels` creates missing labels
on every enabled tracker and exits instead of running the steps.

## Steps

1. Run exactly this, once, with the Bash tool's `timeout` set to `600000`
   (10 minutes, the maximum) and never in the background: a judgement batch
   alone may take 300 s. A run that needs more than one batch, as the shipped
   `cap` 25 and `batch` 20 allow when many tasks are left to judge, can exceed
   the command's timeout; the user should start such a run from a shell, like
   the first `--apply` (see Rules).

    ```bash
    bun "${CLAUDE_PLUGIN_ROOT}/src/run.ts" $ARGUMENTS
    ```

2. Relay the script's stdout and stderr verbatim, in a code block, followed by
   its exit code: 0 advance, 2 wait, 3 not evaluable, 1 usage or runner error.

## Rules

- Do not summarise, reinterpret, recompute or second-guess the report.
- Do not retry with different arguments. If the report says an account must be
  chosen, show it and stop; the user picks the account.
- Never add `--apply` or `--bootstrap-labels` on your own. Pass exactly what
  the user typed, no more and no less.
- The first `--apply`, the one-off clean-up of the existing backlog, issues
  about a thousand CLI calls and exceeds the command's timeout. It must be run
  from a shell, not through this command:
  `bun plugins/autonomous/src/run.ts --account <key> --apply`.
- When the report carries no `handoff`, take no further action: show the
  report and end the command. No step emits a `handoff` yet.
