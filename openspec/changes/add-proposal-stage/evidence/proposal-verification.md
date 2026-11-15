# Manual verification of the proposal stage

Section 10 of `add-proposal-stage`, run from the worktree `feature/propose-stage`
with the plugin code at `5ff0ec1`, on 2026-11-15. The writes were authorised by the
user in the Plannotator Inbox thread "add-proposal-stage apply" at 10:32 UTC: the
bootstrap, the run on DOT-121, the six sandbox cases and the push. Times below are
UTC.

## Step 1 (10.1): bootstrap `implement`

`bun plugins/autonomous/src/run.ts --bootstrap-labels --json`, with the user's
configuration, at 10:35:47. Exit 0, nothing on stderr, `outcome: advance`.

| Source | Scope                                   | `implement`        | The other seven labels |
| ------ | --------------------------------------- | ------------------ | ---------------------- |
| Beads  | not applicable: labels exist by use     |                    |                        |
| GitHub | `pabloimrik17/dotfiles`                 | created, `#26b5ce` | present                |
| GitHub | `pabloimrik17/kinkoi-project`           | created, `#26b5ce` | present                |
| GitHub | `pabloimrik17/monolab`                  | created, `#26b5ce` | present                |
| GitHub | `pabloimrik17/daily-agentic-task-force` | created, `#26b5ce` | present                |
| Linear | workspace                               | created, `#26b5ce` | present                |

No label was recoloured, skipped or failed.

A second `--json` run and a text run, both exit 0, created nothing. The text report
of the third run, at 10:36:06:

```text
label bootstrap — started 2026-11-15T10:36:06.751Z
outcome: advance
  beads     not applicable — Beads needs no label creation: labels exist by use
  github    pabloimrik17/dotfiles: present work, personal, AFK, HITL, grill-me, proposal, implement, taken
  github    pabloimrik17/kinkoi-project: present work, personal, AFK, HITL, grill-me, proposal, implement, taken
  github    pabloimrik17/monolab: present work, personal, AFK, HITL, grill-me, proposal, implement, taken
  github    pabloimrik17/daily-agentic-task-force: present work, personal, AFK, HITL, grill-me, proposal, implement, taken
  linear    workspace: present work, personal, AFK, HITL, grill-me, proposal, implement, taken
```

An independent read-back, by a second agent with read-only commands, found
`implement` with colour `26b5ce` in the four repositories
(`gh label list -R <repo> --search implement --json name,color`) and in Linear with
`team: null`, which is a workspace label:

```json
{ "data": { "issueLabels": { "nodes": [{ "name": "implement", "color": "#26b5ce", "team": null }] } } }
```

## Setup for the runs on tasks

Paths: `$WS` is the workspace root (`workspace.root`, the shipped default), `$STATE`
is `$HOME/.local/state/autonomous`, `$KIT` is `$STATE/proposal-verification`,
`$TREE` is the worktree and `$DR` is the attempt directory of DOT-121,
`$STATE/attempts/linear/DOT-121/proposal/1`. The repository is public, so no absolute path appears here.
Quoted output has its paths rewritten to these variables and nothing else changed.

The user's configuration is managed by chezmoi and was not edited. As in the earlier
verifications, two local files stand in for it:

| File               | Mode | Content                                                                                                                                                           |
| ------------------ | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `$KIT/config.json` | 600  | The user's configuration plus `sessions` `{"tool": "claude", "profile": null, "binary": "$KIT/bin/claude"}`, with `sources.github.repos` narrowed to the sandbox. |
| `$KIT/bin/claude`  | 755  | A shell wrapper. It exports `AUTONOMOUS_CONFIG=$KIT/config.json`, then execs the user's `claude` shim with `--plugin-dir $TREE/plugins/autonomous "$@"`.          |

- `--plugin-dir` is needed because the installed plugin is 2.2.0, whose `src/stages`
  has no `proposal` directory.
- Versions: `claude` 2.1.325, `aoe` 1.14.0, `wt` v0.77.0, `gh` 2.100.0, `bd` 1.3.0,
  `bun` 1.4.4, `linear` 2.6.0, `openspec` 1.16.0.
- Every run below is the real `run.ts` with `--account claude@12101920`. The quota
  gate advanced in each one.

Three things were not ready at 10:57 and were settled with the user in the same
thread before any launch:

- **The sandbox had no OpenSpec.** `pabloimrik17/grill-sandbox` held only its
  `README.md`. With the user's go-ahead, `openspec init --tools claude` ran in the
  clone and its 27 files were committed on `main` and pushed as `87fac3e`.
- **DOT-121 inferred the wrong repository.** Its Linear project was `Dotfiles`, so
  the loop inferred the dotfiles repository, while the task's definition places the
  work in this one. No Linear project compared equal to `daily-agentic-task-force`.
  The user renamed the project "Agentic daily taskforce" to "Daily agentic task
  force" and moved DOT-121 into it. A dry run then reported
  `would launch proposal for linear:DOT-121 in $WS/daily-agentic-task-force`, with
  `inferredFrom: "Daily agentic task force"`. The 14 other issues of that project,
  all in Backlog, now infer this repository too.
- **The quota gate could not be evaluated.** At 10:41 and 10:44 two dry runs ended
  `quota-gate not-evaluable: openusage timed out after 120 s`, because OpenUsage
  spent its own 120 s refreshing one stale account. The user fixed the account; at
  10:58 `openusage claude` answered in 3 s. The plugin's timeout equals OpenUsage's
  refresh timeout, so one stale account stops every launch: a follow-up outside this
  change.

