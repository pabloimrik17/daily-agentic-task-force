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

## 11.2 Real task: DOT-121

2026-11-22 09:24–09:57 UTC. The task is Linear DOT-121, "Read GitHub blockers in the selection reader"
(`HITL`, state Backlog), with the draft pull request `pabloimrik17/daily-agentic-task-force#90` on
`feature/DOT-121-read-github-blockers-in-the-selection-re`. Its labels before the run were `HITL`,
`personal` and `verify`; it had three comments (the grill-me, proposal and implement summaries); the
worktree was clean with nothing unpushed. The plugin is this feature worktree at commit `c0cecb1`,
run from source. The kit is `~/.local/state/autonomous/implementation-verification`: its
configuration sets `sessions.binary` to the kit's `bin/claude`, which adds `--plugin-dir` for this
worktree, and `runner` `grills` 1, `parallel` 4. The loop was stopped (no `loop.lock`, no `run.lock`,
no `run.ts` process). The raw files are in `$EVID`,
`~/.local/state/autonomous/implementation-verification/evidence-11.2`, and are cited by number.
Where the operator's report disagrees with a raw file, the raw file wins and the text says so.

### Preflight and launch

- A read-only scout ran the preflight from 09:24:26 UTC (`00`). Two dry runs, `40` (with `--stage
  verify`, 09:26:28) and `41` (without `--stage`, 09:26:50), both exited 0 and gave the same
  `launch` step: `would launch verify for linear:DOT-121` on the DOT-121 worktree's branch, title
  `auto 🔍 Read github blockers in (DOT-121)` from the fallback, because the LLM name
  `Read GitHub blockers in selection` has 5 words and the limit is 4. Both show `input` `supplied`.
  After them no file under `attempts/` was newer than the preflight start and the labels were
  unchanged (`42`, `43`).
- The pre-launch check (`50`–`53`, `54` at 09:33:34) found the same labels, three comments, the pull
  request `OPEN`, draft, head `23f28ae`, a one-line clean worktree status, no lock, no attempt
  directory and no aoe session mentioning DOT-121.
- The launch (`--apply --task linear:DOT-121 --stage verify`, `55`, 09:33:41 UTC) exited 0. It
  created attempt `linear:DOT-121:verify:1`, state `started`, in the existing worktree
  (`workspace.created` `false`), with the aoe session `4f6645d3e6b44e06`. The record (`56`) holds
  `agentArgs` `["--model","opus","--effort","high"]`, and its history is `pending`, `created`,
  `started`, all at 09:33:41.456. The labels after the launch were `HITL`, `personal`, `taken`,
  `verify` (`58`). The agent session id is `b4c81b4c-3a00-451c-a2db-b8c9d3b47b7f` (`70`). The session
  received `Read <attempt directory>/prompt.md and follow it.` at 09:34:01 (`76`).
- The prompt (`57`, 43556 bytes) holds the branch's skill body: `skill body chars 4443 in prompt True`,
  no frontmatter. It names the change `read-github-blockers`, the draft pull request #90 and its URL,
  the verify and update workflows as skills, the scale with floor `CRITICAL`, the record path
  `~/.local/state/autonomous/attempts/linear/DOT-121/verify/1/findings.md`, `HITL`, the three
  closing commands in order and the rule to leave the pull request a draft. Every checked string
  counted at least once; the `AFK` section and the blocked section counted 0, as for `HITL`; `quick
  look` counted 0.
- Plugin loaded: the session ran `run.ts` four times (`80`: persist, transition, answer, log); all
  four use the path under this worktree and none mentions `plugins/cache`.

### The round

The session's tool calls (`75`, 37 of them: `Bash` 17, `Agent` 6, `mcp__plannotator__plannotator_inbox`
5, `Write` 3, `Skill` 3, `Read`, `ToolSearch` and `AskUserQuestion` 1 each) and the watch (`watch-11.2.log`)
give this order:

| Time (UTC)         | Who                                                                        | What                                                                                                                                                                                             |
| ------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 09:34:05–09:34:25  | orchestrator, `opus`, `high`                                               | Read the prompt, checked the branch and the attempt directory, saved the task definition.                                                                                                        |
| 09:34:38           | reporter `verify-runner`, `opus`, `medium`                                 | Ran `/openspec-verify-change` on `read-github-blockers` and checked the definition, read-only. Handback 09:37:39.                                                                                |
| 09:38:06           | orchestrator                                                               | Wrote the finding triage in `findings.md` (the watch saw the file at 09:38:08).                                                                                                                  |
| 09:38:16           | orchestrator                                                               | Sent the triage to the Inbox thread "DOT-121 verify" with a `:::question` (aoe `idle` from 09:38:23, `STALL` at 09:41:28, with only the idle reporter listed as an agent).                       |
| 09:41:40           | human                                                                      | Inbox answer: "Approve as proposed". The orchestrator marked the triage approved at 09:41:45.                                                                                                    |
| 09:41:54           | refuter `general-purpose`, `sonnet`, `low`                                 | One teammate for F1 and F2. Both survive, F2 "weak". Handback 09:42:24.                                                                                                                          |
| 09:42:37, 09:42:45 | fixers `verify-fixer`, `sonnet`, `low` (F1) and `medium` (F2)              | F1: renamed the two closed nodes of a fixture. F2: one `selectStep` test. Handbacks 09:43:17 and 09:43:28.                                                                                       |
| 09:43:25, 09:43:37 | fix checkers `general-purpose`, `haiku` `low` (F1) and `sonnet` `low` (F2) | Both `ACCEPT` at the first check. Handbacks 09:43:46 and 09:44:12.                                                                                                                               |
| 09:44:15, 09:44:49 | orchestrator                                                               | Committed each fix staged by path and pushed: `49bcda4` (F1), `717baa3` (F2).                                                                                                                    |
| 09:45:29–09:47:45  | orchestrator                                                               | Ran the eight repository checks and `openspec validate --strict`, then `gh pr checks 90` after a 60 s wait, and recorded the fixes in `findings.md`.                                             |
| 09:47:53           | orchestrator                                                               | Sent the outcome review to the same Inbox thread, with the pull request URL and a `:::question`.                                                                                                 |
| 09:48:06           | orchestrator                                                               | Wrote `stage-summary.md` (F3).                                                                                                                                                                   |
| 09:49:19           | human                                                                      | Inbox answer: "Yes, persist the summary and ask the transition".                                                                                                                                 |
| 09:49:29           | orchestrator                                                               | Ran `--persist`; the Linear comment was created at 09:49:37.                                                                                                                                     |
| 09:49:44–09:49:58  | orchestrator                                                               | Ran `--transition`, which asked the `AskUserQuestion` in the aoe session. aoe `waiting` from 09:49:59, `STALL` at 09:53:02.                                                                      |
| 09:53:48           | human                                                                      | Answered `Approve` in the session (aoe `running` at 09:53:49). The orchestrator ran `--answer 'transition:linear:DOT-121=code-review'` at 09:53:50.                                              |
| 09:54:12–09:54:34  | orchestrator                                                               | Wrote `logbook-entry.md`, ran `--log` (09:54:17; the pull request comment was created at 09:54:24), wrote the result marker (09:54:34) and sent the closing note to the Inbox thread (09:54:34). |

