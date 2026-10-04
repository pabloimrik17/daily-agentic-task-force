# Interactive handoff evidence

## Eval case (task 8.2)

Case `plugins/autonomous/evals/run-nobody-to-ask` covers the scenario "Nobody to
ask": the report carries a handoff and the session cannot ask the user.

The obstacle was `quota-gate`, which runs `openusage claude` from `PATH`. A probe
case (deleted afterwards) ran `echo "$PATH"; echo "$HOME"; pwd; command -v
openusage bun bd` in the eval sandbox:

- `HOME` is the sandbox (`<temp>/home`), the working directory is `<temp>/home/cwd`.
- `PATH` is inherited from the caller unchanged, so the real `/usr/local/bin/openusage`
  resolves, and a scaffold cannot put anything ahead of it through `PATH` alone.
- The Bash tool of the eval agent does read shell start-up files from the sandbox
  `HOME`. A second probe whose scaffold wrote `export PATH="$HOME/bin:$PATH"` to
  `.zshenv`, `.zshrc`, `.zprofile`, `.bashrc`, `.bash_profile` and `.profile` resolved
  `openusage` to `<temp>/home/bin/openusage`.

So the scaffold installs a fake `openusage` (one `claude` account at 5% of both
windows, so the gate advances), a Beads task labelled `nazaries` and `AFK`, and a
config with only Beads enabled, `scope: "personal"` and `aliases: { work:
["nazaries"] }`. The scope evidence conflicts and becomes a question.

Run (`--model claude-sonnet-5 --runs 1 --max-cost-usd 3 --trust-plugin --no-publish`,
default with/without ablation): with plugin score 1.00 (both graders pass), without
plugin 0.50, cost USD 0.21. The trace shows the report ending in a `handoff:` line
with question `label-triage:beads:eval-pes:scope`; the agent looked for
AskUserQuestion, found none, showed the report and ended without any `--answer` call.