## Step 2 (10.2): the proposal stage on DOT-121

DOT-121, "Read GitHub blockers in the selection reader", is a real task of the
`HITL` kind. `$DR` is its attempt directory,
`$STATE/attempts/linear/DOT-121/proposal/1`. This run was the only one with the
user in the session for the whole stage.

### The task before the run

At 11:26 a read of the issue gave:

```json
{
    "data": {
        "issue": {
            "identifier": "DOT-121",
            "state": { "name": "Backlog", "type": "backlog" },
            "labels": {
                "nodes": [{ "name": "personal" }, { "name": "proposal" }, { "name": "HITL" }]
            },
            "project": { "name": "Daily agentic task force" }
        }
    }
}
```

The task is in Backlog, has the parent DOT-82 ("Autonomous loop", In Progress) and
no children, and has one comment, the grill's stage summary
(`autonomous · grill-me · linear:DOT-121:grill-me:1 · definition saved`). It has no
`taken`. The project is the one renamed in the setup.

### The dry run and the launch

The dry run at 11:26:12 (`--task linear:DOT-121 --stage proposal`, no `--apply`)
advanced all three steps and reported

```text
would launch proposal for linear:DOT-121 in $WS/daily-agentic-task-force on feature/DOT-121-read-github-blockers-in-the-selection-re as "auto 📝 Read github blockers in (DOT-121)"
name from the fallback: name "Read GitHub blockers in selection" must have 1 to 4 words, has 5
```

with `inferredFrom` `Daily agentic task force` and the group of the session
`Daily agentic task force`. The title is the fallback's, for the reason in finding
F1. The launch at 11:26:36 (`startedAt` of the run and `taken.added` of the record)
reported

```text
launched linear:DOT-121:proposal:1 as "auto 📝 Read github blockers in (DOT-121)" in $WS/daily-agentic-task-force-worktrees/feature-DOT-121-read-github-blockers-in-the-selection-re
```

The session is `070b124bc5864cce`, the branch
`feature/DOT-121-read-github-blockers-in-the-selection-re` and `workspace.created`
`true`. The record is `started`, `titleSource` `fallback`, `agentArgs` `["--model",
"opus", "--effort", "high"]`. The grill had left its glossary commit on a branch of
its own, `feature/DOT-121-read-github-blockers`. The launch does not use it: the
branch above is new.

### The prompt

`$DR/prompt.md` has the six sections of an `HITL` task: Context, Proposal, Working
with the human (HITL), Closing, Stage summary and Constraints. There is no "If you are
blocked" section and no "Working without a human (AFK)" section. The Context section
holds, in this order:

- Comments: one, the grill's stage summary comment, in full (`Where the work lives`,
  `Facts found in the grill`, `Rejected options`, `Suggested skills`).
- Parent: DOT-82, "Autonomous loop" (In Progress), with its URL, and under it the
  parent's description (the continuation context, the idea, the broader workflow
  still open).
- Related: DOT-110, "Run the grill-me stage and persist the confirmed result in the
  source task" (Done), with its URL.
- Project: `Daily agentic task force`.

No heading of an empty list is rendered: the task has no children and no blockers,
and the prompt has no section for either. The Closing section gives the four commands in order:
`--pull-request`, `--persist`, `--transition` and the logbook entry.

### What the session did

From its first command at 11:26:59, with the user as the human:

1. Read the prompt, looked for the change of an earlier attempt with `openspec list`,
   and read the selection reader's sources.
2. Cherry-picked the grill's glossary commit `a303d80` onto the branch at 11:27:46.
   It conflicted in `plugins/autonomous/GLOSSARY.md`; the agent placed **Open
   blocker** at the end of the selection section and continued. The commit is
   `e3f9a60`, `docs(autonomous): define open blocker (DOT-121)`.
3. Ran the skill `openspec-propose` at 11:28:07. It created the change
   `read-github-blockers` (proposal, design, `work-selection` spec delta, tasks),
   validated it with `openspec validate read-github-blockers --strict` and committed
   it by path at 11:30:11 as `be355ff`.
4. Pull-request mode at 11:31:00:

    ```text
    autonomous pull-request — started 2026-11-15T11:31:00.063Z
    outcome: advance
    attempt: linear:DOT-121:proposal:1
    task: linear DOT-121 → "Read GitHub blockers in the selection reader"
    branch: feature/DOT-121-read-github-blockers-in-the-selection-re
    base: main
    pull request: #90 opened, https://github.com/pabloimrik17/daily-agentic-task-force/pull/90
    title: "feat(autonomous): read GitHub blockers in the selection reader (DOT-121)"
    empty commit: none
    exit=0
    ```

5. The review, in rounds, through the Plannotator Inbox (finding F6): a message at
   11:31:41 asking for it, one correction from the user, a commit at 11:34:41
   (`d6e57ac`, `docs(autonomous): keep the DOT-121 release minor (DOT-121)`) and a
   message at 11:35:11 that named the commit and said the agent was still waiting for
   the user to call the review done. The correction removed the BREAKING label from
   the removal of `notEvaluated`: the release is a `feat(autonomous):` minor.
6. Wrote the stage summary and ran persist mode at 11:46:33:
   `description: not written`, `comment: posted, found`, receipt `$DR/persisted.json`.