One reporter, one refuter, two fixers and two fix checkers ran: six agent ids, all distinct
(`72`: `reporter@session-b4c81b4c`, `refuter@…`, `fixer-f1@…`, `fixer-f2@…`, `checker-f1@…`,
`checker-f2@…`, each `teammate_spawned`). No fix checker shares an id with its fixer, and the
refuter is not the reporter. No teammate transcript holds a `git add`, `commit`, `push`, `checkout`,
`reset`, `restore` or `stash`: only the orchestrator committed. The orchestrator's own transcript
holds 70 assistant messages, all `claude-opus-5-5` at effort `high` (`70`).

The teammates' models and efforts, as the session reports them (`71`, the `Agent` inputs, and
`74b`, each teammate's own transcript, matched by `teamName` `session-b4c81b4c`; each assistant line
of a transcript carries `effort` and `perTurnEffort`, and all lines of one teammate agree):

| Teammate   | `subagent_type`   | Model passed | Effort passed | In its transcript             | Messages |
| ---------- | ----------------- | ------------ | ------------- | ----------------------------- | -------- |
| reporter   | `verify-runner`   | `opus`       | `medium`      | `claude-opus-5-5`, `medium`   | 39       |
| refuter    | `general-purpose` | `sonnet`     | `low`         | `claude-sonnet-5-5`, `low`    | 5        |
| fixer-f1   | `verify-fixer`    | `sonnet`     | `low`         | `claude-sonnet-5-5`, `low`    | 7        |
| fixer-f2   | `verify-fixer`    | `sonnet`     | `medium`      | `claude-sonnet-5-5`, `medium` | 9        |
| checker-f1 | `general-purpose` | `haiku`      | `low`         | `claude-haiku-5-5`, `low`     | 3        |
| checker-f2 | `general-purpose` | `sonnet`     | `low`         | `claude-sonnet-5-5`, `low`    | 5        |

The definitions in the DOT-121 worktree (`37`) read `verify-runner` `opus` `high` and `verify-fixer`
`sonnet` `high`; the values passed in the `Agent` calls decided, and the transcripts follow them.

The record of the findings (`findings.md`, `78`: round 1, subject branch HEAD `23f28ae` at the
report):

- Reported: R1 `SUGGESTION` (the closed-blocker fixture has two identical `CLOSED` nodes, "Blocker 3"
  and "Blocker 4", where task 1.2 and the scenario "GitHub closed blocker" ask for one completed and
  one not planned), R2 `SUGGESTION` (no step-level test shows that a cut-short GitHub list makes the
  step `not-evaluable`). The reporter listed two more items as out of scope for the stage, O1 and
  O2, with no severity. The scorecard: 10/10 tasks, 3/3 requirements, 13/13 scenarios; all 8
  acceptance criteria met; no non-goal done; no `CRITICAL`, no `WARNING`.