Both graders read only the Bash calls, so a run that stopped at the quota gate
or failed before `label-triage` would also pass them (Greptile, PR #22). A third
grader, `handoff-reported`, requires the last message to carry the relayed
`handoff:` line with a Beads scope question. Re-run on 2026-10-04 with the same
flags plus `--scaffold --allow-tools 'Bash(*)'`: with plugin score 1.00 (all
three graders pass), without plugin 0.00 (`handoff-reported` fails), cost USD
0.33 for both arms.

## Manual interactive check (task 8.3)

Session: Claude Code 2.1.287 started from this worktree with
`cswap run 1 -- --plugin-dir ./plugins/autonomous`, so `/autonomous:run` loaded
the branch's command and script. The session ran as account `claude@12101920`,
which the judgement inherits, so every round passes that account.

### Round 1 — `/autonomous:run --account claude@12101920 --apply`

Run started 2026-10-02T15:26:20Z and finished with `outcome: advance`, exit 0,
in about four minutes (two judgement batches, inside the command's timeout).
`label-triage` applied 7 labels and left 25 groups for the human. The report's
last line was the handoff: 4 questions and `remaining: 21`.

| Id                                                  | Header  | Judged          | Answered   |
| --------------------------------------------------- | ------- | --------------- | ---------- |
| `label-triage:beads:agentic-task-i85:entry`         | `entry` | `HITL` 0.55     | `HITL`     |
| `label-triage:beads:agentic-task-ee9:entry`         | `entry` | `AFK` 0.80      | `AFK`      |
| `label-triage:beads:agentic-task-tm2:entry`         | `entry` | `AFK` 0.65      | `HITL`     |
| `label-triage:beads:WebstormProjects-tdhc.13:entry` | `entry` | `grill-me` 0.75 | `grill-me` |

Every question offered `AFK`, `HITL`, `grill-me`, `Later` in that order, with
the judged option's description prefixed and not moved. The session's
transcript shows one AskUserQuestion call whose questions, headers, option
labels and descriptions and `multiSelect` equal the handoff's, field by field.
The headers are all `entry` because every Beads id is longer than 12
characters.

Answer invocation, issued once by the command:

```bash
bun ".../plugins/autonomous/src/run.ts" --apply \
  --answer 'label-triage:beads:agentic-task-i85:entry=HITL' \
  --answer 'label-triage:beads:agentic-task-ee9:entry=AFK' \
  --answer 'label-triage:beads:agentic-task-tm2:entry=HITL' \
  --answer 'label-triage:beads:WebstormProjects-tdhc.13:entry=grill-me'
```

Its report (exit 0):

```text
autonomous answers — started 2026-10-02T15:30:35.420Z
outcome: advance
  applied   label-triage:beads:agentic-task-i85:entry → HITL → added HITL to beads agentic-task-i85, read back
  applied   label-triage:beads:agentic-task-ee9:entry → AFK → added AFK to beads agentic-task-ee9, read back
  applied   label-triage:beads:agentic-task-tm2:entry → HITL → added HITL to beads agentic-task-tm2, read back
  applied   label-triage:beads:WebstormProjects-tdhc.13:entry → grill-me → added grill-me to beads WebstormProjects-tdhc.13, read back
```

Read-back with `bd show <id> --json`:

| Task                       | Labels                                                                      |
| -------------------------- | --------------------------------------------------------------------------- |
| `agentic-task-i85`         | `HITL`, `smile-bitbucket`, `work`                                           |
| `agentic-task-ee9`         | `AFK`, `cleanup`, `eci-av`, `iot-platform-frontend`, `sass`, `vite`, `work` |
| `agentic-task-tm2`         | `HITL`, `smile-bitbucket`, `work`                                           |
| `WebstormProjects-tdhc.13` | `dx`, `grill-me`, `monorepo`, `testing`, `tooling`, `work`                  |

No question was left for `Later` in this round.

### Round 2 — `/autonomous:run --account claude@12101920 --apply --no-handoff`

Run started 2026-10-02T15:36:18Z, `outcome: advance`, exit 0. `label-triage`
again left 25 groups for the human. The session's transcript holds one Bash
call and no AskUserQuestion call, and the report has no `handoff:` line.

### Round 3 — `/autonomous:run --account claude@12101920 --apply --json`

Run started 2026-10-02T15:38:39Z, one `autonomous.run.v1` document, `outcome:
advance`, exit 0. The command took the handoff from the document's `handoff`
field: 4 questions, `remaining: 21`. One AskUserQuestion call carried the 4
questions equal to the handoff's, field by field.

| Id                                                  | Judged                  | Answered |
| --------------------------------------------------- | ----------------------- | -------- |
| `label-triage:beads:WebstormProjects-tdhc.10:entry` | `AFK` 0.70              | `Later`  |
| `label-triage:beads:WebstormProjects-tdhc.11:entry` | `HITL` 0.55             | `Later`  |
| `label-triage:beads:WebstormProjects-tdhc.12:entry` | `HITL`, `grill-me` 0.50 | `Later`  |
| `label-triage:beads:agentic-task-08y:entry`         | `grill-me` 0.75         | `Later`  |

Every answer was the null-valued option, so the command kept none and issued no
answer invocation. Read-back with `bd show <id> --json` right after the round:
none of the four tasks carries an entry label.

### Round 4 — `/autonomous:run --account claude@12101920 --apply --json`

Round 3 left every question for later, so a fourth round checks one answer set
that mixes applied answers with `Later`, and answer mode with `--json`. Run
started 2026-10-02T15:43:56Z, `outcome: advance`, exit 0, 4 questions and
`remaining: 21`; the AskUserQuestion call again equalled the handoff field by
field.

| Id                                                  | Judged          | Answered |
| --------------------------------------------------- | --------------- | -------- |
| `label-triage:beads:WebstormProjects-tdhc.10:entry` | `AFK` 0.70      | `AFK`    |
| `label-triage:beads:WebstormProjects-tdhc.11:entry` | `AFK` 0.65      | `AFK`    |
| `label-triage:beads:WebstormProjects-tdhc.12:entry` | `HITL` 0.50     | `HITL`   |
| `label-triage:beads:agentic-task-08y:entry`         | `grill-me` 0.75 | `Later`  |

The command dropped the `Later` answer and passed `--json` on, as the user gave
it:

```bash
bun ".../plugins/autonomous/src/run.ts" --apply \
  --answer 'label-triage:beads:WebstormProjects-tdhc.10:entry=AFK' \
  --answer 'label-triage:beads:WebstormProjects-tdhc.11:entry=AFK' \
  --answer 'label-triage:beads:WebstormProjects-tdhc.12:entry=HITL' --json
```

It printed one `autonomous.answers.v1` document (`startedAt`
2026-10-02T15:47:08.390Z, `outcome: advance`, no `handoff`), exit 0, with the
three answers `applied` and `detail` `added <label> to beads <id>, read back`.

Read-back with `bd show <id> --json`:

| Task                       | Labels                                                 |
| -------------------------- | ------------------------------------------------------ |
| `WebstormProjects-tdhc.10` | `AFK`, `dx`, `monorepo`, `testing`, `tooling`, `work`  |
| `WebstormProjects-tdhc.11` | `AFK`, `dx`, `monorepo`, `testing`, `tooling`, `work`  |
| `WebstormProjects-tdhc.12` | `HITL`, `dx`, `monorepo`, `testing`, `tooling`, `work` |
| `agentic-task-08y`         | `smile-bitbucket`, `work` (unchanged, no entry label)  |

### Observations

- In rounds 2, 3 and 4 the session ended with a sentence of its own after the
  relayed report (for example, why no question was asked, or how many tasks
  were left unjudged, or which answer it did not send). It reinterprets nothing and writes nothing, but
  `run.md`'s rule is not to summarise.
- When the judgement chose two entry labels (`HITL`, `grill-me` for
  `tdhc.12`), both options carry the judged prefix while the question takes a
  single choice, as the spec defines.
- Outside this change: a first attempt ended `not-evaluable` in `quota-gate`
  because `openusage claude` exits 4 whenever any account reports an error,
  even with valid JSON and the selected account fresh. The quota-gate spec maps
  every non-zero exit to `not-evaluable`, so one stale Claude Swap login blocks
  every account's run. Refreshing that login unblocked the check.