7. Ran transition mode at 11:46:45, whose report carried the question:

    ```text
    autonomous transition — started 2026-11-15T11:46:45.679Z
    outcome: advance
    task: linear DOT-121 → "Read GitHub blockers in the selection reader" → labels [personal, proposal, HITL, taken]
    handoff: {"questions":[{"id":"transition:linear:DOT-121","step":"transition","header":"DOT-121","question":"linear DOT-121 \"Read GitHub blockers in the selection reader\": the proposal is ready. Approve it to move the task to implement?\nLabels: [personal, proposal, HITL, taken]","options":[{"label":"Approve","value":"implement","description":"Move the task to implement"},{"label":"Later","value":null,"description":"Leave the task in proposal"}],"multiSelect":false}],"remaining":0}
    exit=0
    ```

8. Showed the question with AskUserQuestion at 11:46:54. The user answered
   `Approve`, and the agent ran answer mode at 11:49:18:

    ```text
    autonomous answers — started 2026-11-15T11:49:18.905Z
    outcome: advance
      applied   transition:linear:DOT-121 → implement → added implement, removed proposal on linear DOT-121, read back
    exit=0
    ```

9. Wrote `logbook-entry.md` (175 words) and ran log mode at 11:49:39:
   `pull request: #90`, `body: 175 words`, `entry: published`, receipt
   `$DR/logbook.json`.
10. Wrote `result.json` (`outcome: completed`, six artifacts, `finishedAt`
    11:50:00).

The session printed five reports: `pull-request`, `persist`, `transition`, `answers`
and `log`. The approval came through AskUserQuestion and the answer mode, as
specified. The transition report's task line lists the labels read before the move
(finding F4).

`$DR/transition.json` is

```json
{
    "schema": "autonomous.transitioned.v1",
    "answer": ["implement"],
    "at": "2026-11-15T11:49:30.420Z",
    "by": "human"
}
```

The answer was applied at 11:49:30 and `by` is `human`, where the AFK cases have
`agent`.

### The pull request

`pabloimrik17/daily-agentic-task-force#90` is open and a draft, base `main`, head
`feature/DOT-121-read-github-blockers-in-the-selection-re`, titled
`feat(autonomous): read GitHub blockers in the selection reader (DOT-121)`. It is not
stacked on #56, as the definition asked: DOT-110 had merged into `main`, and the
stage summary says so under `Deviations from the task's definition`. It has three
commits, oldest first:

```text
e3f9a60 docs(autonomous): define open blocker (DOT-121)
be355ff docs(autonomous): propose reading GitHub blockers in selection (DOT-121)
d6e57ac docs(autonomous): keep the DOT-121 release minor (DOT-121)
```

The cover starts

```text
Task: [DOT-121](https://linear.app/monolab/issue/DOT-121/read-github-blockers-in-the-selection-reader)
Parent: `DOT-82`

### Problem

The GitHub selection reader sets `blockedBy` to null, so selection never excludes a GitHub task as blocked, while a blocked Linear or Beads task is excluded.
```

and continues with `### Solution`. The parent has no URL: the Linear CLI prints none.

The pull request has two comments. CodeRabbit's, at 11:31:38, says "Draft PR not
reviewed". The second is the logbook entry, created at 11:49:43:

```text
<!-- autonomous:logbook linear:DOT-121:proposal:1 -->
### 📝 proposal · attempt 1

`HITL` · `--model opus --effort high` · 2026-11-15 11:26 → 11:49 UTC (23 min) · answered `implement` · 3 commits (`d6e57ac`, `be355ff`, `e3f9a60`)
```

It continues with `### What I did`, `### Decisions` (four: three "mine", the last
"human"), `### Assumptions`, `### Next stage` and `### Proposal` (six files: the change's five
and the glossary).

### The task after the run

The stage summary comment on DOT-121, posted at 11:46:38, starts

```text
autonomous · proposal · linear:DOT-121:proposal:1 · stage summary saved

# DOT-121 proposal stage summary

The proposal is the OpenSpec change `read-github-blockers`, in draft pull request https://github.com/pabloimrik17/daily-agentic-task-force/pull/90 (branch `feature/DOT-121-read-github-blockers-in-the-selection-re`, base `main`).
```

Its sections are `Artifacts`, `Deviations from the task's definition`, `For the
implement stage` and `Suggested skills`. The task now has two comments, the grill's
and this one. The description is identical to the one read before the launch,
and the state is still Backlog.

| When                 | Labels                                      |
| -------------------- | ------------------------------------------- |
| Before the launch    | `personal`, `proposal`, `HITL`              |
| During the session   | the same plus `taken`                       |
| After the transition | `personal`, `HITL`, `taken`, `implement`    |
| After the reconcile  | `personal`, `HITL`, `implement`; no `taken` |

### The reconcile

The reconcile at 11:50:54 (`--task linear:DOT-121`, exit 2 because the launch step
then waits; the dry run at 11:50:47 said `1 would-finalise`):

```text
{"before":"started","state":"completed","session":{"state":"open","status":"idle","busy":false,"needsHuman":false},"marker":{"ok":true},"action":"finalised","detail":null}
```

The reasons are `2 attempts observed`, `1 finalised` and `1 retained`, the retained
one being case 3's attempt. `taken.removed` is 11:50:54 and `$DR/capture.txt` exists.
The launch step of that run reported `linear:DOT-121 is excluded: unsupported stage`
(finding F5). `finalised` with `cleanup: null` in the record means the reconcile
saved the capture, removed the session and released `taken`; a failed removal would
read `cleanup-pending`. `aoe session show 070b124bc5864cce` answers "not found".