- Triage the human approved as proposed: F1 from R1 and F2 from R2, both to fix now (below the
  floor, so optional); F3 from O1 (a stale `repository` comment at `select/types.ts:15`) and F4
  from O2 (the reader repeats the tracker's argument building, which design decision D1 accepts),
  both passed on to code review. The record's own words for F3 and F4 severity are `—`.
- Refutation: F1 survives; its reproduction is the text of task 1.2 and the scenario beside the
  fixture. F2 survives, "weak"; its reproduction is the "cut short" scenarios beside tests that
  stop at the reader's `list()`, with the caveat that `step.ts:59-61` maps any failed read to
  `not-evaluable` and a generic test covers that.
- Fix checks: both `ACCEPT`, first check. F2's reproduction test fails with the `totalCount` check
  disabled and passes with it (verified by the fixer and the checker). The F2 checker noted that the
  test covers `blockedBy` only.
- Outcome: fixed F1 and F2; refuted, deferred, dismissed: none; proposed follow-up tasks: none.

Commits (`79`, `81`): `49bcda4` `test(autonomous): name the closed blockers by close reason
(DOT-121)`, committed 09:44:19, one file (`github-blocker-closed.json`, 2 lines), and `717baa3`
`test(autonomous): run selection over a cut-short GitHub blocker list (DOT-121)`, committed 09:44:52,
one file (`step.test.ts`, 23 insertions, 1 deletion). Neither carries `!` or `BREAKING CHANGE`. The
remote head (`79-remote-head.txt`), the worktree HEAD and the pull request's `headRefOid` are all
`717baa38de089db69820d7be54a39b6b1f29c20e`; the worktree status line shows no `[ahead`. The
pull request is `OPEN` and a draft (`81`, `95`). `git ls-files | grep -cE
'findings|stage-summary|logbook-entry'` in the worktree returns 2: `plugins/stonks/src/checks/findings.ts`
and `findings.test.ts`, added by `5e35379 feat(stonks): add the stonks plugin (#26)`. None comes
from this run (F8).

The stage summary comment (`83`; the file `comment.md` is its header, a blank line and
`stage-summary.md` unchanged):

- DOT-121 has 4 comments (3 before and 1 new, created 09:49:37). The new comment's first line is
  `autonomous · verify · linear:DOT-121:verify:1 · stage summary saved`, followed by a blank line.
  The description's sha256 is `a00f3aec…3102`, the same as before the run (`03`, `82`).
- It names the pull request URL, the change `read-github-blockers`, both commits with their
  subjects, F1 and F2 as fixed with their reasons, "Refuted, deferred, dismissed: none", F3 and F4
  and the checker's note under "Code review", "Nothing passed on" under "QA", "None" under proposed
  follow-up tasks and under deviations from the proposal, the checks on `717baa3`, and the next
  stage's notes. It holds no `/Users/` path.

The logbook comment (`84`): the pull request has 4 comments, 3 of them logbook entries (proposal,
implement, verify); the new one was created at 09:54:24 and starts with
`<!-- autonomous:logbook linear:DOT-121:verify:1 -->`, then `### 🔍 verify · attempt 1` and the line
`` `HITL` · `--model opus --effort high` · 2026-11-22 09:33 → 09:54 UTC (20 min) · answered `code-review` · 2 commits (`717baa3`, `49bcda4`) ``.
Its sections are `### What I did`, `### Decisions`, `### Assumptions` (`none`), `### Next stage` and
`### Verification`, which lists the fixed findings with their commits by subject and says refuted,
deferred and dismissed are none. It has 232 words (the limit is 300) and no `/Users/`.

The markers in the attempt directory (the file times of `61` are local time; converted to UTC):

| File                 | Time (UTC) | Content                                                                             |
| -------------------- | ---------- | ----------------------------------------------------------------------------------- |
| `prompt.md`          | 09:33:54   | 43556 bytes.                                                                        |
| `findings.md`        | 09:47:54   | First written 09:38:08; the record of the findings.                                 |
| `stage-summary.md`   | 09:48:06   | Written before the human's outcome answer (F3).                                     |
| `comment.md`         | 09:49:35   | The comment as posted.                                                              |
| `persisted.json`     | 09:49:38   | `autonomous.persisted.v1`, header as above, `at` 09:49:31.480.                      |
| `transition.json`    | 09:54:05   | `autonomous.transitioned.v1`, `answer` `["code-review"]`, `by` `human`.             |
| `logbook-entry.md`   | 09:54:12   | The entry's body.                                                                   |
| `logbook-comment.md` | 09:54:23   | The comment as published.                                                           |
| `logbook.json`       | 09:54:25   | `autonomous.logged.v1`, pull request 90, `at` 09:54:18.829.                         |
| `result.json`        | 09:54:34   | `autonomous.result.v1`, `outcome` `completed`, 3 artifacts, `finishedAt` 09:54:34Z. |

The closing order holds: `persisted.json` before `transition.json` before `logbook.json` before
`result.json`. The receipts' `at` is the run's start (`persist/persist.ts`, `report.startedAt`), so
it precedes the comment's creation by 6 s; each receipt file was written after its comment (09:49:38
after 09:49:37, 09:54:25 after 09:54:24). The session was `idle` before the reconcile (`62`), the
record still `started` with `taken.removed` `null`.

The task's labels (`02`, `43`, `58`, `85`, `94`):

| Moment              | Labels                                     |
| ------------------- | ------------------------------------------ |
| Before the launch   | `HITL`, `personal`, `verify`               |
| After the launch    | `HITL`, `personal`, `taken`, `verify`      |
| After the session   | `HITL`, `code-review`, `personal`, `taken` |
| After the reconcile | `HITL`, `code-review`, `personal`          |

No Linear issue was created after 09:33:00 UTC (`86`, all teams, archived included): no follow-up
task. The relations of DOT-121 equal those before (`87` against `30`: `related` DOT-110). The four
GitHub issue lists equal their baselines (`88` against `29`). The `verify` label was removed and
`code-review` added by the transition; the watch polled the labels every two minutes and printed
one `LABELS` line only (09:34:32), so the swap was seen afterwards, in `85`.

### The reconcile

Without `--stage`, with `--task linear:DOT-121` (a `--stage` would skip the unsupported-stage
exclusion and launch a second attempt, as in 9.3 F1). Both runs exited 2, the exit of a `wait`:

| Run            | Time (UTC) | `verify:1` row                                                           | Reconcile step reasons                                                    | Launch step                                             |
| -------------- | ---------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------- |
| Dry run (`90`) | 09:56:16   | `started`, `started`, `finalised`, marker ok, `stageNow` `code-review`   | `1 attempt observed`, `1 would-finalise`, `2 retained`, `nothing changed` | `wait`: `linear:DOT-121 is excluded: taken`             |
| Apply (`91`)   | 09:56:28   | `started`, `completed`, `finalised`, marker ok, `stageNow` `code-review` | `1 attempt observed`, `1 finalised`, `2 retained`                         | `wait`: `linear:DOT-121 is excluded: unsupported stage` |

The row's session was `open`, `idle`, not busy, needing no human, in both. Each run lists 25
attempts: 24 with `action` `none` (the two retained ones, `#89` and `dotfiles#228`, among them) and
this one. The dry run saved nothing. After the apply (`92`–`96`): the record is `completed`, its
history `pending`, `created`, `started`, `completed` (09:56:28.370), `taken.removed` is the same
time, `cleanup` and `retained` are `null`; `aoe session show 4f6645d3e6b44e06` exits 1 with `Error:
Session not found`; `aoe list` has no session mentioning DOT-121 (count 0); the labels are as in
the table; the pull request is `OPEN`, a draft, head `717baa3`. `capture.txt` is now in the attempt
directory. A read-back by an independent checker (`98`) passed all 16 of its checks: labels, the 4
comments, the description hash, the pull request's state, head and 3 logbook comments, the worktree
status and the two commits on top, the session's removal, the record, no issue created since
09:33:00, no `run.ts` process and no lock.

PASS: the verification stage ran on a real `HITL` task from this branch's code. The launch created
the attempt and the session with `--model opus --effort high` and the prompt held the branch's skill;
one round ran the report, the finding triage the human approved before the refutation, the
refutation, two fixes by teammates other than their checkers, two fix checks and two commits by
the orchestrator alone, one per finding, pushed; the repository's checks passed; the human reviewed
the outcome and approved the transition; the stage summary and the logbook entry were posted in the
specified order, the markers closed in order, the pull request stayed a draft and the reconcile
removed the session and the `taken` label. The departures from the prompt's order are in F3.

