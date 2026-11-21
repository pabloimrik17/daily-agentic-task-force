# Verification stage verification

End-to-end checks of tasks 11.1–11.3. The plugin code under test is this feature worktree,
`feature/DOT-149-add-verify-stage`, run from source. Every tracker write had the user's go-ahead in
the Plannotator Inbox thread "DOT-149 etapa de verificación (apply)".

## 11.1 Bootstrap of `code-review`

2026-11-21 11:02 UTC, with the loop stopped (no `loop.lock` or `run.lock` in
`~/.local/state/autonomous`, no `run.ts` process) and the user's configuration (Beads, four
GitHub repositories, Linear; `AUTONOMOUS_CONFIG` unset).

Before: the label listings were not saved (the operator's read-back script never ran). The first
run's `created` status in every scope is the evidence that `code-review` was absent: the bootstrap
reports `present` for a label that exists.

`bun plugins/autonomous/src/run.ts --bootstrap-labels --json`: exit 0,
`autonomous.bootstrap.v1`, outcome `advance`. Every label other than `code-review` reported
`present`; Beads `not applicable - Beads needs no label creation: labels exist by use`.

| Scope                                   | Label         | Status    | Colour    |
| --------------------------------------- | ------------- | --------- | --------- |
| `pabloimrik17/dotfiles`                 | `code-review` | `created` | `#a3e635` |
| `pabloimrik17/kinkoi-project`           | `code-review` | `created` | `#a3e635` |
| `pabloimrik17/monolab`                  | `code-review` | `created` | `#a3e635` |
| `pabloimrik17/daily-agentic-task-force` | `code-review` | `created` | `#a3e635` |
| Linear workspace                        | `code-review` | `created` | `#a3e635` |

A second run (text report, exit 0) reported every label, `code-review` included, `present` in
every scope. Read-back: `gh label list --search code-review` shows `code-review a3e635` in the four
repositories, and `linear label list --all` shows `code-review #a3e635 Workspace`.

PASS: `code-review` exists with its contract colour on every tracker that needs label creation.
