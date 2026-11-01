# Manual check against the real trackers

Task 9.2 of `add-stage-labels-and-transition`, run on 2026-11-01 from this
worktree with the user's configuration (`~/.config/autonomous/config.json`:
Linear, Beads and GitHub enabled). Steps 1 and 2 were authorised in advance.
Steps 3 to 5 were authorised by the user on 2026-11-01 in the Plannotator
Inbox thread "DOT-110 change 1 apply".

## Step 0: the Linear alias `Grill Me`

Agreed with the user on 2026-11-01: every open issue carrying the alias
`Grill Me` gets the literal `grill-me` and loses the alias, so no task with an
autonomy label and the alias gets `proposal` by rule. The user's configuration
declares no other alias for `grill-me` (Beads and GitHub have none).

Result: nothing to change, no write issued. Four independent reads through the
`linear` CLI (2.6.0), the same commands the plugin uses:

| Read                                                            | Result                                                      |
| --------------------------------------------------------------- | ----------------------------------------------------------- |
| `linear issue query --all-teams --limit 0 --json`               | 108 issues, 0 carry `Grill Me`                              |
| `… --label "Grill Me" --json`                                   | 0 issues                                                    |
| `… --include-archived --json`                                   | 304 issues, 0 carry `Grill Me` (closed or cancelled: 0)     |
| `linear api` query `issueLabel(id).issues(includeArchived)`     | `nodes: []`                                                 |

The label definition `Grill Me` (`#f2994a`, workspace, zero issues) and the
alias in the configuration were left as they are; removing them is the user's
call. Fourteen issues already carry the literal `grill-me` (thirteen open, one
completed) and were not touched.

## Step 1: dry run

`bun plugins/autonomous/src/run.ts --account claude --json`, 2026-11-01
10:32 UTC, exit 2 (`launch` waits: the `grill-me` stage has no implementation
yet). The first attempt without `--account` exited 3 at the quota gate,
`ambiguous account: 2 Claude accounts present`, as documented. The report is
`autonomous.run.v2`, with no `entry` key and no handoff (no `--apply`).

`label-triage` advanced at tier `llm` (2 judgement batches, 502 tasks beyond
the cap of 25) and reported:

| Source | Read | Complete | Missing scope | Missing autonomy | Missing stage | Conflict |
| ------ | ---- | -------- | ------------- | ---------------- | ------------- | -------- |
| beads  | 1140 | 90       | 67            | 436              | 1046          | 1        |
| github | 19   | 1        | 1             | 17               | 18            | 0        |
| linear | 105  | 13       | 0             | 70               | 92            | 0        |

- `proposal` is proposed by rule for every task with an autonomy label and no
  stage label: 613 on Beads, 22 on Linear, 1 on GitHub (639 labels proposed in
  all, with 2 `work` and 1 `personal` by evidence).
- Before the bootstrap, the dry run already reports `proposal is missing on
  linear; run --bootstrap-labels` and `proposal is missing on github; run
  --bootstrap-labels` (task 3.7): the 22 Linear and the 1 GitHub `proposal`
  records carry that detail; the 613 Beads records carry none (Beads is never
  checked).
- 26 groups for the human: 25 Beads autonomy judgements below the threshold
  (asked) and one Beads scope conflict (`agentic-task-droi.11`, `personal` and
  `work`).
- `select` advanced on Linear `DOT-120` for `grill-me` with autonomy `null`,
  from 98 candidates; 1160 tasks excluded under classification, 4 split, 2
  blocked.

The 613 Beads `proposal` writes are far above the 91 the proposal estimated
on 2026-09-30: the Beads database has grown to 1140 open tasks. The first
`--apply` run after the release will write them all (rule writes are uncapped,
as for scope).

## Step 2: bootstrap

`bun plugins/autonomous/src/run.ts --bootstrap-labels --json`, 2026-11-01
10:34 UTC, exit 0, outcome `advance`, schema `autonomous.bootstrap.v1`.

| Source | Scope                                  | Created    | Recoloured                                            | Present                                  |
| ------ | -------------------------------------- | ---------- | ----------------------------------------------------- | ---------------------------------------- |
| beads  | (not applicable: labels exist by use)  |            |                                                       |                                          |
| github | `pabloimrik17/dotfiles`                | `proposal` | `AFK` (`#5e6ad2`, was `#0052cc`), `HITL` (`#eb5757`, was `#b60205`) | `work`, `personal`, `grill-me`, `taken` |
| github | `pabloimrik17/kinkoi-project`          | `proposal` |                                                       | the other six                            |
| github | `pabloimrik17/monolab`                 | `proposal` |                                                       | the other six                            |
| github | `pabloimrik17/daily-agentic-task-force` | `proposal` |                                                       | the other six                            |
| linear | `workspace`                            | `proposal` |                                                       | the other six                            |

Every created label has colour `#bb87fc`; every recolour reports its old
colour in its note; nothing outside the contract was reported or touched.

