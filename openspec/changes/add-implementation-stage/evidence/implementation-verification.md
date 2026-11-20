# Implementation stage verification

End-to-end checks of tasks 9.1–9.3. The plugin code under test is the feature worktree at
commit `6639718` (pull request #100), run from source; every tracker write had the user's
go-ahead in the Plannotator Inbox thread "add-implementation-stage (DOT-139) apply".

## 9.1 Bootstrap of `verify`

2026-11-16 22:46 UTC, with the loop stopped (no `loop.lock` or `run.lock` in
`~/.local/state/autonomous`, no `run.ts` process) and the user's configuration (Beads, four
GitHub repositories, Linear).

Before: `verify` absent from the four GitHub repositories and from Linear; `implement` present.

`bun plugins/autonomous/src/run.ts --bootstrap-labels --json`: exit 0,
`autonomous.bootstrap.v1`, outcome `advance`. Every label other than `verify` reported
`present`; Beads `not applicable — Beads needs no label creation: labels exist by use`.

| Scope                                   | Label    | Status    | Colour    |
| --------------------------------------- | -------- | --------- | --------- |
| `pabloimrik17/dotfiles`                 | `verify` | `created` | `#d6409f` |
| `pabloimrik17/kinkoi-project`           | `verify` | `created` | `#d6409f` |
| `pabloimrik17/monolab`                  | `verify` | `created` | `#d6409f` |
| `pabloimrik17/daily-agentic-task-force` | `verify` | `created` | `#d6409f` |
| Linear workspace                        | `verify` | `created` | `#d6409f` |

A second run (text report, exit 0) reported every label `present` in every scope. Read-back:
`gh label list --search verify` shows `verify #d6409f` in the four repositories, and
`linear label list` shows `verify #d6409f Workspace`.

## 9.2 Real task: DOT-121

Linear task DOT-121 ("Read GitHub blockers in the selection reader", `HITL`), draft
pull request #90 in `pabloimrik17/daily-agentic-task-force`, change `read-github-blockers`. The session ran
this feature worktree's code at commit `6639718` through the same kit as 9.3, with the user's full
configuration (four GitHub repositories, Linear). Attempt `linear:DOT-121:implement:1`.

### Launch

- Launched 2026-11-16 23:12 UTC. `record.json` shows `pending`, `created` and `started` at
  `2026-11-16T23:12:17.321Z`, `taken` added at the same instant, `agentArgs`
  `["--model","opus","--effort","high"]`, an `aoe` session (`d6b68f7eca7b4eaa`) and a `worktrunk`
  workspace on branch `feature/DOT-121-read-github-blockers-in-the-selection-re`.
- The raw dry run and launch outputs (`dryrun.json`, `launch.json`) were lost with the restart. The
  figures below were recovered from the orchestrator's transcript (`launch-recovered.txt`).
  Before the launch: state `Backlog`, labels `personal`, `HITL`, `implement`; pull request #90 had
  3 commits and was a draft; the worktree was up to date with its remote branch; no `loop.lock` or
  `run.lock` and no `run.ts` process.
- Dry run (`run.ts --task linear:DOT-121 --json`, no `--stage`): exit 0; `reconcile`, `capacity`,
  `quota-gate` and `launch` all `advance`. The launch detail: stage `implement`, input `supplied`,
  repository inferred from "Daily agentic task force", the branch above, and the fallback title
  `auto 🛠️ Read github blockers in (DOT-121)` because the name "Read GitHub blockers in selection"
  has 5 words and the limit is 1 to 4.
- Launch (`run.ts --apply --task linear:DOT-121 --json`, no `--stage`): exit 0, same four steps
  `advance`. Attempt `linear:DOT-121:implement:1` `started`, session `d6b68f7eca7b4eaa`,
  `workspace.created` `false` (the existing worktree was reused). `aoe session show` said
  `Running`.
- Labels after the launch: `personal`, `HITL`, `implement`, `taken`.

### Orchestration

The session started three teammates with no model or effort override, so each definition in
`.claude/agents/` decided:

| Teammate        | Definition               | Model    | Effort   |
| --------------- | ------------------------ | -------- | -------- |
| `reader-impl`   | `apply-implementer`      | `sonnet` | `high`   |
| `readme-writer` | `apply-writer`           | `sonnet` | `medium` |
| `types-impl`    | `apply-implementer-lite` | `sonnet` | `medium` |

The transcript's Agent calls confirm the three names and definitions and carry no `model` or
`effort`. The orchestrator itself ran with `--model opus --effort high`. The implementation ended
and the review was asked in the Plannotator Inbox at 2026-11-16 23:24 UTC, with all 10 tasks
checked, every repository check passing and 2003 tests.

### Commits

Five commits on pull request #90 after the proposal (`pr90-before-reconcile.json` lists eight in
total; the first three are the glossary, the proposal and the release note):

- `af11f8a` docs(autonomous): describe the GitHub blocker read (DOT-121)
- `2d6c4d6` feat(autonomous): read GitHub blockers in the selection reader (DOT-121)
- `4d1df77` feat(autonomous): drop the GitHub not-evaluated note from selection (DOT-121)
- `0ba3aad` test(autonomous): use the glossary's blocker wording (DOT-121)
- `23f28ae` docs(autonomous): check the DOT-121 integration tasks (DOT-121)

No commit was added during the review: the human approved it as it stood. `isDraft` is `true` in
`pr90-before-reconcile.json`.

### Review and transition

The computer restarted around 17 Nov while the session waited (F6). On 2026-11-20 16:15 UTC the
orchestrator ran `aoe session start`; the user asked for a guided review at 16:15 and answered
`Approve` at 16:20.