The pull request stays open as real work: nothing of this step is cleaned up.

## Step 3 (10.3): the dry-run cases

The sandbox tasks are Beads tasks with the contract labels plus a repository label.

| Task                  | Case | Title                                                           | Labels                                         |
| --------------------- | ---- | --------------------------------------------------------------- | ---------------------------------------------- |
| `agentic-task-emz9`   | 5    | Sandbox: proposal dry run on a repository without OpenSpec      | `personal`, `AFK`, `proposal`, `agentic-task`  |
| `agentic-task-pj0f`   | 6    | Sandbox: README gains contributing and conduct sections         | `personal`, `AFK`, `proposal`, `grill-sandbox` |
| `agentic-task-pj0f.1` | 6    | Sandbox: README gains a Contributing section (child, closed)    | `personal`, `AFK`, `proposal`, `grill-sandbox` |
| `agentic-task-pj0f.2` | 6    | Sandbox: README gains a Code of conduct section (child, closed) | `personal`, `AFK`, `proposal`, `grill-sandbox` |

### Case 5: a dry run on a repository without OpenSpec

`run --account claude@12101920 --task beads:agentic-task-emz9 --stage proposal`, with
and without `--json`, at 10:59. The label `agentic-task` infers `$WS/agentic-task`,
which has no `openspec` directory. Both runs exit 2: `reconcile` advance,
`quota-gate` advance, `launch` wait.

```json
{
    "outcome": "wait",
    "reasons": [
        "the repository $WS/agentic-task has no OpenSpec root: $WS/agentic-task/openspec is not a directory"
    ],
    "repo": null,
    "ws": null,
    "attempt": null
}
```

No attempt directory was created, the task's labels were unchanged
(`AFK`, `agentic-task`, `personal`, `proposal`, no `taken`), and
`$WS/agentic-task/openspec` still does not exist. The task was then closed.

### Case 6: a split parent whose subtasks are closed

Supplied to launch (`--task beads:agentic-task-pj0f --stage proposal --json`), exit 2:

```json
{
    "outcome": "wait",
    "reasons": ["beads:agentic-task-pj0f is excluded: split"],
    "excluded": {
        "source": "beads",
        "id": "agentic-task-pj0f",
        "title": "Sandbox: README gains contributing and conduct sections",
        "reason": "split"
    }
}
```

A full selection run with no `--task` and no `--apply` (138 s, exit 0, all five
steps) lists the parent once in `excluded` with `reason: "split"` and once in
`readyToClose`; its closed children are in neither. The text report of the same run:

```text
  ready to close: 1 task
    beads → agentic-task-pj0f → Sandbox: README gains contributing and conduct sections
```

The task's status, labels and `updated_at` were identical before and after: the run
wrote nothing. The task stays open until the cleanup.

## Step 4 (10.3): the session cases

Four sandbox cases ran real sessions: cases 1, 3 and 4 with no human, in the table
below, and case 2 with the user in the session. Each was launched with
`run --apply --account claude@12101920 --task beads:<id> --stage proposal --json`
after a dry run of the same command. `$DN<n>` is the attempt directory
`$STATE/attempts/beads/<task id>/proposal/<attempt>`. Every steer typed into a session
started with "Verification run: nobody follows this session." (case 4's first attempt
had its own, below) and ended with the sentence that tells the agent to go straight on
to the next step of the prompt after each report. The agent's commands come from the
session transcript: the aoe capture holds only the visible lines.

| Task                | Case | Title                                          | Labels                                         |
| ------------------- | ---- | ---------------------------------------------- | ---------------------------------------------- |
| `agentic-task-h5fx` | 1    | Sandbox: README names the greeter's maintainer | `personal`, `AFK`, `proposal`, `grill-sandbox` |
| `agentic-task-jnmm` | 3    | Sandbox: README states the greeter's license   | `personal`, `AFK`, `proposal`, `grill-sandbox` |
| `agentic-task-7ob7` | 4    | Sandbox: README gains a one-line tagline       | `personal`, `AFK`, `proposal`, `grill-sandbox` |

The quota gate advanced in every run (session window 28%, weekly 54%). The
sandbox now holds OpenSpec, so the prerequisites passed.

### Case 1: an AFK task from launch to `implement`, with no question

Dry run at 11:07:42, then the launch at 11:07:56 (exit 0, three steps advance). The
launch step reported

```text
launched beads:agentic-task-h5fx:proposal:1 as "auto 📝 Sandbox readme maintainer line (agentic-task-h5fx)" in $WS/grill-sandbox-worktrees/feature-agentic-task-h5fx-sandbox-readme-names-the-greeter-s-maint
```

The title came from the LLM (`source: "llm"`). The session is `be0ab54bc7d74216`, the
branch `feature/agentic-task-h5fx-sandbox-readme-names-the-greeter-s-maint`, and the
workspace was created. The record is `started`, `agentArgs` `["--model", "opus",
"--effort", "high"]`, and `taken.added` is 11:07:56. After the launch the labels were
`AFK`, `grill-sandbox`, `personal`, `proposal`, `taken`. `$DN1/prompt.md` has the
sections Context, Proposal, Working without a human (AFK), Closing, Stage summary, If
you are blocked and Constraints.

What the session did, from its first command at 11:08:12:

1. Read the prompt, ran `openspec list`, read the README and the OpenSpec config, and
   ran the skill `opsx:propose` at 11:08:27. It named the change
   `readme-names-maintainer` and wrote its artifacts.