### Findings

- **F1: the `HITL` stops that need an answer went to the Plannotator Inbox, and the triage gate
  held.** The prompt says "show the human"; it names no channel. The session sent the triage (09:38:16)
  and the outcome review (09:47:53) to the Inbox thread "DOT-121 verify" and waited for the replies,
  which the user's global Plannotator rule asks for (the session's first calls after spawning the
  reporter were `ToolSearch` and an Inbox `read_thread`, 09:34:41–09:34:44; that the rule caused
  them is not established by a raw file). The session went `idle` after the triage (09:38:23) and
  started no refuter until the human's answer (09:41:40); the first refuter `Agent` call is
  09:41:54.873, so no refutation began before the answer. Both questions carried `:::question`
  blocks with a recommendation, and the answers were the recommended choices. The gate the spec asks
  for ("the human sees the finding triage before any refutation starts") held.
- **F2: the approval question needed the human inside the aoe session.** The transition's question
  is an `AskUserQuestion` (`transition/mode.ts`, `approvalQuestion`), so it did not go to the Inbox
  with the other two stops. It waited from 09:49:58 to 09:53:48 (aoe `waiting`, `STALL` at 09:53:02,
  3 min 50 s). The Inbox question before it told the human the transition would ask. The orchestrator's
  account is that the human attached with `aoe session attach` to answer; no raw file records the
  attach. The two channels split one stage's three stops between two places.
- **F3: `stage-summary.md` was written before the human answered the outcome review.** The prompt's
  closing steps are in order, "Never skip or reorder a step": review the outcome and "go on only when
  the human is done with it", then write the stage summary and run persist. The file was written at
  09:48:06, 12 s after the question was sent and 74 s before the answer (09:49:19); persist ran after
  the answer (09:49:29), and the file was not changed afterwards (its time is 09:48:06 and the
  comment equals it). The human asked for no change, so the posted content is the same as if the
  order had been kept; the order is not.
- **F4: one refuter covered two findings.** The skill leaves the number of teammates per phase to the
  orchestrator ("You choose how many teammates each phase takes") and asks that teammates try to
  refute each finding; both findings got their own outcome and reproduction, so this is no departure.
  Two points are recorded. The refuter said it had not opened `runJson` (`cli-json.ts`) and had not
  confirmed that the throw comes back as a failed read, and rated F2 "weak"; the record keeps the
  "weak" and the caveat. The refutation's reproductions for both findings are text beside a place,
  not a failing test, which the skill allows when a test cannot show it.
- **F5: the two fixers shared one worktree and ran at the same time.** Fixer-f1 ran from 09:42:55 to
  09:43:16 and fixer-f2 from 09:42:55 to 09:43:27. Fixer-f2's mutation check changed
  `readers/github.ts` (`if (false && …)`) and restored it from a backup; its handback says the
  `github-blocker-closed.json` change in the tree was fixer-f1's. Neither commit holds `github.ts`
  (`49bcda4` holds the fixture only, `717baa3` `step.test.ts` only). Fixer-f1 reported 38 reader tests
  passing; whether the mutation window overlapped its run is not established. The skill and the spec
  say nothing about teammates sharing a tree.
- **F6: the runbook's `subagents/` directory does not exist.** The runbook expected
  `${T%.jsonl}/subagents/*.meta.json` and `*.jsonl`. The session directory holds only `tool-results/`;
  the teammates' transcripts are sibling `.jsonl` files in the project directory, found by
  `teamName` `session-b4c81b4c` and mapped in `74b-teammate-transcripts.txt`. `73-subagent-meta.jsonl`
  and `74-subagent-models.txt` hold only `no such file` errors. The models and efforts above come from
  `71` and from the transcripts. In 11.3 no effort was passed (case 1); here every transcript line
  records one, and it equals the `Agent` input.
- **F7: the PR still conflicts with `main`.** `mergeable` `CONFLICTING` and `mergeStateStatus`
  `DIRTY` at the preflight (`04`) and `CONFLICTING` after the run (`81`). The stage's boundary leaves
  that to the human (9.2 F7), and the session neither mentioned nor changed it.
- **F8: the tracked-file grep found 2 files, not 0.** They are
  `plugins/stonks/src/checks/findings.ts` and `findings.test.ts`, added by `5e35379`, unrelated to
  this run. No attempt file is tracked: the record stayed outside the repository.
- **F9: the live label swap was not seen.** The watch printed one `LABELS` line; the poll every two
  minutes did not catch the swap between 09:54:05 and the end. `85` shows it afterwards. The attempt's
  `transition.json` and the label state agree.
- **Differences between the operator's report and the raw files:**
    - the report says `73-subagent-meta.exit` is 0 "because of the loop"; the file reads 2;
    - the report says "the other 25 attempts" have `action` `none` in the apply; `91` lists 25
      attempts in all, 24 with `none` and the DOT-121 one `finalised`.
- **Not seen in this run.** No exit 3 at the quota gate (capacity at every run: session 36–70%,
  weekly 6–10%). The reconcile did not repeat 9.3 F1 (no `--stage`, nothing launched). The launch
  exclusion read `taken` in the dry run and `unsupported stage` after the apply, as in 11.3 F3.
  No follow-up task, no rejected fix, no question about changing the proposal and no uncommitted
  change needing the human arose, so those prompt branches were not run.

## 11.3 Sandbox cases

2026-11-21 11:11–11:16 UTC (setup, launch and the case 1 session) and 2026-11-22 09:02–09:06 UTC
(checks, reconcile, case 2 and cleanup). The plugin is the feature worktree at commit `1b57aa3`, the
commit the preflight recorded, run from source. The kit is `~/.local/state/autonomous/verification-sandbox`:
its configuration disables Linear, narrows GitHub to `pabloimrik17/grill-sandbox`, keeps Beads and
sets `runner.parallel` to `2`. Its wrapper `bin/claude` adds `--plugin-dir` for the worktree and
exports `AUTONOMOUS_CONFIG` and `AUTONOMOUS_STATE`, so the attempts live under the kit's own
`state/`. It is separate from the 9.3 kit because 11.2 runs through that kit on the real tracker
and its live session reads that configuration on every `/autonomous:run`; narrowing it would have
broken 11.2. A separate state directory also keeps the reconcile away from every other attempt (the
9.3 side effect). The 9.3 kit's wrapper was only re-pointed to this worktree, and its
configuration was not touched.

