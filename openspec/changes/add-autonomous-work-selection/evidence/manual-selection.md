# Manual selection run

Task 7.2, run on 2026-10-06 on the user's personal machine against the real
trackers (Beads, GitHub and Linear all enabled). `AUTONOMOUS_CONFIG` pointed
at a scratchpad copy of the user's configuration with
`"selection": { "model": "sonnet", "effort": "high" }` added. Every run used
`--account claude`, because two Claude accounts are present and the quota gate
otherwise stops as ambiguous. No run used `--apply`, so `label-triage` wrote
nothing. The only tracker writes were the manual `taken` add and remove
described below.

Task titles from work trackers are left out on purpose, because this
repository is public. Ids and counts are kept.

## Machine scope

`chezmoi data` reported `machineType` `personal`. The report shows
`machine scope  personal`.

## Run 1: text report, without `--apply`

`bun plugins/autonomous/src/run.ts --account claude` exited 0 with outcome
`advance`. `quota-gate` advanced (code), `label-triage` advanced (llm), and
`select` advanced (llm).

- Selected: Beads `agentic-task-2x0`, stage `grill-me`, autonomy `grill-me`,
  scope `personal`, no machine-scope exception.
- Explanation (as printed): "It is the only P1 candidate and it is in the
  personal scope. It protects 136 staged changes that were never committed,
  and one cleanup of the worktree would lose them. Every later investlab
  change assumes the layout this work introduces, and develop still lacks it.
  That makes it the most urgent and highest-impact candidate, and it unblocks
  the most other work. The effort is large, but the risk of loss grows with
  time. DOT-104 only needs a merge, which is the next-best pick."
- Candidates compared: 18 (9 Beads, 9 Linear; 5 of them `work`, 13
  `personal`, all at stage `grill-me`).
- The report carried `not evaluated: github: dependencies and children`.

## Run 2: `--json`, without `--apply`

`bun plugins/autonomous/src/run.ts --account claude --json` exited 0. The
`select` step's data:

- `machineScope`: `personal`
- `selected`: Beads `agentic-task-2x0`, the same as run 1. It is among the 18
  reported candidates.
- `comparison`: `{ "model": "sonnet", "effort": "high" }`, tier `llm`
- `notEvaluated`: `["github: dependencies and children"]`

Exclusion counts per reason (683 excluded):

| Reason            | Count |
| ----------------- | ----- |
| classification    | 537   |
| taken             | 0     |
| labelled this run | 0     |
| unsupported stage | 145   |
| blocked           | 0     |
| split             | 1     |

`labelled this run` is 0 because no run used `--apply`. `blocked` is 0
because no task that passed the first four checks had an open blocker.

## Run 3: `taken` on the selected task

`bd label add agentic-task-2x0 taken` was run by hand. The task's labels were
`grill-me, monolab, personal, taken`. Then the run was repeated with `--json`:

- Beads `agentic-task-2x0` was excluded under `taken` and was not among the
  candidates.
- Candidates dropped from 18 to 17. Exclusions: classification 537,
  unsupported stage 145, taken 1, split 1.
- The run selected Linear `DOT-104` instead (scope `personal`, stage
  `grill-me`, tier `llm`, no exception), with the explanation that it is
  nearly finished, only needs its PR merged, and unblocks DOT-113 and DOT-114.

Afterwards, `bd label remove agentic-task-2x0 taken` was run by hand, and the
task's labels were back to `grill-me, monolab, personal`.

## Verdict

- The selected id was among the reported candidates in every run.
- With `taken`, the run no longer selected that task.