2. Committed the four files of the change by path and pushed, at 11:09:16. The
   commit list is one commit, `ba63c24 docs(openspec): propose readme-names-maintainer
   (agentic-task-h5fx)`. The branch differs from `origin/main` in the four files of
   `openspec/changes/readme-names-maintainer/` and nothing else.
3. Pull-request mode at 11:09:27:

    ```text
    autonomous pull-request — started 2026-11-15T11:09:27.237Z
    outcome: advance
    attempt: beads:agentic-task-h5fx:proposal:1
    task: beads agentic-task-h5fx → "Sandbox: README names the greeter's maintainer"
    branch: feature/agentic-task-h5fx-sandbox-readme-names-the-greeter-s-maint
    base: main
    pull request: #7 opened, https://github.com/pabloimrik17/grill-sandbox/pull/7
    title: "docs: name the maintainer in the README (agentic-task-h5fx)"
    empty commit: none
    exit=0
    ```

    No empty commit: the agent's commit was already ahead of `main`.

4. Wrote `stage-summary.md` and ran persist mode at 11:09:49: `description: not
   written`, `comment: posted, found`, receipt `$DN1/persisted.json`.
5. Ran transition mode at 11:09:58: `applied: true`, no handoff line.
   `$DN1/transition.json` is `{"schema":"autonomous.transitioned.v1","answer":["implement"],"at":"2026-11-15T11:09:59.553Z","by":"agent"}`.
6. Wrote `logbook-entry.md` and ran log mode at 11:10:13: `pull request: #7`,
   `body: 171 words`, `entry: published`, receipt `$DN1/logbook.json`.
7. Wrote `result.json` at 11:10:26: `outcome: completed`.

The commands include no `--answer`, no question to the human and no `Waiting` state.
The transition report's task line still lists the labels read before the move
(`labels [AFK, grill-sandbox, personal, proposal, taken]`).

The pull request is a draft against `main`, head the branch above, title
`docs: name the maintainer in the README (agentic-task-h5fx)`, with one comment. The
body starts with ``Task: `agentic-task-h5fx` `` and holds `### Problem` and
`### Solution`. The logbook entry, created at 11:10:17:

```text
<!-- autonomous:logbook beads:agentic-task-h5fx:proposal:1 -->
### 📝 proposal · attempt 1

`AFK` · `--model opus --effort high` · 2026-11-15 11:07 → 11:10 UTC (2 min) · moved to `implement` by the agent, with no answer · 1 commit (`ba63c24`)
```

It continues with `### What I did`, `### Decisions` (three, all "Mine"),
`### Assumptions`, `### Next stage` (`implement` (the task is AFK)) and `### Proposal`
(the four files). The listed commit is the one in `origin/main..HEAD`.

The stage summary comment on the task, posted at 11:09:50, starts

```text
autonomous · proposal · beads:agentic-task-h5fx:proposal:1 · stage summary saved

# Stage summary: beads:agentic-task-h5fx, proposal

## Where things stand

- The proposal stage is done. The task is AFK and moves to `implement`.
- OpenSpec change: `readme-names-maintainer`, in `openspec/changes/readme-names-maintainer/` (`proposal.md`, `design.md`, `tasks.md`, `.openspec.yaml`). `openspec validate readme-names-maintainer --strict` passes.
- Draft pull request: https://github.com/pabloimrik17/grill-sandbox/pull/7 on branch `feature/agentic-task-h5fx-sandbox-readme-names-the-greeter-s-maint`, base `main`.
```

Its sections are `Where things stand`, `Deviations from the task's definition`,
`Assumptions (also in design.md)`, `For the next agent (implement)` and `Suggested
skills`.

Persist and log run a second time at 11:11:10, before reconcile: both exit 0.
Persist reports `written.comment: "existing"` and log reports `entry: "existing"`.
The pull request still has one comment and the task one stage summary comment.

Labels:

| When                | Labels                                                      |
| ------------------- | ----------------------------------------------------------- |
| Before the launch   | `AFK`, `grill-sandbox`, `personal`, `proposal`              |
| After the launch    | the same plus `taken`                                       |
| After the reconcile | `AFK`, `grill-sandbox`, `implement`, `personal`; no `taken` |

The reconcile at 11:11:21 (`--task beads:agentic-task-h5fx`, exit 2 because the
launch step then waits, as expected for a task now in `implement`; the dry run at
11:11:17 said `1 would-finalise`):

```text
{"before":"started","state":"completed","session":{"state":"open","status":"idle","busy":false,"needsHuman":false},"marker":{"ok":true},"action":"finalised","detail":null}
```

The reasons are `1 attempt observed` and `1 finalised`. `taken.removed` is
11:11:21 and `$DN1/capture.txt` exists. The launch step of that run reported
`beads:agentic-task-h5fx is excluded: unsupported stage`, where the dry run's
reported `excluded: taken`. The task description was not changed.

### Case 3: a blocked AFK agent that ends retained

The description of `agentic-task-jnmm` contradicts itself on purpose: its Solution adds
the MIT licence and a `LICENSE` file, its Acceptance criteria say the greeter is
proprietary with no `LICENSE` file, and its Decisions record both as the owner's.

The dry run at 11:11:30 titled the session through the fallback (finding F1). The
launch at 11:11:41 reported

```text
launched beads:agentic-task-jnmm:proposal:1 as "auto 📝 Sandbox readme states the (agentic-task-jnmm)" in $WS/grill-sandbox-worktrees/feature-agentic-task-jnmm-sandbox-readme-states-the-greeter-s-lice
```