## Step 3: transition of a throwaway Beads task

Authorised by the user on 2026-11-01 in the Plannotator Inbox thread "DOT-110
change 1 apply". The throwaway task is `agentic-task-uylg`, created
2026-11-01 10:50 UTC with `bd create "DOT-110 throwaway transition check"
--type task --priority 4 --labels personal,grill-me`. Read back before the
transition: labels `grill-me`, `personal`, status `open`. The create printed
only the id on stdout and a `beads.role not configured (GH#2950)` warning on
stderr.

`bun plugins/autonomous/src/run.ts --apply --transition
beads:agentic-task-uylg --json`, 2026-11-01 10:50 UTC, exit 0, outcome
`advance`, schema `autonomous.transition.v1`. No `--account`: transition mode
runs no quota gate and the script refuses the flag with it (exit 1,
`args.test.ts`), unlike step 1. The same command without `--json` ran at
10:50 UTC and exited 0.

| Field              | Value                                                    |
| ------------------ | -------------------------------------------------------- |
| Question id        | `transition:beads:agentic-task-uylg`                     |
| Step, header       | `transition`, `autonomy`                                 |
| Options            | `AFK`, `HITL`, `Later` (null value)                      |
| `current ·` marker | none: the task carries no autonomy label                 |
| Handoff            | one question, remaining 0                                |
| Text form          | last line starts with `handoff:` and parses as JSON: yes |
| stderr             | empty                                                    |

Answer: `bun plugins/autonomous/src/run.ts --apply --answer
'transition:beads:agentic-task-uylg=AFK' --json`, 2026-11-01 10:51 UTC, exit 0,
outcome `advance`, schema `autonomous.answers.v1`.

| Answer                               | Labels | Status    | Detail                                                                      |
| ------------------------------------ | ------ | --------- | --------------------------------------------------------------------------- |
| `transition:beads:agentic-task-uylg` | `AFK`  | `applied` | added AFK, proposal, removed grill-me on beads agentic-task-uylg, read back |

Read back through `bd -C /Users/etherless/WebstormProjects/agentic-task show
agentic-task-uylg --json`, the command the plugin reads with, 2026-11-01
10:51 UTC:

| Labels                      | Before                 | After                         |
| --------------------------- | ---------------------- | ----------------------------- |
| `agentic-task-uylg` (beads) | `grill-me`, `personal` | `AFK`, `personal`, `proposal` |

`grill-me` is gone, `personal` is untouched, and `AFK` and `proposal` were
added before `grill-me` was removed (status `open`).

## Step 4: the transition again

`bun plugins/autonomous/src/run.ts --apply --transition
beads:agentic-task-uylg --json`, 2026-11-01 10:51 UTC, exit 3, outcome
`not-evaluable`, schema `autonomous.transition.v1`, no `handoff` key.

| Field   | Value                                                                           |
| ------- | ------------------------------------------------------------------------------- |
| Task    | `beads agentic-task-uylg`, labels `[AFK, personal, proposal]`                   |
| Reasons | `beads agentic-task-uylg is not in grill-me (labels [AFK, personal, proposal])` |
| Text    | no `handoff:` line (`grep -c` returned 0, exit 3)                               |
| stderr  | empty                                                                           |

Nothing was written: the labels read back after the run are still `AFK`,
`personal` and `proposal`.

## Step 5: closing the throwaway task

`bd close agentic-task-uylg --reason="Throwaway task for task 9.2 of
add-stage-labels-and-transition (DOT-110): the transition and its answer were
checked; nothing to implement."`, 2026-11-01 10:51 UTC, exit 0. Read back:
status `closed`, labels `AFK`, `personal`, `proposal` (close removes none).
`agentic-task-uylg` is outside the open-task reads from now on, so the
`proposal` it carries is never triaged. Dolt pull and push of the task data:
done by the orchestrator at 10:58 UTC (nothing left to commit; the writes
auto-commit).

## Independent read-back

A read-only checker (`bd show`, `bd list -n 0 --json`) confirmed after step 5,
2026-11-01 10:55 UTC: `agentic-task-uylg` is `closed` with labels `AFK`,
`personal` and `proposal`, and no `grill-me`; 91 open tasks carry `grill-me`,
none of them `uylg`. Three other open tasks already carry `proposal`:
`agentic-task-1p6`, `agentic-task-d14` and `agentic-task-qt8`, dotfiles
features the user created on 2026-09-28 with `dotfiles`, `personal` and
`proposal`, unchanged since. They predate this change, and this check wrote
nothing to them.

On 2026-11-01 the user asked in the Inbox to move the three tasks to
`grill-me`. Between 11:05 and 11:07 UTC each got `grill-me` added and then
`proposal` removed, through the plugin's own commands
(`bd -C <directory> label add` and `label remove`). Each write was read
back. The final labels are `dotfiles`, `grill-me` and `personal`, and the
status is `open`. Under the contract their autonomy is now `deferred` to a
grill.