The tasks are Beads tasks. Cases 1, 2 and 4 use task `agentic-task-wnc2` and the change
`sbx-verify-greeter` on the draft pull request `pabloimrik17/grill-sandbox#13`. Case 3 uses task
`agentic-task-p6t9` and a throwaway local repository. The launch used `agentArgs`
`["--model","opus","--effort","high"]`. The raw files of the first operator turn (setup, case 3,
the case 1 launch and case 4) were lost to a reboot (F1), so those cases come from the outputs the
operator saw, taken from its transcript. The files of the second turn (the reconcile, case 2 and
cleanup) are kept. Where a report and a raw output disagree, the raw output wins and the text says
so.

### Case 1: an `AFK` task from launch to `code-review`

Task `agentic-task-wnc2`, "Sandbox: verify greeter happy path", labels `AFK`, `grill-sandbox`,
`personal`, `verify`. Branch `feature/agentic-task-wnc2-sandbox-verify-greeter-happy-path`, with two
pushed commits: `927e16c` `docs(openspec): propose sbx-verify-greeter (agentic-task-wnc2)` and
`1d22bff` `feat(greeter): add the greeter and its checks (agentic-task-wnc2)`. Pull request
`pabloimrik17/grill-sandbox#13`, a draft.

The planted mismatch: the change has a requirement "Version flag" (`greet 1.0.0` and exit 0 for
`--version`) and a requirement that `scripts/test.sh` checks every scenario, and all its tasks are
ticked. `1d22bff` has no `--version` branch and `scripts/test.sh` has no version check. Before the
fix, `sh bin/greet.sh --version` printed `Hello, --version!`.

Launch (from the transcript):

- The dry run `--task beads:agentic-task-wnc2 --stage verify` exited 0 and said `would launch
  verify for beads:agentic-task-wnc2 in ~/WebstormProjects/grill-sandbox on
  feature/agentic-task-wnc2-sandbox-verify-greeter-happy-path as "auto 🔍 Sandbox greeter
  verification (agentic-task-wnc2)"`, with the note `name inferred by the LLM`.
- The launch (`--apply`, same arguments) exited 0 at 2026-11-21 11:13:07 UTC. It created attempt
  `beads:agentic-task-wnc2:verify:1`, state `started`, in a new worktree
  (`workspace.created` `true`), with the aoe session `591a661e39b44ae9`. The record holds
  `agentArgs` `["--model","opus","--effort","high"]`.
- The first snapshot, 21 seconds after the launch (11:13:28 UTC): session `running`, the attempt
  directory held only `prompt.md` and `record.json`, the branch held only the two fixture commits.

The session (the transcript `e25afc0a-372a-4a90-bc15-d8f6fc8dde5f`) ran from its first call at
11:13:22 UTC to `result.json` at 11:16:27 UTC; the logbook entry states `11:13 → 11:16 UTC
(3 min)`. Its tool calls were `Agent` (4), `Bash` (13, and one more after the re-prompt), `Skill` (3) and
`Write` (2); none was a question to the human. The two snapshots read `running` (11:13:28 UTC) and `idle` (2026-11-22 09:04:40 UTC);
none read `waiting`.

The round, from `findings.md` (the record of the findings), the timeline of the session's tool calls
and the teammates' transcripts:

| Time (UTC) | Who                                     | What                                                                                                                                |
| ---------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 11:13:37   | reporter, `general-purpose`, `sonnet`   | Invoked the skill `openspec-verify-change` on `sbx-verify-greeter` (11:13:40) and checked the task's definition. Handback 11:14:05. |
| 11:14:37   | orchestrator, `opus`                    | Wrote the finding triage in `findings.md` (below).                                                                                  |
| 11:14:43   | refuter "Refute finding F1", `haiku`    | Added `check 'greet 1.0.0' --version` to `scripts/test.sh` and ran it: it failed, `rc=1`. Handback 11:14:53, "F1 survives".         |
| 11:15:01   | fixer "Fix finding F1", `haiku`         | Edited `bin/greet.sh` only; the refuter's test line stayed. Handback 11:15:08.                                                      |
| 11:15:19   | fix checker "Fix check for F1", `haiku` | A different teammate from the fixer (its own agent id). Verdict `ACCEPT`, no change to the repository. Handback 11:15:29.           |
| 11:15:31   | orchestrator                            | Committed `bin/greet.sh` and `scripts/test.sh` as `3c24b75` and pushed.                                                             |

The teammates' types and models are as the transcript records them: every `Agent` call has
`subagent_type` `general-purpose` and a `model` of `sonnet` (the reporter) or `haiku` (the other
three); the teammates' own transcripts record `claude-sonnet-5-5` and `claude-haiku-5-5`, and the
orchestrator's `claude-opus-5-5`. The `Agent` inputs hold only `description`, `model`, `prompt` and
`subagent_type`: no effort was passed. Each teammate's `.meta.json` holds `pickedEffortModel`
`claude-opus-5-5`; what that field stands for is not established. The orchestrator triaged the
findings itself and started no teammate for it. One fix check ran for the one fix.

The record `findings.md` (round 1, subject `1d22bff`, a clean working tree at the start):

- Reported by the reporter: R1 `CRITICAL` (`--version` not implemented, `bin/greet.sh:3-4`),
  R2 `CRITICAL` (`scripts/test.sh:14-15` has no `--version` check and exits 0), R3 `WARNING`
  ("exit non-zero when a check fails" only partly supported, a consequence of R2), R4
  `SUGGESTION` (`check()` captures only stdout).