- Persist (`persisted.json`): 16:20:30 UTC, header `autonomous · implement ·
linear:DOT-121:implement:1 · stage summary saved`.
- Transition (`transition.json`): 16:21:20 UTC, `{"answer":["verify"],"by":"human"}`.
- Logbook (`logbook.json`): 16:21:32 UTC, pull request #90.
- Result (`result.json`): 16:21:46 UTC, `outcome` `completed`, with a one-sentence summary and four
  artifacts (`github.ts`, `github.test.ts`, the plugin README and the change's `tasks.md`).

### Comments

- Stage summary on DOT-121 (`comment.md`): the five commits, the checks (all pass on `23f28ae`,
  2003 tests), the deviations from the proposal, the decisions made while implementing, notes for
  the verify stage and suggested skills. Its main deviation: task 4.2 was run by calling the
  GitHub reader and selection directly with the real configuration, because the DOT-121 branch
  starts from an older `main`, where the quota gate expects OpenUsage v1 and `reconcile` rejects
  the newer `agentArgs` records. That note applies to the old base only: in today's reconcile, run
  with this change's code, the quota gate read the usage (`reconcile-apply.json`).
- Logbook comment on #90 (`logbook-comment.md`): marker `<!-- autonomous:logbook
linear:DOT-121:implement:1 -->`, `HITL`, `--model opus --effort high`, 2026-11-16 23:12 to
  2026-11-20 16:21 UTC (89 h 9 min), answered `verify`, five commits, then the sections What I did,
  Decisions (two mine, one the human's), Assumptions (`none`), Next stage and Implementation.

### Reconcile

Run at 2026-11-20 16:23 UTC, without `--stage` (see 9.3 finding F1).

- Dry run (`reconcile-dryrun.json`): `1 attempt observed`, `1 would-finalise`, `2 retained`,
  `nothing changed`. `linear:DOT-121:implement:1` stayed `started`, `stageNow` `verify`, `action`
  `finalised`, session `open`, `idle`, marker `{"ok":true}`.
- Apply (`reconcile-apply.json`): `1 finalised`, `2 retained`. The attempt went `started` to
  `completed`, `action` `finalised`, `stageNow` `verify`. `cleanups` is empty and `cleanup` in
  `record-after.json` is `null`, so no session removal was pending: a `completed` attempt means the
  session was removed (README, reconcile states). Read-back after the reconcile: `aoe session show
d6b68f7eca7b4eaa` says `Session not found` and `tmux has-session` finds no server
  (`session-after.txt`). `taken.removed` is
  `2026-11-20T16:23:18.057Z`. History: `pending`, `created`, `started`, `completed`.
- Steps after reconcile: `capacity` advance (`grill slots 1/1`, `work slots 1/4`); `quota-gate`
  advance (session window 9/100 percent, weekly 24/100); `launch` `wait` with
  `linear:DOT-121 is excluded: unsupported stage`. DOT-121 carries `verify`, which the launch step
  does not yet start.
- The two retained attempts, `github:pabloimrik17/daily-agentic-task-force#89:grill-me:1` and
  `github:pabloimrik17/dotfiles#228:proposal:1`, show `before` `retained` and `action` `none`: they
  were already retained and the reconcile did not change them.

Labels on DOT-121 (`linear-before-reconcile.json`, `linear-after-reconcile.json`): before
`personal`, `HITL`, `taken`, `verify`; after `personal`, `HITL`, `verify`. The state stays
`Backlog` in both. Pull request #90 is still a draft (`isDraft` `true`).

PASS: the stage ran from launch through a guided review and a human `Approve` to `verify`, with
five commits, the stage summary and logbook in place, `taken` removed by the reconcile and the pull
request still a draft.

### Findings

- **F5: the installed plugin cannot read `implement` attempts.** The installed release (2.3.0) has
  `STAGE_IDS = ["test", "grill-me", "proposal"]`
  (`~/.claude/plugins/cache/daily-agentic-task-force/autonomous/2.3.0/src/stages/stage.ts`, line
  13). Its `parseAttemptId` rejects an `implement` attempt id: `src/attempts/record.ts` line 131
  returns `null` when `isStageId(stage)` is false. Until the release with this change is
  installed, the loop and the installed `/autonomous:run` must not run against this state
  directory.
- **F6: a reboot kills an open session, and aoe's status goes stale.** The computer restarted
  around 17 Nov while the session waited for the review. The tmux session was gone, while
  `aoe session show` still reported `Starting` (text) and `running` (JSON). On 2026-11-20 16:15
  UTC `aoe session start` relaunched the agent with `--resume <the same conversation>` and passed
  the launch prompt again as a new turn. The stage then closed correctly: persist, transition,
  logbook and result at 16:20 to 16:21, and a clean finalise at 16:23. The plugin trusts the stale
  status: `plugins/autonomous/src/sessions/aoe.ts` maps `running` and `starting` to an open, busy
  session. A reconcile then observes an attempt with no result marker without retaining it, and
  keeps one with a marker `completing` without finalising it. Either way `taken` and the loop slot
  stay held with no notice. This was not reproduced end to end, because the reconcile ran after the
  restart. It is followed up in DOT-146.
- **F7: #90 now conflicts with `main`.** Its branch starts from an older `main`. On
  2026-11-20 `pr90-mergeable.json` reads `mergeable` `CONFLICTING` and `mergeStateStatus` `DIRTY`. The verify stage or a rebase deals with it.

Differences from the orchestrator's facts: none remain. The launch figures come from the
transcript, not from the lost raw outputs, and the section says so.

## 9.3 Sandbox cases

2026-11-16 22:49–23:08 UTC. The plugin is the feature worktree at commit `6639718`, run from
source. The kit is `~/.local/state/autonomous/implementation-verification`: the configuration is
narrowed to `pabloimrik17/grill-sandbox`, Linear is disabled, `runner.parallel` is `4`, and
sessions start through a wrapper that adds `--plugin-dir` for the worktree. The tasks are Beads
tasks with the `grill-sandbox` label. Cases 1, 3 and 4 are two-task OpenSpec changes on draft pull
requests #10, #11 and #12 in `pabloimrik17/grill-sandbox`. Case 5 uses a throwaway local
repository. Every launch used `agentArgs` `["--model","opus","--effort","high"]`. Where a report
and a raw output disagree, the raw output wins and the text says so.

### Case 1: an `AFK` task from launch to `verify`

Task `agentic-task-5srt`, change `sbx-happy`, pull request #10.

- The dry run said "would launch" (exit 0). The launch (exit 0) started
  `beads:agentic-task-5srt:implement:1` in a new worktree.
- The session ran 22:50 to 22:52 UTC (2 min). It made three commits: `e881a3c`, `6d15994` and
  `60b6261` (one per task, then the assumptions in `design.md`). It started one teammate:
  `general-purpose`, `model` `haiku`, `effort` `low`.
- It ran the transition itself: `{"answer":["verify"],"by":"agent"}`. It asked no question.
- It wrote `persisted.json` (stage summary), `logbook.json` and `result.json`
  (`outcome` `completed`). The logbook comment is on the pull request, which stayed a draft.
- Reconcile: `beads:agentic-task-5srt:implement:1` went `started` to `completed`, `action`
  `finalised`, `stageNow` `verify`, `marker` `{"ok":true}` (see F1 for how this reconcile was run).
- Labels: `AFK`, `grill-sandbox`, `personal`, `taken`, `verify` just before the reconcile. The
  raw labels before the launch were not captured. After the discard in F1, which removed `taken`,
  the labels were `AFK`, `grill-sandbox`, `personal`, `verify` (operator report; no raw file).

PASS: the task went from launch to `verify` with no question, three commits, one teammate, and the
stage summary and logbook in place.

### Case 2: the guards refuse the transition

Run on case 4's task `agentic-task-eiyr` (change `sbx-resume`) after its discard, with the
transition command and no `--apply`.

| Step | Setup                             | Exit | `outcome`       | Reason, verbatim                                   |
| ---- | --------------------------------- | ---- | --------------- | -------------------------------------------------- |
| 2a   | task 1.2 unchecked                | 3    | `not-evaluable` | `the change sbx-resume has 1 of 2 tasks unchecked` |
| 2b   | tasks checked, `tasks.md` dirtied | 3    | `not-evaluable` | `the working tree has 1 uncommitted change`        |

Both outputs have `applied` `false` and one reason only. The labels in both were `AFK`,
`grill-sandbox`, `implement`, `personal`, so nothing changed. The operator restored `tasks.md`
after 2b. The exit codes are from the operator's report; the raw files hold the `outcome`.

PASS: each guard refused alone, with its own reason, and left the labels as they were.

### Case 3: a blocked `AFK` orchestrator ends retained

Task `agentic-task-hvbv`, change `sbx-blocked`, pull request #11. `AGENTS.md` required
`sh scripts/check.sh` to exit 0 and forbade editing it. The script exits 1 with
`needs SANDBOX_DEPLOY_TOKEN` when the variable is unset.

- The session committed both tasks (`2009430`, `63cc11d`) and the assumptions (`2cd3dae`), pushed
  them, and wrote `persisted.json` and `logbook.json`. It wrote no `result.json` and did not
  transition. `scripts/check.sh` and `AGENTS.md` are unchanged.
- The stage summary reads "Blocked, not transitioned". It names the failing check and
  `SANDBOX_DEPLOY_TOKEN`, and lists the two decisions only a human can make.
- Reconcile (22:55): `beads:agentic-task-hvbv:implement:1` went `started` to `retained`, detail
  `session stopped; no result marker`. The launch step then waited with
  `beads:agentic-task-hvbv is excluded: taken`.
- Labels after the reconcile: `AFK`, `grill-sandbox`, `implement`, `personal`, `taken`.

PASS: the attempt ended retained, with `taken` kept, the blocker named and the work pushed.

### Case 4: a second attempt after a discard without `--release-workspace`

Task `agentic-task-eiyr`, change `sbx-resume`, pull request #12.

- Attempt 1 committed task 1.1 (`59d180b`), pushed, and was steered to leave task 1.2's README
  line uncommitted. The operator discarded it without `--release-workspace`. The discard removed
  the session and `taken` (`removed` `{"session":true,"taken":true,"workspace":false}`), and a
  discard comment went to the pull request. Labels: `AFK`, `grill-sandbox`, `implement`,
  `personal`. The worktree was kept, with the line `s4 marker two` uncommitted.
- The case 2 refusals ran here (above). The first launch of attempt 2 waited on a GitHub 503 (F2).
  The retry launched `beads:agentic-task-eiyr:implement:2` with `workspace.created` `false`.
- Attempt 2 committed the uncommitted line as `a38c20e`, then the assumptions as `eb975b8`. It did
  not redo task 1.1: `git log` holds one commit for it. It moved the task to `verify`
  (`{"answer":["verify"],"by":"agent"}`) and wrote `result.json` (`outcome` `completed`).
- Reconcile (exit 3, see F3): attempt 2 went `started` to `completed`, `action` `finalised`,
  `stageNow` `verify`. Attempt 1 stayed `discarded`.
- The pull request has one logbook comment per attempt: attempt 1 `discarded`, attempt 2 with
  its two commits. Labels at the end: `AFK`, `grill-sandbox`, `personal`, `verify`.

PASS: attempt 2 reused the worktree, committed the uncommitted line and did not redo checked work.

### Case 5: no update workflow

Task `agentic-task-sshb`, label `impl-sandbox-noupdate`, in a throwaway repository with neither
`.claude/skills/openspec-update-change/SKILL.md` nor `.claude/commands/opsx/update.md`.

- The dry run ended `wait` (exit 2). The launch step reason names both: `the repository
~/WebstormProjects/impl-sandbox-noupdate provides neither the skill
openspec-update-change (...) nor the command /opsx:update (...): update OpenSpec in that
repository` (home directory shortened).
- Labels before and after are identical: `AFK`, `impl-sandbox-noupdate`, `implement`, `personal`.
  No `taken`, no attempt directory, no session, no worktree.

PASS: the stage waited, and the reason names the skill and the command.

### Findings

- **F1: the case 1 reconcile used the wrong command.** The runbook ran the reconcile with
  `--stage implement`. A supplied `--stage` skips the unsupported-stage exclusion by design
  (README, launch step; `plugins/autonomous/src/select/candidates.ts`, `isUnsupportedStage`).
  The run finalised attempt 1, then launched `implement:2` on a task already in `verify`. The
  operator discarded it (`s1-attempt2-discard.json`). The correct reconcile omits `--stage`. That
  `--stage` does not check that the task carries the stage is a hazard noted for a follow-up, not
  fixed here. This is why case 1's labels in `s1-bd-after.json` still show `taken`: `implement:2`
  had just added it. The operator's final report marks case 1 "FAIL on reconcile"; the finalising
  itself is correct in the raw output.
- **F2: a transient GitHub 503.** The first launch of attempt 2 waited with
  `cannot look up the open pull request ... gh failed: HTTP 503`. It had no side effect (the
  attempt, `taken` and the worktree were unchanged). The retry launched.
- **F3: the case 4 reconcile exited 3.** The quota gate was `not-evaluable`, with reason
  `session window incomplete (no resetsAt)`, so the run stopped there. The reconcile step had
  already finalised attempt 2. The cause is the usage data, not the stage.
- **F4: `--discard --release-workspace` refuses finished attempts.** For attempts that were
  `completed` or `discarded` it returned `not-evaluable`:
  `attempt beads:agentic-task-eiyr:implement:2 is completed; nothing to discard` and
  `attempt beads:agentic-task-5srt:implement:2 is already discarded`. Their worktrees were removed
  by hand with `git worktree remove`. This agrees with stages reusing the workspace.
- **Side effect.** The `--apply` reconciles retained two older, unrelated attempts:
  `github:pabloimrik17/daily-agentic-task-force#89:grill-me:1` and
  `github:pabloimrik17/dotfiles#228:proposal:1` (`session stopped; no result marker`). These are
  local records only; no tracker was written.

Differences between the operator's reports and the raw output: the final report says attempt 2 of
case 4 "ended `finalised`"; the raw `state` is `completed`, and `finalised` is the `action`. The
reports give the case 1 and case 4 end labels and the exit codes of cases 2 and 4, which are not
in raw files.

### Cleanup

Case 3's retained attempt was discarded with `--release-workspace` (session, `taken` and worktree
removed). The case 1 and case 4 worktrees were removed by hand (F4). Beads tasks
`agentic-task-5srt`, `agentic-task-hvbv`, `agentic-task-eiyr` and `agentic-task-sshb` are closed.
Pull requests #10, #11 and #12 are closed, their remote and local branches deleted. The sandbox
clone is on `main` and clean, and the throwaway repository is removed. The kit stays in place, with
its GitHub repositories and Linear restored for 9.2.