Session `f7dab03a2a244396`, branch
`feature/agentic-task-jnmm-sandbox-readme-states-the-greeter-s-lice`, workspace
created, record `started` with `taken.added` 11:11:41. The steer did not mention the
contradiction.

The session read the repository, found no change and no pull request, and did not
run `/opsx:propose`. It wrote `stage-summary.md` and ran persist mode at 11:12:31:

```text
autonomous persist — started 2026-11-15T11:12:31.180Z
outcome: advance
attempt: beads:agentic-task-jnmm:proposal:1
task: beads agentic-task-jnmm → "Sandbox: README states the greeter's license"
description: not written
comment: posted, found
receipt: $DN3/persisted.json
exit=0
```

It ran no pull-request, transition or log mode (`grep -c -- '--transition'` on the
transcript's commands: 0) and wrote no `result.json`. `ls $DN3` holds
`stage-summary.md`, `comment.md`, `persisted.json`, `prompt.md`, `record.json`, with
no `transition.json` and no `result.json`. No pull request exists for the branch
(`gh pr list --head <branch> --state all` returns `[]`) and the remote has no such
branch. The stage summary comment, posted at 11:12:32, starts

```text
autonomous · proposal · beads:agentic-task-jnmm:proposal:1 · stage summary saved

# Stage summary: beads:agentic-task-jnmm, proposal attempt 1 (blocked)

## Status

Blocked. No OpenSpec change was written, nothing was committed or pushed, no pull request was opened, and no transition was run. The task stays in `proposal`.
```

Under `What blocks the proposal` it tabulates the two sections that disagree and
says picking one "means overriding an explicit owner decision about legal terms".
Under `What a human must decide` it lists the two options and asks to correct the
Definition and rerun the stage.

The spec retains a session "once its session ends", and an idle session stays
`started`. The operator therefore ended it: `aoe session stop f7dab03a2a244396` at
11:13:44, status `Stopped`. The labels stayed `AFK`, `grill-sandbox`, `personal`,
`proposal`, `taken` throughout.

The reconcile at 11:13:48 (exit 2: the launch step waits; the dry run said
`1 would-retain`):

```text
{"before":"started","state":"retained","session":{"state":"exited","status":"stopped","busy":false,"needsHuman":false},"marker":{"ok":false,"reason":"no result marker"},"action":"retained","detail":"session stopped; no result marker"}
```

The reasons are `1 attempt observed`, `1 newly retained` and `1 retained`. The record
is `retained` at 11:13:48 with `retained.reason` `session stopped; no result marker`
and `taken.removed` null. The attempt stays for the cleanup.

### Case 4: a second attempt after a discard continues the same change and pull request

Attempt 1 launched at 11:14:05 (session `a7662eb120844ac4`, title `auto 📝 Add readme
tagline (agentic-task-7ob7)` from the LLM, workspace created) on branch
`feature/agentic-task-7ob7-sandbox-readme-gains-a-one-line-tagline`. The steer was an
interruption test: do the proposal, commit and push it, run pull-request mode, then
stop with no stage summary, persist, transition, log or result marker. The agent's
commit is `c99b8b0 docs(openspec): propose the README tagline change`. Pull-request
mode at 11:15:31:

```text
autonomous pull-request — started 2026-11-15T11:15:31.087Z
outcome: advance
attempt: beads:agentic-task-7ob7:proposal:1
task: beads agentic-task-7ob7 → "Sandbox: README gains a one-line tagline"
branch: feature/agentic-task-7ob7-sandbox-readme-gains-a-one-line-tagline
base: main
pull request: #8 opened, https://github.com/pabloimrik17/grill-sandbox/pull/8
title: "docs(readme): add a one-line tagline (agentic-task-7ob7)"
empty commit: none
exit: 0
```

`$DN4A` held `cover.md` and no `stage-summary.md`, `persisted.json` or `result.json`.
The worktree was clean, so the discard released it.

The discard, `run --apply --discard beads:agentic-task-7ob7:proposal:1
--release-workspace --json` at 11:16:17: exit 0, `outcome` `advance`, `removed`
`{"session": true, "taken": true, "workspace": true}`, `notes` `[]`, and the reasons

```text
session a7662eb120844ac4 removed
taken removed from beads:agentic-task-7ob7
attempt beads:agentic-task-7ob7:proposal:1 discarded
worktree $WS/grill-sandbox-worktrees/feature-agentic-task-7ob7-sandbox-readme-gains-a-one-line-tagline released
```

The record is `discarded` at 11:16:19. The discard published one comment on #8,
`$DN4A/logbook-discard.md`:

```text
<!-- autonomous:logbook beads:agentic-task-7ob7:proposal:1 -->
### 📝 proposal · attempt 1 · discarded

Discarded at 2026-11-15 11:16 UTC.
```

Attempt 2 launched at 11:16:36 (session `5c18ae72d1f24155`), on the same branch,
with the same title from the LLM. `workspace.created` was `true` (finding F3).
The attempt-2 prompt, line 56, reads: "This workspace's branch already has an open pull
request: #8 "docs(readme): add a one-line tagline (agentic-task-7ob7)",
<https://github.com/pabloimrik17/grill-sandbox/pull/8>. An earlier attempt of this task
opened it. Continue it: commit on this branch, and pull-request mode finds this pull
request".

The agent found the change from attempt 1 and ran no `/opsx:propose`. It validated the
change, which needed no correction, pushed (nothing new) and ran, from 11:17:27:

```text
autonomous pull-request — started 2026-11-15T11:17:27.640Z
outcome: advance
attempt: beads:agentic-task-7ob7:proposal:2
task: beads agentic-task-7ob7 → "Sandbox: README gains a one-line tagline"
branch: feature/agentic-task-7ob7-sandbox-readme-gains-a-one-line-tagline
base: main
pull request: #8 reused, https://github.com/pabloimrik17/grill-sandbox/pull/8
title: "docs(readme): add a one-line tagline (agentic-task-7ob7)"
empty commit: none
exit=0
```

Persist at 11:17:45 (`comment: posted, found`), transition at 11:17:51
(`applied: true`; `$DN2/transition.json` has `answer: ["implement"]`, `by: "agent"`,
at 11:17:53) and log at 11:18:04 (`#8`, `body: 201 words`, `entry: published`). The
checks after the session:

- `ls openspec/changes` holds one change, `add-readme-tagline`, and the diff against
  `origin/main` touches only `openspec/changes/add-readme-tagline`.
- `origin/main..HEAD` is the single commit `c99b8b0` of attempt 1: attempt 2 added
  no commit.
- One pull request exists for the branch (`gh pr list --head <branch> --state all`
  returns 1), and the transcript has no `opsx:propose` or `opsx/propose`.
- The first two lines of the comments on #8 are the two markers, attempt 1
  `### 📝 proposal · attempt 1 · discarded` and attempt 2 `### 📝 proposal · attempt 2`.
  The second entry's header is

    ```text
    <!-- autonomous:logbook beads:agentic-task-7ob7:proposal:2 -->
    ### 📝 proposal · attempt 2

    `AFK` · `--model opus --effort high` · 2026-11-15 11:16 → 11:18 UTC (1 min) · moved to `implement` by the agent, with no answer · no commits
    ```

    Its body begins "I picked up the OpenSpec change that attempt 1 committed in
    `c99b8b0` before it was discarded."

- The stage summary comment on the task starts
  `autonomous · proposal · beads:agentic-task-7ob7:proposal:2 · stage summary saved`.

Labels:

| When                             | Labels                                                      |
| -------------------------------- | ----------------------------------------------------------- |
| Before attempt 1                 | `AFK`, `grill-sandbox`, `personal`, `proposal`              |
| During attempt 1                 | the same plus `taken`                                       |
| After the discard                | `taken` removed (reason `taken removed from beads:...`)     |
| Attempt 2, before the transition | `AFK`, `grill-sandbox`, `personal`, `proposal`, `taken`     |
| After the transition             | `AFK`, `grill-sandbox`, `implement`, `personal`, `taken`    |
| After the reconcile              | `AFK`, `grill-sandbox`, `implement`, `personal`; no `taken` |

The reconcile at 11:18:46 (exit 2, the launch step waiting). The reasons are
`1 attempt observed`, `1 finalised` and `1 retained`, the last being case 3's attempt.
The two attempts of the task:

```text
{"id":"beads:agentic-task-7ob7:proposal:1","before":"discarded","state":"discarded","session":null,"marker":null,"action":"none","detail":null}
{"id":"beads:agentic-task-7ob7:proposal:2","before":"started","state":"completed","session":{"state":"open","status":"idle","busy":false,"needsHuman":false},"marker":{"ok":true},"action":"finalised","detail":null}
```

### Case 2: a `Later` answer leaves the session open and no entry

Task `agentic-task-72hp`, "Sandbox: README links to the releases page", labels
`personal`, `HITL`, `proposal`, `grill-sandbox`. Launched at 11:21:52 as
`auto 📝 Sandbox readme releases link (agentic-task-72hp)` (name from the LLM),
session `759067b586654d75`, branch
`feature/agentic-task-72hp-sandbox-readme-links-to-the-releases-pag`. Its prompt has
the six sections of an `HITL` task, with no "If you are blocked" section, and the
four commands in order: `--pull-request`, `--persist`, `--transition`, `--log`. The
operator typed nothing into this session; the user was the human.

The session committed and pushed the change `readme-links-releases-page`, opened the
draft pull request `pabloimrik17/grill-sandbox#9` with `--pull-request`, asked the
user for the review, ran `--persist` at 11:24:23 and `--transition` at 11:24:29:

```text
autonomous transition — started 2026-11-15T11:24:29.644Z
outcome: advance
task: beads agentic-task-72hp → "Sandbox: README links to the releases page" → labels [HITL, grill-sandbox, personal, proposal, taken]
```

The handoff of that report carries one question, header `approval`: `beads
agentic-task-72hp "Sandbox: README links to the releases page": the proposal is
ready. Approve it to move the task to implement?`, with the options `Approve`
(value `implement`) and `Later` (value null). The session showed it with
AskUserQuestion at 11:24:33 and the user answered `Later` at about 11:25. The agent
ran no answer mode, said the session stays open, and ended its turn.

Afterwards:

- The session printed three reports, `pull-request`, `persist` and `transition`, and
  no `autonomous answers` report.
- `$DN2` holds `comment.md`, `cover.md`, `persisted.json`, `prompt.md`, `record.json`
  and `stage-summary.md`: no `transition.json`, no `logbook-entry.md`, no
  `logbook.json`, no `result.json`.
- The pull request is a draft with no comment, so no logbook entry.
- The task's labels are `HITL`, `grill-sandbox`, `personal`, `proposal`, `taken`.
- The session is `Idle` and still listed.

The reconcile, dry and applied, only observes the attempt:

```json
{
    "before": "started",
    "state": "started",
    "session": { "state": "open", "status": "idle", "busy": false, "needsHuman": false },
    "marker": { "ok": false, "reason": "no result marker" },
    "action": "observed",
    "detail": null
}
```

The record keeps `state: "started"`, `taken.removed: null`, and no `cleanup` or
`retained`.

## Cleanup

- Discarded: the attempts still holding a task, with
  `run --apply --discard <attempt> --release-workspace --json`. Case 2's attempt
  (11:51:16, exit 0) removed its session `759067b586654d75` and `taken`, and released its worktree. The discard published one "discarded" entry on #9. Case 3's
  attempt (11:51:21, exit 0) removed its stopped session `f7dab03a2a244396` and
  `taken`, and released its worktree. It had no pull request, so no entry.
- Beads: closed `agentic-task-h5fx`, `-72hp`, `-jnmm`, `-7ob7` and `-pj0f`
  (`-emz9` was closed in case 5). Dolt pull, commit and push succeeded. No open
  `grill-sandbox` task is left.
- GitHub: pull requests `pabloimrik17/grill-sandbox#7`, `#8` and `#9` closed with
  the comment "Sandbox case of add-proposal-stage task 10.3; closed without merging."
  No branch deleted. They are still drafts. #7 and #9 hold two comments each, the
  entry or the discard and that one. #8 holds three: the two entries and that one.
- Worktrees: case 1's and case 4's were clean and removed with
  `wt remove --no-delete-branch --foreground`. Cases 2 and 3 were released by the
  discards. `wt remove` ran the user's `sync-claude` pre-remove hook before each
  removal. The hook changed nothing. `git worktree list` in the sandbox shows the
  main worktree only.
- aoe: the group `Grill sandbox` has no session. The 11 sessions before the
  discards became 9, none of them from this verification.
- Kit: `$KIT` removed. `chezmoi status` of the configuration file is empty, exit 0.
- Kept: the sandbox repository and its clone, the OpenSpec commit `87fac3e` on its
  `main`, the local branches of all four session cases, the remote branches of cases
  1, 2 and 4, the closed pull requests, the closed Beads rows, and the attempt
  directories as evidence. Also kept: DOT-121 in `implement`, pull request #90
  open, its branch and worktree, and `$DR`.

## Findings

**F1. The name fallback gives a truncated session title.** The LLM proposed
"Sandbox: greeter license in README" for case 3, which has five words where the
limit is four. The launch used the fallback, and the title is
`auto 📝 Sandbox readme states the (agentic-task-jnmm)`, the first words of the task
title cut mid-phrase. The report says so (`name from the fallback`, with the error),
and the record has `titleSource: "fallback"`. The behaviour is as specified. The
title is hard to read and no retry asks the LLM again. The same happened on DOT-121
in Step 2: the LLM proposed "Read GitHub blockers in selection", five words, and the
title is `auto 📝 Read github blockers in (DOT-121)`, with `titleSource: "fallback"`.
Two of the six launches that asked the LLM for a name got the fallback.

**F2. The blocked AFK agent also asked through the Plannotator Inbox.** The case 3
session called the Inbox's `send_message` and posted a `:::question` block, "MIT or
proprietary?", in a thread of its own. The prompt tells an AFK agent to ask no one
and to persist the blocker on the task, and it did persist the stage summary. The
question comes from the user's global instructions, which also reach a launched
session. It is not a defect of the plugin, but an AFK session cannot be made to ask
no one by its prompt alone: the stray question sits in the user's Inbox for a
throwaway task. A grill session did the same in the logbook verification of
`add-stage-pull-request-and-logbook`.

**F3. `workspace.created` is true on the second attempt.** Case 4's attempt 2 reported
a created workspace at the same path. The discard of attempt 1 used
`--release-workspace` and removed the worktree, so the launch recreated it from the
existing branch, which still held `c99b8b0`. The attempt continued the same change and the same
pull request either way.

**F4. The transition report lists the labels from before the move.** Its task line
shows `proposal` and no `implement` although `applied: true`. The labels are read
before the transition is applied. The task's labels afterwards, read separately,
have `implement`.

**F5. A task in `implement` is excluded as unsupported, not as taken.** After the
reconcile of case 1 the launch step of the same command waits with
`excluded: unsupported stage`, so the run exits 2. A dry run before the reconcile
reported `excluded: taken`. Both match the spec (`implement` is unsupported). An
operator should judge a reconcile by its step, not by the exit code.

**F6. An `HITL` session ran its review through the Plannotator Inbox.** In case 2
the agent asked the user for the review in an Inbox thread, twice, where the prompt
expects the review in the session. The approval question still came through
AskUserQuestion, as specified, and only there. As in F2, the cause is the user's
global instructions reaching the launched session. A user who answers the Inbox may
think the session is done while the approval question still waits in it: that
happened here for about a minute.

The DOT-121 session of Step 2 did the same. It sent three Inbox messages, at
11:31:41, 11:35:11 and 11:49:50, the first two for its review round and the last
only to say the stage was closed. The approval came through AskUserQuestion at
11:46:54, as specified, and the user answered it there at 11:49:30.

**F7. The Linear project name decides the repository.** DOT-121 could not run where
its definition says until the user renamed a project: the loop inferred `dotfiles`
from the project `Dotfiles`. The setup tells it. The inference compares the
project's name with the names of the repositories in the workspace, so the project
of a task must be named like its repository.