- Triage: F1 from R1, R2 and R3, one root cause, severities kept as reported, destination fix.
  F2 from R4, below the floor, dismissed without a refutation, because `set -eu` in
  `scripts/test.sh` aborts when the greeter exits non-zero, so the exit status is checked.
- Refutation of F1: survives. Reproduction: the new `check 'greet 1.0.0' --version` fails with
  `FAIL: greet --version: expected "greet 1.0.0", got "Hello, --version!"`, `rc=1`.
- Fix check 1 of F1: `ACCEPT`. The test fails against the old greeter (`rc=1`) and passes with the
  fix (`rc=0`), and the diff is limited to the branch and one test line.

The fix and its check run (`3c24b75`, `fix(greeter): add the --version flag and its check
(agentic-task-wnc2)`, pushed): `git log` shows the three commits `3c24b75`, `1d22bff`, `927e16c`;
the working tree was clean; `0` commits were unpushed; `sh bin/greet.sh --version` printed
`greet 1.0.0`; `sh scripts/test.sh` printed `all checks passed` and exited `0`; `0` of the
repository's tracked files match `findings`, `stage-summary` or `logbook-entry`, so the record
stayed outside the repository. The session ran that test after the push and listed it as the only
check the repository defines.

The markers in the attempt directory, in the order the spec's closing order sets (persist,
transition, log, result):

| File              | Time (UTC)   | Content                                                                                                           |
| ----------------- | ------------ | ----------------------------------------------------------------------------------------------------------------- |
| `persisted.json`  | 11:15:56.489 | `autonomous.persisted.v1`, header `autonomous · verify · beads:agentic-task-wnc2:verify:1 · stage summary saved`  |
| `transition.json` | 11:16:08.013 | `{"answer":["code-review"],"by":"agent"}`                                                                         |
| `logbook.json`    | 11:16:18.709 | `autonomous.logged.v1`, pull request 13                                                                           |
| `result.json`     | 11:16:27     | `autonomous.result.v1`, `outcome` `completed`, three artifacts (`findings.md`, `stage-summary.md`, logbook entry) |

Tracker state:

| Moment                                  | Labels of `agentic-task-wnc2`                              |
| --------------------------------------- | ---------------------------------------------------------- |
| Before the launch (transcript)          | `AFK`, `grill-sandbox`, `personal`, `verify`               |
| After the launch (transcript)           | `AFK`, `grill-sandbox`, `personal`, `taken`, `verify`      |
| Before the reconcile (2026-11-22 09:04) | `AFK`, `code-review`, `grill-sandbox`, `personal`, `taken` |
| After the reconcile                     | `AFK`, `code-review`, `grill-sandbox`, `personal`          |

- The task has one comment, created 11:15:57 UTC. Its first line is `autonomous · verify ·
  beads:agentic-task-wnc2:verify:1 · stage summary saved`, then a blank line, then the stage summary.
  The task's description is the one the task was created with. The summary names the pull request,
  the change, the three commits, F1 fixed and F2 dismissed with their reasons, `None passed on`
  under `Code review` and under `QA`, `None.` under `Proposed follow-up tasks`, and `None.` under
  `Deviations from the proposal`.
- The pull request has one comment, created 11:16:21 UTC. It starts with the marker
  `<!-- autonomous:logbook beads:agentic-task-wnc2:verify:1 -->` and the header `### 🔍 verify ·
  attempt 1`. The next line reads `AFK` · `--model opus --effort high` · `2026-11-21 11:13 → 11:16
  UTC (3 min)` · `moved to code-review by the agent, with no answer` · `1 commit (3c24b75)`. Its
  `### Verification` section reads: fixed F1, dismissed F2, refuted none, passed on none, deferred
  none. The pull request holds the three commits, is `OPEN` and `isDraft` `true`, both before the
  reconcile and after it.
- There is one task comment and one logbook comment only, although the session was prompted again
  after the reboot (F2).

Reconcile, with `--task beads:agentic-task-wnc2` and no `--stage` (a `--stage` would skip the
unsupported-stage exclusion and launch a second attempt, the 9.3 F1):

| Run                              | Exit | `before`  | `state`     | `action`    | `marker`      | `stageNow`    | Launch step                                                      |
| -------------------------------- | ---- | --------- | ----------- | ----------- | ------------- | ------------- | ---------------------------------------------------------------- |
| Dry run, 2026-11-22 09:05:26 UTC | 2    | `started` | `started`   | `finalised` | `{"ok":true}` | `code-review` | `wait`: `beads:agentic-task-wnc2 is excluded: taken`             |
| `--apply`, 09:05:34 UTC          | 2    | `started` | `completed` | `finalised` | `{"ok":true}` | `code-review` | `wait`: `beads:agentic-task-wnc2 is excluded: unsupported stage` |

- Both runs ended `wait` because the launch step waited. The dry run's reconcile reasons were
  `1 attempt observed`, `1 would-finalise` and `nothing changed`; the apply's were `1 attempt
  observed` and `1 finalised`. Capacity read `grill slots 0/1` and `work slots 0/2`, and the quota
  gate had capacity (2 of 100 percent in the session window, 1 of 100 in the weekly one), so
  neither run stopped before the launch step.
- The attempt's session was `open`, `idle`, not busy and not `needsHuman` in both. `detail` was
  `null`. The dry run's launch exclusion was `taken` (the dry run does not remove it; `taken` is
  checked before the stage). After the apply the launch exclusion was `unsupported stage` (the task
  is in `code-review`, which has no stage).
- The record after the apply: `state` `completed`, `taken.removed` `2026-11-22T09:05:34.183Z`,
  `cleanup` `null`, `agentSessionId` `e25afc0a-372a-4a90-bc15-d8f6fc8dde5f`. `capture.txt` is in the
  attempt directory. `aoe session show 591a661e39b44ae9` exits 1 with `Error: Session not found:
  591a661e39b44ae9`. The pull request stayed a draft.

No follow-up task:

- Beads: the listing of tasks created since 2026-11-21 11:10:12 UTC holds the same two ids as the
  one taken at setup, `agentic-task-p6t9` and `agentic-task-wnc2`; the diff of the two id lists
  exited 0 (operator report). The start of that window was rebuilt (F1), and both tasks were created
  at 11:12:15 UTC.
- GitHub: the repository has three issues, created 2026-11-03 and 2026-11-05. None was created on
  or after the launch.
- The stage summary's `Proposed follow-up tasks` holds `None.`.

PASS: the `AFK` task went from launch to `code-review` with no question and no follow-up task. The
planted mismatch was found, refuted without success, fixed by a teammate, accepted by a different
one and committed once by the orchestrator. The task's labels, comments, pull request and reconcile
are as the spec requires.

### Case 2: the guards refuse the transition

Run on case 1's task `agentic-task-wnc2` after the reconcile, with
`run.ts --apply --transition beads:agentic-task-wnc2 --json`.

Setup (7.0): after the reconcile the task carried `code-review` (no `taken`) and the attempt
`verify:1` was `completed`, so the operator put the task back in `verify` by hand: `bd label remove
agentic-task-wnc2 code-review` and `bd label add agentic-task-wnc2 verify`. The labels read `AFK`,
`grill-sandbox`, `personal`, `verify`. The guards find the workspace through the task's latest
attempt record, of any stage (`transition/guards.ts`, `workspaceOf`), and transition mode refuses
earlier only when an open attempt of the stage has no `persisted.json` (`transition/receipt.ts`).
After the reconcile the only attempt was completed and its worktree was kept, so the run reaches
the guards with no new session. They run the same code as for a real session that left a fix
behind. Before 2a the working tree was clean, `0` commits were unpushed, and the change was
complete, `3` of `3` tasks (operator report; no raw file).

| Step | Setup                                                                           | Exit | `outcome`       | Reason, verbatim                                                                                                                                               |
| ---- | ------------------------------------------------------------------------------- | ---- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2a   | one line appended to `bin/greet.sh`, uncommitted                                | 3    | `not-evaluable` | `the working tree has 1 uncommitted change`                                                                                                                    |
| 2b   | that line committed locally as `fix(greeter): sandbox unpushed fix`, not pushed | 3    | `not-evaluable` | `the branch feature/agentic-task-wnc2-sandbox-verify-greeter-happy-path has 1 commit origin/feature/agentic-task-wnc2-sandbox-verify-greeter-happy-path lacks` |

Both outputs (2026-11-22 09:05:48 and 09:05:57 UTC) have `schema` `autonomous.transition.v1`,
`applied` `false` and one reason only. The labels read in the output and in `bd show` after each
run are `AFK`, `grill-sandbox`, `personal`, `verify`, identical to the labels before 2a, so the
task did not move. The commit of 2b exited 0 (no hook ran) and left an empty `git status`, with `1`
commit ahead of the remote. The exit codes come from the operator's report; the raw files hold the
outputs, not the exit codes.

PASS: each guard refused alone, with its own reason, and left the task in `verify`.

### Case 3: no verify workflow

Task `agentic-task-p6t9`, label `verify-sandbox-noverify`, in the throwaway repository
`~/WebstormProjects/verify-sandbox-noverify`: `git init`, no remote, `openspec/config.yaml`, the
update skill and the update command, and neither the verify skill nor the verify command. Its three
files were `.claude/commands/opsx/update.md`, `.claude/skills/openspec-update-change/SKILL.md` and
`openspec/config.yaml`. The account comes from the operator's transcript, because the raw files
were lost.

- The dry run `--task beads:agentic-task-p6t9 --stage verify` exited 2, `outcome` `wait`.
  `reconcile` advanced with `nothing to reconcile`, `capacity` with `grill slots 0/1` and
  `work slots 0/2`, and the quota gate had capacity. The launch step waited, with this one reason
  (home directory shortened to `~`):

    ```text
    the repository ~/WebstormProjects/verify-sandbox-noverify provides neither the skill openspec-verify-change (~/WebstormProjects/verify-sandbox-noverify/.claude/skills/openspec-verify-change/SKILL.md) nor the command /opsx:verify (~/WebstormProjects/verify-sandbox-noverify/.claude/commands/opsx/verify.md): update OpenSpec in that repository
    ```

- Nothing was created. The task's labels before and after were identical (`AFK`, `personal`,
  `verify`, `verify-sandbox-noverify`), with no `taken`. There was no attempt directory for the
  task in the kit's state and no worktrees directory. `git worktree list` in the repository showed
  one worktree. The list of files and the `git status` of the repository were identical to those
  taken before (both diffs exited 0). No aoe session mentioned the task.
- The launch step's `data.repository` was `null` in the `wait` result, where the runbook expected
  the repository's path and `inferredFrom`. The reason names the right path, and `excluded` is
  `null`, `stage` `verify`.

PASS: the stage waited, the reason names the skill and the command, and no file or attempt was
created.

### Case 4: the prompt holds the branch's skill

The installed plugin is `autonomous` 2.4.0. Its `skills/` holds only `labelling-new-tasks`, and
`test -e` for its `adversarial-review/SKILL.md` exited 1 (absent). The worktree's `skills/` holds
`adversarial-review` and `labelling-new-tasks`. The skill file's last commit is `89206b7` and
`git status` shows no change under `plugins/autonomous/skills`. The kit's wrapper passes
`--plugin-dir` for the worktree's `plugins/autonomous`.

Checks on the case 1 launch's `prompt.md` (right after the launch, from the transcript):

- The skill's body without its frontmatter (`4443` characters) is a substring of the prompt: `True`.
  The frontmatter line `name: adversarial-review` is not in the prompt: `False`.
- The line `You are the orchestrator of an adversarial review: a reviewer reports` occurs once, and so
  does `Before the report, look for what an earlier attempt`.
- The prompt names the change `sbx-verify-greeter`, pull request `pabloimrik17/grill-sandbox#13`, the verify workflow as
  `/openspec-verify-change` and the update workflow as `/openspec-update-change`. Line 56 reads
  `Severity scale: the verify workflow's CRITICAL, WARNING and SUGGESTION. The floor is CRITICAL.`
  Line 59 reads `Whether a human follows the review: no: this task carries AFK.`
- On 2026-11-22 the same check on the kept `prompt.md` (21100 bytes) against the skill at the
  current worktree gave `4443 True False`.

The prompt is the evidence: the launch reads the skill from the running plugin
(`stages/plugin-skill.ts`, `PLUGIN_ROOT` is the plugin the code belongs to) and writes the prompt
before the session exists. The installed plugin has no such skill, so the body can only come from
the branch. The session's first message names the prompt file, and its steps follow the prompt: it
ran a report, a triage, a refutation, a fix and a fix check.

PASS: with the installed plugin lacking the skill, the prompt holds the branch's whole skill body.

### Findings

- **F1: the reboot cleared the scratchpad.** The machine rebooted on 2026-11-22 at 03:39 local time
  (the shutdown was at 03:31). The raw files of the first operator turn (preflight, kit, fixtures,
  case 3, the case 1 launch and case 4) were lost, and so were the baselines the later checks
  compared against. They were rebuilt, not re-captured: the three files of the throwaway
  repository's listing (`11.3-c3-files-before.txt`), the two task ids of the setup snapshot
  (`11.3-c1-bd-list-before.json`), the start of the Beads window (`11.3-c1-bd-since.txt`, two
  minutes before the task creation call; the exact second of the original is not in the
  transcript), the launch time (`11.3-c1-launch-at.txt`, 2026-11-21T11:13:07Z, as the operator
  reported it) and the GitHub issue list taken before (`11.3-c1-gh-issues-before.json`, filtered
  from today's list; the original was never printed). The raw file of the issue list after the run
  does not depend on a rebuilt file. The kept kit state, the attempt directory, the transcripts
  and `prompt.md` survived.
- **F2: the case 1 session was prompted again after the reboot.** Its aoe session's tmux was
  recreated on 2026-11-22 at 09:01:58 UTC (operator report), the conversation was resumed at 09:02:01 UTC
  (`SessionStart:resume`, the same conversation `e25afc0a-372a-4a90-bc15-d8f6fc8dde5f`) and it
  received its prompt again (`Read <attempt directory>/prompt.md and follow it.`, 09:02:02 UTC).
  It ran one read-only `Bash` call (`ls` of the attempt directory, `cat result.json`,
  `git status -sb`, `git log`), found `result.json`, said that running the prompt again would post the
  stage summary and the logbook entry twice, and wrote nothing. One task comment and one logbook
  comment remain, and the attempt directory and the branch did not change. Who relaunched the
  session is not established. An open aoe TUI relaunches a selected session row (unverified here);
  one was open (`aoe` pid `62221` at the preflight). The reconcile removed the session again, and no
  aoe session mentioned the task afterwards.
- **F3: the 6.5 dry run's launch exclusion read `taken`.** The runbook guessed the unsupported-stage
  wording. The dry run removes nothing, so `taken` was still on the task, and the exclusion check
  tests `taken` before the stage (`select/candidates.ts`, `exclusionBeforeDetail`). The apply
  removed `taken` and then read `unsupported stage`. Both are `wait` and exit 2.
- **F4: the status at the second snapshot was `idle`, not `error`.** The brief expected `error`
  (the session dead after the reboot). Because of the relaunch in F2 the session was `idle` and
  `aoe session capture` worked. This also matches the runbook's wait for `idle`.
- **F5: case 3's launch step has `data.repository` `null`.** The runbook expected the path and
  `inferredFrom`. The `wait` result carries none; the reason names the path. The verdict holds.
- **F6: the preflight's uncommitted files.** The operator's report says none of them is under
  `plugins/autonomous/src` or `skills`. The raw listing shows a modified
  `plugins/autonomous/src/label-contract/detect.test.ts`, which is a test. Nothing the session loads
  was uncommitted: the rest were `tasks.md`, the adversarial review spec, one eval prompt, four
  untracked eval files and the untracked evidence directory. Between `1b57aa3` and the current HEAD the changes under `plugins/` are
  `README.md`, the evals and `detect.test.ts`; no skill and no runtime file.
- **No exit 3 at the quota gate.** The 9.3 F3 did not recur: every run of this section had a
  quota gate with capacity.
- **The reconcile did not repeat the 9.3 F1.** It ran with `--task` only, so it finalised attempt 1
  and launched nothing.

Differences between the operator's reports and the raw output: the report counts 23 tool calls
before the re-prompt, while the timeline holds 22 before it and one after; the report dates the
re-prompt 09:02:10 UTC, which is the session's first tool call, while the prompt itself arrived at
09:02:02 UTC. The exit codes of case 2 and of the cleanup come from the report, not from raw files.

### Cleanup

- The session was removed by the reconcile (F2 does not change that). The attempt `verify:1` is
  `completed`, so the discard was not needed.
- The case 1 worktree was removed with `git worktree remove` (exit 0, no `--force`; its tree was
  clean). Pull request `pabloimrik17/grill-sandbox#13` was closed with `--delete-branch` (exit 0).
  The local branch was deleted with `git branch -D` (exit 0; it was at `ffc0f1c`, the unpushed
  fix of 2b), `git fetch --prune` removed `origin/feature/agentic-task-wnc2-sandbox-verify-greeter-happy-path`,
  and `git ls-remote` for the branch printed nothing.
- `bd close agentic-task-wnc2 agentic-task-p6t9` exited 0. Both tasks are `closed` and carry no
  `taken`. Task `agentic-task-wnc2` keeps the `verify` label that 7.0 put back; case 3's labels are
  unchanged.
- The throwaway repository's files still matched the list taken before; it was removed
  (`rm -rf`, exit 0) and `ls ~/WebstormProjects | grep -c noverify` printed `0`.
- The sandbox clone `~/WebstormProjects/grill-sandbox` reads `## main...origin/main`, has one
  worktree (`87fac3e [main]`), no `feature/agentic-task-wnc2*` branch and no worktree directory for
  the task. No aoe session mentions either task.
- The Beads Dolt routine ran: `bd conflicts list` found none, `bd dolt commit` exited 0 with
  `Nothing to commit.`, `bd dolt pull` exited 0, no conflicts again, and `bd dolt push --no-adopt`
  exited 0 with `Push complete.`.
- The kit `~/.local/state/autonomous/verification-sandbox` stays in place: its `state/` holds the
  attempt record this section cites. The 9.3 kit's wrapper still points at this worktree.
