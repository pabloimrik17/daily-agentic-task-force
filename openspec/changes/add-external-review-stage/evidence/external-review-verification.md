# External review stage verification

End-to-end checks of tasks 13.1–13.4. The plugin code under test is this feature worktree,
`feature/DOT-157-add-external-review-stage`, run from source. Phase 1 (cases 1, 2, 3 and 6) ran at
commit `d05be61`; phase 2 (cases 7, 5 and 4) ran at commit `be39496`, the fix of the defect case 1
found (see "Findings"). The worktree had only `bun.lock` modified in both phases (operator's log,
10:35:05 and 10:52:28).

Go-aheads, all in the Plannotator Inbox thread "DOT-157 external review stage: implementación",
2026-11-28, relayed by the orchestrator (the thread is not in the evidence directory). At 10:16 the
user approved "Solo el sandbox (13.4) y el bootstrap (13.1)". At about 10:42 they approved the
bootstrap creating three labels, and one minute later withdrew it: "crea solo los que necesitemos
para las pruebas ... así validamos el proceso de bootstrap cuando toque". 13.2 and 13.3 were not
approved. Only 13.4 ran.

The raw files are in `~/.local/state/autonomous/verification-sandbox/evidence-13` and are cited by
file name. The operator's log (`operator-log.txt`) holds every step with its UTC time, its verdict
and its deviations; its times are when each line was written, not when the command started. The
runbook the operator followed states what each case intended; it is not in the evidence directory.
Where the log and a raw file disagree, the raw file wins and the text says so. Times are UTC. The
directory listing shows local time (UTC+1); this text converts it.

## 13.1 Bootstrap of `wrap-up`

Not run. Open.

Only the read-only preflight exists (`13.1-before.txt`, written at 10:43). It lists, for the four
repositories of the real configuration (`dotfiles`, `kinkoi-project`, `monolab`,
`daily-agentic-task-force`), the matches of `qa`, `wrap-up`, `ready-to-merge`, `external-review` and
`code-review` among their labels, and the matches in Linear. Each scope shows
`external-review #8b5e3c` and nothing else: `wrap-up`, `qa` and `ready-to-merge` are absent in the
four repositories and in Linear. The operator's log (A2, 10:35:05) also lists `code-review` as
present in the four repositories; the file does not show it. The file ends: "NOT RUN: the user
withdrew the go-ahead for the real-tracker bootstrap ... nothing was written to the real trackers."

The same file's process check shows one `bun .../run.ts` process of this worktree. The log's own
check at 10:35:05 (A1) found none. At 10:43 the operator was running case 3's sandbox runs
(`3c.json` started 10:43:34); that process is most likely one of them (inferred).

What 13.1 still needs: the user's go-ahead for the labels the bootstrap would create. The contract
now holds 15 labels, so one run creates `wrap-up`, `qa` and `ready-to-merge` in each of the five
scopes; the runner has no per-label option. Then the run with the loop stopped, its report and the
read-back.

## 13.2 Real task

Not run. Open. Not approved.

What it still needs: the user's go-ahead to take a real task from `code-review` to `wrap-up` from
this branch, with the real bots. Then everything the task lists: the pull request marked ready, each
run's wait, the check runs while a bot reviews, each round's report, record, replies, push and
logbook entry, the quiet round's resolutions and dismissal, the labels, and that no session was open
during a wait.

## 13.3 Measurements of Greptile and Pullfrog

Not run. Open. Not approved.

What it still needs: 13.2's pull request and the user's go-ahead to reply on it. Then the three
measurements (Greptile and Pullfrog answering a reply without a mention; a reply that mentions
Greptile starting a full review) and a proposal for the defaults of `mention` and
`answerWaitMinutes`, changed only on the user's decision.

## 13.4 Sandbox cases

Seven cases on GitHub issues and pull requests of `pabloimrik17/grill-sandbox`, 2026-11-28 10:35 to
11:23 UTC. One case at a time, each torn down before the next, because every pipeline run reads all
open sandbox issues. The loop was stopped throughout.

### Setup

- Preflight (operator's log A1–A4, 10:35): no live `run.ts` or loop process; the real `loop.lock`
  and `run.lock` held the dead pid 76811; the sandbox clone at `main...origin/main` with one
  worktree; no open sandbox issue or pull request; the workflow permissions `read` and `can_approve`
  false; no `AUTONOMOUS_*` variable in the operator's shell. Two real `auto` sessions in the aoe
  list were recorded as the baseline and not touched.
- The kit is `~/.local/state/autonomous/verification-sandbox`. `env.sh` defines the operator's
  commands. Its `run` function refuses to start `run.ts` unless `AUTONOMOUS_CONFIG` is the kit's
  `config-13.json` and `AUTONOMOUS_STATE` the kit's `state`, so no run read the real configuration
  or state.
- `config-13.json` (`K0-config-13.diff` against the kit's `config.json`): Beads disabled,
  `sessions.binary` set to the kit's `bin/claude-13`, and a `review.external` block. Linear was
  already disabled; GitHub lists only `pabloimrik17/grill-sandbox` (`K2` guard in the log).
- Deviations from the shipped settings, all in `review.external`: `waitMinutes` 1 (shipped 30),
  `answerWaitMinutes` 0 (shipped 10), `rounds` 1 (shipped 3), and the bots replaced by two:

  | Id       | Login                 | Check        | Mention |
  | -------- | --------------------- | ------------ | ------- |
  | `sbxbot` | `github-actions[bot]` | `sbx-bot`    | none    |
  | `silent` | `sbx-silent[bot]`     | `Silent Bot` | none    |

- Validation (`K0-validate.json`, exit 2, "no open task"): no configuration error. The report lists
  `review.tiers`, `review.team` and `review.security` as defaulted and not `review.external`, so a
  partial `review` block merges with the shipped keys.
- `bin/claude-13` (`K1-bin-claude-13.diff` against `bin/claude`): `AUTONOMOUS_CONFIG` points at
  `config-13.json`, and `--plugin-dir` at this worktree's `plugins/autonomous` instead of the
  `feature-DOT-164-add-code-review` worktree. `bin/claude` itself was left as it was.
- Bootstrap of the sandbox repository with the kit (`K2-bootstrap.json`, exit 0, outcome `advance`):
  one source, GitHub, 8 labels created with their contract colours (`implement`, `verify`,
  `code-review`, `qa`, `external-review`, `wrap-up`, `ready-to-merge`, `triage-me`), 7 present, 0
  failed. This is a bootstrap of the sandbox, not 13.1.
- Fixtures (`fixture.sh`, `fixture-template/`, `c<N>-fixture.out`, `c<N>.vars`): per case a GitHub
  issue labelled `personal`, `AFK` and the case's stage, a branch
  `feature/pabloimrik17-grill-sandbox-<N>-sandbox-er-c<N>`, a worktree, one OpenSpec change with
  every task checked, `bin/greet.sh` and `scripts/test.sh`, and a draft pull request.

The sandbox bot is a workflow script on each fixture branch, not a review bot. The job `sbx-ci`
passes, fails or sleeps 600 s as `.sbx/ci` says; it is the pull request's check. The job `sbx-bot`
runs as `github-actions[bot]`, so its check run is `sbxbot`'s state: `in_progress` while it runs,
`success` when it ends. Per `.sbx/bot` it does nothing, or posts a review with inline comments from
`.sbx/bot-comments.json` (`COMMENT` or `REQUEST_CHANGES`). For phase 2 a second workflow,
`sbx-contest.yml`, was added (log K3, 10:52:29): its job is also named `sbx-bot`; on a review
comment that carries `autonomous:resolution`, by an author other than `github-actions[bot]`, in a
thread `github-actions[bot]` opened and has not answered yet, it replies "Disagree: " and the text
of `.sbx/bot-contest`, when `.sbx/contest` is `on`. One contest per thread; a human thread is never
contested. `silent` never has a check run.

What this proves: the runner's mechanics against real GitHub objects. The threads are authored by
`github-actions`, the review in case 6 is a real `CHANGES_REQUESTED` review, the check runs are real
`in_progress` and `completed` runs, and the contest is a real reply. What it does not prove: what
CodeRabbit, Greptile and Pullfrog do. Their first lines, check runs, answers and timing are 13.2's
and 13.3's. `sbxbot` uses CodeRabbit-like first lines (`**Potential issue | Major**`), but its id
has no mark parser (see "Findings").

What is fabricated in each case:

| Case | Fabricated                                                                                         |
| ---- | -------------------------------------------------------------------------------------------------- |
| 1    | a completed `code-review:1` record, so the run finds the workspace and the pull request            |
| 2    | the same record                                                                                    |
| 3    | the same record; the operator marked the pull request ready, and in 3c turned it back to a draft   |
| 4    | the same record; the bot's finding and its contest are script output with fixed text               |
| 5    | completed `code-review:1` and `external-review:1` records; an operator reply posing as attempt 1's |
| 6    | an open `external-review:1` record with no session; both `findings.json` files, written by hand    |
| 7    | the same record as case 1; the "human" thread, written with the operator's account                 |

No case ran an agent session except 4, 5 and 7. Cases 1, 2, 3 and 6 ran `run.ts` modes only.

### Case 1: a draft in `external-review`, marked ready only with `--apply`

Setup (10:37:20): issue #16 (`AFK`, `external-review`, `personal`), draft pull request #17 at head
`4fd1fd0`, `.sbx/ci` pass, `.sbx/bot` idle (`c1-fixture.out`). A fabricated completed record
`github:pabloimrik17/grill-sandbox#16:code-review:1` (session null).

1a, `run --json`, no `--apply` (`1a.json`, started 10:37:50.538, exit 2): reconcile reports "nothing
changed" with no error, so the fabricated record is valid. Select `wait`, "1 waiting for review
bots". The task is excluded `waiting-for-review-bots`, with `wait.pullRequest.number` 17,
`wait.draft` `left-draft`, `sbxbot` `reviewing`, `silent` `waiting` with 1 minute left. The text
form (`1a-text.txt`, exit 2) prints "pull request #17: the pull request is a draft; sbxbot is
reviewing; silent is waiting, 1 minutes left". No launch step: the pipeline stops at select.
Read-back: `isDraft` true (`1a-isdraft.txt`); `1a-pr-before.json` and `1a-pr-after.json` are
identical (log: `cmp` exit 0); labels unchanged (`1a-labels-before.txt`, `1a-labels-after.txt`).

1b, `run --apply --json` (`1b.json`, started 10:38:10.793, exit 2): `wait.draft` `marked-ready`;
`sbxbot` `reported`; `silent` `waiting` with `minutesLeft` 2; the only reason "silent is waiting, 2
minutes left". Read-back: `isDraft` false (`1b-isdraft.txt`); one `ready_for_review` event at
10:38:15 (`1b-ready-events.txt`); labels unchanged. Two minutes left on a one-minute wait is the
defect under "Findings". The text form of 1b was not captured: a text run with `--apply` would have
marked the draft itself.

1c, a second `run --apply --json` (`1c.json`, started 10:38:30.090, exit 2): `wait.draft` null (no
marking tried), `isDraft` false, still one `ready_for_review` event (`1c-ready-count.txt`), `silent`
1 minute left. `sbx-ci` and `sbx-bot` both `completed success` (`1c-checks.txt`).

Tracker state: labels `AFK`, `external-review`, `personal` before 1a and after 1a and 1b. Pull
request state at the end (`1-pr-final.json`): `OPEN`, not a draft, head `4fd1fd0`, no review, no
comment, no thread. Teardown at 10:39:09: pull request closed and branch deleted, worktree and local
branch removed, issue closed.

PASS. The draft was marked ready only by the run with `--apply`, once. The minutes left of 1b exceed
the configured wait; fixed in `be39496`.

### Case 2: a transition refused for a failed check, then applied with a check running

Setup (10:39:16): issue #18 (`AFK`, `code-review`, `personal`), draft pull request #19 at head
`ad5e0a4`, `.sbx/ci` fail, and a fabricated completed `code-review:1` record. With no open
`code-review` attempt, the publish-receipt guard does not apply; the work guards and the check guard
do. Before 2a, `sbx-ci` was `completed failure` and `sbx-bot` `in_progress`
(`2-checks-before-2a.txt`).

2a, `run --apply --transition github:pabloimrik17/grill-sandbox#18 --from code-review --json`
(`2a.json`, started 10:39:35.901, exit 3): `autonomous.transition.v1`, outcome `not-evaluable`,
`applied` false, no handoff, and exactly one reason: "the check sbx-ci concluded failure on
ad5e0a4b9042625f046340f4474cf487d7ea55fb". `isDraft` true; labels `AFK`, `code-review`, `personal`
before and after (`2a-labels-*.txt`).

2b: the operator pushed `.sbx/ci` slow (new head `77048d6`); `sbx-ci` and `sbx-bot` were
`in_progress` on it (`2b-checks-before.txt`). The same command (`2b.json`, started 10:40:12.158,
exit 0): outcome `advance`, `applied` true, `reasons` empty, so nothing about the running check.
Read-back: labels `AFK`, `external-review`, `personal`; `isDraft` false; `sbx-ci` still
`in_progress` (`2b-checks-after.txt`). Order: `ready_for_review` at 10:40:20 (`2b-pr-ready.tsv`),
`external-review` labelled at 10:40:22 and `code-review` unlabelled at 10:40:25
(`2b-issue-events.tsv`). The pull request was marked ready before the label write, and the new label
was added before the old one was removed.

Pull request state at the end (`2-pr-final.json`): `OPEN`, not a draft, head `77048d6`, no review,
no comment, no thread. Teardown at 10:41:07: the sleeping `sbx-ci` run cancelled (`final-runs.json`:
conclusion `cancelled`), pull request closed, branch, worktree and issue removed or closed.

PASS.

### Case 3: a bot with no check run, not reviewing when its wait runs out

Setup (10:41:23): issue #20 (`AFK`, `external-review`, `personal`), pull request #21 at head
`e4658a7`, `.sbx/bot` idle, `.sbx/ci` pass, a fabricated completed `code-review:1` record. The
operator marked the pull request ready (`3-ready.out`); `3-ready-at.txt` gives the
`ready_for_review` event at 10:41:17. The log says 10:41:16; the raw file wins.

3a, `run --json` right after (`3a.json`, started 10:41:17.249, exit 2): excluded
`waiting-for-review-bots`; `silent` `{"kind":"waiting","minutesLeft":1}`; `sbxbot` `reviewing`;
reasons "checks still running: sbx-ci", "sbxbot is reviewing", "silent is waiting, 1 minutes left".

3b, `run --json` after `sbx-ci` and `sbx-bot` ended and the minute passed (`3b.json`, started
10:42:37.709, exit 0): select `advance`, "selected github → pabloimrik17/grill-sandbox#20 for
external-review, from 1 candidate", nothing excluded; launch `advance`, "would launch
external-review for github:pabloimrik17/grill-sandbox#20 ...". It was a dry run: no session. The
text form (`3b-text.txt`, exit 0) shows the same; its LLM title differs from the JSON run's, as each
run names the session anew. `3-checks.txt` holds `sbx-ci` and `sbx-bot` only: no `Silent Bot` check
run ever existed. A settled pull request is not reported, so 3b proves the classification only
indirectly: the task was selected with `silent` having no check run.

3c, an operator addition: `gh pr ready --undo 21` (`3c-undo.out`), then `run --json` (`3c.json`,
started 10:43:34.211, exit 2). The draft makes the pull request unsettled, so the bot states are
reported: `silent` `{"kind":"not-reviewing","reason":"no check run in 1 minutes"}`, `sbxbot`
`reported`, and the only reason "the pull request is a draft". Text form (`3c-text.txt`): "sbxbot:
reported; silent: not reviewing: no check run in 1 minutes".

Tracker state: labels `AFK`, `external-review`, `personal` throughout (3a–3c label triage: 1
complete). Pull request state at the end (`3-pr-final.json`): `OPEN`, a draft (3c), head `e4658a7`,
no review, no comment, no thread. Teardown at 10:44:50.

PASS: directly in 3c, indirectly in 3b.

### Case 4: a contested answer refuted twice in an `AFK` task

Setup (11:12:42): issue #28 (`AFK`, `external-review`, `personal`), pull request #29 at head
`e31e7b1`, with `"$name"` quoted in `bin/greet.sh`, `.sbx/contest` on and `.sbx/bot-contest` "No:
printf still expands the backslash escapes of the name here, so sh bin/greet.sh 'a\nb' prints two
lines. You are wrong." `sbx-bot` posted one `COMMENT` review with one thread,
`PRRT_kwDOVhIiDM69DHaF` on line 11, claiming that `printf` expands backslash escapes in the name
(`4-pr-after-bot.json`, `c4-bot-comments.json`). The claim is false: `%s` prints its argument as
given. A fabricated completed `code-review:1` record. The operator marked the pull request ready.
The pipeline dry run selected the task (`4-pre-select.json`, exit 0).

Three attempts ran:

| Attempt                    | Launch                                                   | Start    | Idle     | Outcome       | aoe session        |
| -------------------------- | -------------------------------------------------------- | -------- | -------- | ------------- | ------------------ |
| `...#28:external-review:1` | `--apply --task ... --stage external-review` (`4a.json`) | 11:14:21 | 11:16:21 | `round-ended` | `3b723abe6ee6460e` |
| `...#28:external-review:2` | selected by reconcile 1's run (`4b-reconcile.json`)      | 11:16:45 | 11:19:07 | `round-ended` | `cc4ad8b1d51b44a7` |
| `...#28:external-review:3` | selected by reconcile 2's run (`4c-reconcile.json`)      | 11:19:31 | 11:21:55 | `completed`   | `1c59ac986d69407b` |

Start is the record's `taken.added` (`4a-record.json`, `4b-record.json`, `4c-record.json`); idle is
the watch's `AOE running -> idle` line (`watch-c4a.log`, `watch-c4b.log`, `watch-c4c.log`). No
attempt asked a question or needed a nudge; the watch logs show no `waiting`. Deviation: attempts 2
and 3 were launched by the instructed `run --apply --json` that reconciled the previous one, not by
`--task`. The stage and the prompt builder are the same.

Attempt 1 (prompt `4a-prompt.md`: "This is round 1 of 1: 0 rounds pushed fixes before it"; the
finding listed as `sbxbot`, WARNING, not contested). Record (`4a-attempt-copy/findings.json`): f1,
`sbxbot`, WARNING, destination `fix`, refutation `refuted`, publication `none`, thread
`PRRT_kwDOVhIiDM69DHaF`. Reply at 11:15:36: "Status: not published (refuted): ..." with the marker
`attempt=...#28:external-review:1 finding=f1 state=none`. At 11:15:42 the sandbox bot contested:
"Disagree: No: printf still expands ..." (`4-pr-final.json`). Result `round-ended`; no push. The
logbook entry (`4a-logbook.txt`) says the round answered a thread and ran no transition.

Attempt 2 (prompt `4b-prompt.md`): the finding listed as contested, with the round-1 reply and the
contest ("Answer by `github-actions`"). Step 4 of the prompt: a contested finding goes to a fresh
refutation by other teammates; refuted again, it is recorded as `blocked` and its thread stays open.
The prompt still reads "This is round 1 of 1 ... 0 rounds pushed fixes". Record
(`4b-attempt-copy/findings.json`): f1, destination `fix`, refutation `survived` with `reproduction`
null (the record's only shape for a contested finding left for a person), publication `blocked`,
"Refuted twice (round 1 and this round, by different teammates) and contested again with no new
evidence: left for a person to decide." Reply at 11:18:24: "Status: blocked: ..." with the marker
`state=blocked`. The contest workflow ran on that reply (`c4-runs.json`, run 46139251647, success)
and did not contest again. Result `round-ended`, not retained; no push. Logbook `4b-logbook.txt`:
"Blocked, contested and left for a person (open)".

Attempt 3 (prompt `4c-prompt.md`): the report is quiet; the blocked thread is listed under "Threads
accounted for" as answered. Record: `entries` empty, `quiet` true. Receipt
(`4c-attempt-copy/published.json`, 11:20:32): `quiet` true. The thread stayed unresolved, its last
comment the blocked reply (`4c-pr-after.json`, `4-pr-final.json`). No review was dismissed: the
bot's review is `COMMENTED`. `transition.json`: `["wrap-up"]` by `agent` at 11:21:12. Result
`completed`. The logbook entry (`4c-logbook.txt`) reads "Round: 1 (attempt 3)" and names the thread
"left for a person by attempt 2".

Reconcile 3 (log, 11:22:42, exit 2): attempt 3 finalised; select `wait`, "1 unsupported stage";
nothing launched.

Tracker state: labels `AFK`, `external-review`, `personal` before (`4-labels-before.txt`); plus
`taken` during each attempt; `AFK`, `personal`, `taken`, `wrap-up` at the transition
(`watch-c4c.log`, 11:21:12); `AFK`, `personal`, `wrap-up` after reconcile 3. Pull request state at
the end (`4-pr-final.json`): `OPEN`, not a draft, head `e31e7b1` (no push in any attempt), four
reviews `COMMENTED` (the bot's, two empty-bodied ones by the operator's account around the runner's
replies, one empty-bodied one by `github-actions` around the contest), three logbook comments
(attempts 1–3), and the one thread, unresolved, with four comments: the bot's claim, the refuted
reply, the contest, the blocked reply.

PASS. This is the behaviour the user decided on 2026-11-28: a contested finding refuted twice in an
`AFK` task keeps its thread open through the quiet round, and the task goes on to `wrap-up`. Design
D16 and the README were corrected to say so in `d05be61`.

### Case 5: a round past the limit with a surviving finding

Setup (11:02:31): issue #26 (`AFK`, `external-review`, `personal`), pull request #27 at head
`2d6d673`, with a planted defect: `printf 'Hello, %s!\n' $name` unquoted on line 11 ("Ada Lovelace"
prints two lines), and no two-word check in `scripts/test.sh`. `.sbx/contest` off. `sbx-bot` posted
one `COMMENT` review with two threads (`5-pr-after-bot.json`, `c5-bot-comments.json`): T0
`PRRT_kwDOVhIiDM69C_7c` (line 5, `--help` only as the first argument) and T1 `PRRT_kwDOVhIiDM69C_7g`
(line 11, the planted defect). The operator marked the pull request ready.

Fabricated (log, 11:02:32): completed `code-review:1` and `external-review:1` records
(`5-record-code-review-1.json`, `5-record-external-review-1-fabricated.json`), so the live attempt
is `external-review:2`; and a reply in T0 by the operator's account (`5-fabricated-reply.json`):
"Status: fixed in 2d6d673" with the marker
`attempt=github:pabloimrik17/grill-sandbox#26:external-review:1 finding=f1 state=fixed`. This makes
one round count as having pushed fixes. Deviation from the runbook: it named attempt 0, which
`parseAttemptId` does not accept (only n ≥ 1), so attempt 1 was used with a matching record.

5a, `run --apply --task github:pabloimrik17/grill-sandbox#26 --stage external-review --json`
(`5a.json`, exit 0): attempt `...#26:external-review:2` at 11:04:25 (`5a-record.json`), aoe session
`c5535840ad024c6e`. The prompt (`5a-prompt.md`) has the limit shape: "The round limit is reached: 1
round pushed fixes, and the limit, `review.external.rounds`, is 1. This round fixes nothing." T1 is
listed as a `sbxbot` WARNING finding; T0 under "Threads accounted for" as answered; "Rounds that
pushed fixes: 1".

The session went idle at 11:06:41 (`watch-c5.log`). Record (`5a-attempt-copy/findings.json`): f1,
`sbxbot`, WARNING, destination `fix`, refutation `survived` with a reproduction, publication
`blocked`, "Survives the refutation but the external review round limit (review.external.rounds = 1)
is reached, so this round fixes nothing; left for a person (likely fix: quote "$name")." Reply in T1
at 11:05:43: "Status: blocked: ..." with the marker `state=blocked`; T0 and T1 unresolved
(`5a-pr-after.json`). The attempt copy has no `result.json` and no `transition.json`;
`published.json`, `persisted.json` and `logbook.json` exist. Nothing was pushed: head `2d6d673`
locally and on the remote (log). The session's pane (`5a-capture-pane.txt`) says it did not move the
task or write the result marker, "as the blocked procedure requires". The input box shows "quote
$name and add the regression test" dimmed, a suggestion, not typed; no nudge was sent (log). The
logbook entry (`5a-logbook.txt`) opens with "**Blocked.**".

5b, first reconcile, `run --apply --json` (`5b-reconcile.json`, exit 2): the attempt is not
retained. Action `observed`: session `open`, `idle`, marker "no result marker"; the record stays
`started`; work slots 1/2; select `wait`, "1 taken". The runbook expected retention here (inferred
from code). See "Findings".

The operator then stopped the attempt's own session (`aoe session stop c5535840ad024c6e`, log
11:11:27), standing in for the person who ends it. The next `run --apply --json`
(`5c-reconcile.json`, exit 2): "1 newly retained"; the attempt `started` → `retained`, session
`exited`/`stopped`, detail "session stopped; no result marker"; `retained` lists it; `taken` kept.
The next dry run (`5d-listing.json`, `5d-listing.txt`, exit 2) lists it: reconcile "retained →
retained" and "1 retained"; capacity "work slots 1/2" naming it; select "1 taken". The launch step
does not run when nothing is selected, so the runbook's launch reason "attempt ... is retained" did
not appear; the listing is the reconcile step's.

Discard (`5e-discard.json`, 11:11:36, exit 0), the runner's own mode, without `--release-workspace`:
session removed, `taken` removed, attempt discarded.

Tracker state: labels `AFK`, `external-review`, `personal` before (`5-labels-before.txt`); plus
`taken` from the launch until the discard. Pull request state (`5a-pr-after.json`, byte-identical to
`5-pr-final.json`, `cmp` rerun for this text): `OPEN`, not a draft, head `2d6d673`, three reviews
`COMMENTED` (the bot's and two empty-bodied ones by the operator's account), one logbook comment
(attempt 2), T0 and T1 unresolved with two comments each. Teardown at 11:11:57.

PASS for 5a (blocked past the limit, nothing pushed, no marker). PASS for 5b only once the session
was stopped: the attempt was then retained and listed by the next run.

### Case 6: publish mode run twice in a quiet round

Setup (10:44:57): issue #22, pull request #23 at head `3fd98ad`, a draft at creation. `sbx-bot`
posted a `REQUEST_CHANGES` review (6097294459) as `github-actions[bot]` with two threads:
`PRRT_kwDOVhIiDM69C3UY` (line 11) and `PRRT_kwDOVhIiDM69C3Ua` (line 10) (`6a-pr-before.json`).
GitHub allowed the review on a draft. The REST shapes were saved read-only
(`6-raw-rest-reviews.json`, `6-raw-rest-review-comments.json`, `6-raw-rest-check-runs.json`). The
operator marked the pull request ready (`6-ready.out`).

Fabricated: an open record `github:pabloimrik17/grill-sandbox#22:external-review:1`, state
`started`, session null (`6-record.json`), and a hand-written `findings.json` (`6a-findings.json`):
f1 `fixed` in `3fd98ad` (the existing head; nothing was fixed) and f2 `refuted`, both `sbxbot`,
WARNING, linked to the two threads.

6a, `run --apply --publish github:pabloimrik17/grill-sandbox#22:external-review:1 --json`
(`6a.json`, started 10:45:39.699, exit 0): `threads.answered` f1 and f2; `opened`, `resolved`,
`unresolved`, `reviews`, `dismissed` and `matches` empty. Replies "Status: fixed in
3fd98ad08017ed67bdde9ea0b1bb1f04c7589317" and "Status: not published (refuted): ...", each with its
`autonomous:resolution` marker; both threads unresolved (`6a-pr-after.json`). Receipt
(`6a-published.json`) with no `quiet` key.

6b, a quiet `findings.json` (`6b-findings.json`: `entries` empty, `quiet` true), then the same
command (`6b.json`, started 10:46:02.434, exit 0): `threads.resolved` f1 and f2; `dismissed` one,
`sbxbot`, review 6097294459. Both threads resolved (`6b-pr-after.json`). The review is `DISMISSED`
(`6b-reviews.tsv`) with the timeline event `review_dismissed` at 10:46:10 and the message
"Addressed: 1 fixed, 1 answered" (`6b-dismissed-event.json`). Receipt (`6b-published.json`) with
`quiet` true. The two `COMMENTED` reviews by the operator's account (6097296912, 6097297000) wrap
6a's two thread replies; they are not bot reviews.

6c, the same command with the same record (`6c.json`, started 10:46:26.302, exit 0): every thread
list, `dismissed`, `reviews` and `matches` empty. `6c-before.json` and `6c-after.json` are
byte-identical (`cmp` exit 0, rerun for this text), and so are `6c-reviews-before.tsv` and
`6c-reviews-after.tsv`: one `DISMISSED` bot review. The receipt keeps `findingsDigest` `9c29a97b…`;
`publishedAt` moved from 10:46:02.434 to 10:46:26.302 (`6b-published.json`, `6c-published.json`).

Tracker state: the case runs publish mode only and writes no label; the issue was closed at
teardown. Pull request state at the end (`6-pr-final.json`, `6c-after.json`): `OPEN`, not a draft,
head `3fd98ad`, the bot's review `DISMISSED`, two operator `COMMENTED` reviews, no comment, both
threads resolved with two comments each. Teardown at 10:47:20. Deviation: the open fabricated record
would have been retained by a later reconcile, so it was discarded with the runner's discard mode
(`6-discard.json`, exit 0): no session recorded, `taken` removed (no-op), attempt discarded; no
logbook comment.

PASS: the second publish in the quiet round wrote no reply, resolution or dismissal. The refutation
and the fix are hand-written; this case proves publish mode's mechanics only.

### Case 7: a human reviewer's thread refuted in an `AFK` task

Setup (10:52:53): issue #24 (`AFK`, `external-review`, `personal`), pull request #25 at head
`633d459`, `.sbx/bot` idle, contest off, a fabricated completed `code-review:1` record. The operator
marked the pull request ready and, with the operator's account, opened a thread on `bin/greet.sh`
line 3 (`PRRT_kwDOVhIiDM69C7Py`): "`set -eu` makes `sh bin/greet.sh` abort when it is run with no
argument ...". The claim is false: `${1:-...}` defaults keep `-u` safe. The first post lost `$1` to
shell expansion (`7-human-comment.json`); it was corrected with a `PATCH` before any launch
(`7-human-comment-fixed.json`, `7-pr-before.json`). That account is also the one the runner's
replies are posted with.

The dry `--task` run (`7-dry.json`, exit 0) reported "would launch" without the stage's
prerequisites; the pipeline dry run's select step was used instead (`7-pre-select.json`, select
`advance`). See "Findings".

7a, `run --apply --task github:pabloimrik17/grill-sandbox#24 --stage external-review --json`
(`7a.json`, exit 0): attempt `...#24:external-review:1` at 10:55:02 (`7a-record.json`), aoe session
`f25bfbac8b464efe`; labels plus `taken` (`7a-labels-after-launch.txt`). Idle at 10:57:22
(`watch-c7.log`), no question, no nudge. Record (`7a-attempt-copy/findings.json`): f1, reporter
`human`, WARNING, destination `fix`, refutation `refuted`, publication `none`, thread
`PRRT_kwDOVhIiDM69C7Py`. Reply at 10:56:26: "Status: not published (refuted): ..." with the
counter-evidence (`${1:-}` on line 5, `${1:-World}` on line 10). The thread is unresolved
(`7a-pr-after.json`). Result `round-ended`; no push (head `633d459` before and after,
`7-head-before.txt`). The stage summary (`7a-issue-comments.txt`) and the logbook entry
(`7a-pr-comments.txt`) name the thread "answered and left open".

7b, the instructed `run --apply --json` (`7b-reconcile.json`, exit 0): attempt 1 `started` →
`completed`, finalised, `taken` removed. Deviation: the same run selected #24, its pull request
settled with the human thread accounted as answered, and launched `...#24:external-review:2`
(10:58:22, `7c-record.json`). It was followed to its end as the live quiet round.

7c: the prompt (`7c-prompt.md`) has the quiet shape and lists the human thread under "Threads
accounted for" as answered. Record: `entries` empty, `quiet` true. Receipt
(`7c-attempt-copy/published.json`, 10:59:19): `quiet` true. Publish resolved nothing: the human
thread stays unresolved (`7c-pr-after.json`), as finding-threads requires for a human reviewer's
thread whose finding was not fixed. No review dismissed; the only reviews are the operator account's
two `COMMENTED` ones. `transition.json`: `["wrap-up"]` by `agent` at 10:59:56. Result `completed`;
no push. The logbook entry (`7c-logbook.txt`) reads "Round: 2 (quiet)" and says round 1's refuted
thread "was not contested".

7d, `run --apply --json` (`7d-reconcile.json`, exit 2): attempt 2 finalised; select `wait`, "1
unsupported stage"; nothing launched.

Tracker state: labels `AFK`, `external-review`, `personal` before (`7-labels-before.txt`); plus
`taken` during each attempt; `AFK`, `personal`, `taken`, `wrap-up` at the transition
(`watch-c7b.log`, 11:00:02); `AFK`, `personal`, `wrap-up` after 7d (log). Pull request state at the
end (`7-pr-final.json`, `7c-pr-after.json`): `OPEN`, not a draft, head `633d459`, two `COMMENTED`
reviews by the operator's account, two logbook comments, the human thread unresolved with two
comments. Teardown at 11:01:14.

PASS.

### Final state and cleanup

- Phase 1 (log, 10:47:52): no open sandbox issue or pull request (`final-open-issues.json`,
  `final-open-prs.json`); every workflow run completed, case 2's slow run `cancelled`
  (`final-runs.json`); the aoe list equal to the baseline (`final-aoe.tsv`); a final dry run
  (`final-dry.json`, exit 2): "no open task", 8 attempts reconciled, `retained` and `errors` empty.
- Phase 2 (log, 11:23:07): no open sandbox issue or pull request (`p2-final-open-*.json`); 14
  workflow runs, all completed (`p2-final-runs.json`); the aoe list and the tmux list equal to their
  baselines (`p2-aoe-baseline.tsv` and `p2-final-aoe.tsv`, `p2-tmux-baseline.txt` and
  `p2-final-tmux.txt`: `diff` empty, rerun for this text); a final dry run (`p2-final-dry.json`,
  exit 2): "no open task", 18 attempts reconciled, `retained` and `errors` empty. `caffeinate` was
  started for phase 2 and killed at the end (log).
- The kit state keeps the fabricated and live attempt records, completed or discarded. The real
  configuration and state, Beads, Linear and the other repositories were not touched (log).

### Findings

- **A wait reported more minutes left than the configured wait (defect, fixed).** Case 1b: with
  `waitMinutes` 1, the run that marked the draft ready reported "silent is waiting, 2 minutes left"
  (`1b.json`). The run started at 10:38:10.793 and the `ready_for_review` event is at 10:38:15
  (`1b-ready-events.txt`). The re-read after the marking used the run's start clock, while the wait
  starts at the later ready mark, so the minutes left came to 2 (log, 10:38:49). Commit `be39496`
  caps the minutes left at the wait and adds a unit test to `classify.test.ts` ("Wait starting after
  the clock: Greptile has the whole wait left, never more"). Case 1b was not re-run after the fix.
- **A blocked attempt is not retained while its session stays open and idle.** Case 5: after the
  blocked ending the session idled and did not exit by itself. Reconcile observed it
  (`5b-reconcile.json`: action `observed`, session `open`/`idle`, "no result marker"), so it kept
  its work slot (1/2) and `taken`, and selection excluded the task as "1 taken", with no notice. It
  was retained only after its session was stopped (`5c-reconcile.json`). This is reconcile's
  existing rule: an attempt with no valid marker is retained once its session is no longer open
  (`src/attempts/reconcile.ts`, `decide`), and the prompt says "the attempt is kept once this
  session ends" (log). Not changed in this change.
- **The round number counts rounds that pushed fixes, not attempts.** Case 4's attempts 2 and 3 saw
  "This is round 1 of 1 ... 0 rounds pushed fixes" (`4b-prompt.md`, `4c-prompt.md`), since no
  attempt pushed. Attempt 3's logbook entry reads "Round: 1 (attempt 3)" (`4c-logbook.txt`). The
  agents word it differently elsewhere: case 7's quiet attempt wrote "Round: 2 (quiet)"
  (`7c-logbook.txt`) and case 5's attempt "Round 2." (`5a-logbook.txt`).
- **A dry `--task` run reports "would launch" without running the stage's prerequisites.** Case 7:
  `7-dry.json` (exit 0) has no select step and its launch step says "would launch external-review
  for github:pabloimrik17/grill-sandbox#24 ...". It is not a settled check; the pipeline dry run's
  select step is (`7-pre-select.json`).
- **A bot id outside the shipped three always gets WARNING.** Every `sbxbot` finding in cases 4, 5
  and 7's reports is WARNING (`4a-prompt.md`, `5a-prompt.md`). `botSeverity` reads a mark only for
  the ids `coderabbit` and `greptile`, and returns WARNING for any other id
  (`src/review-bots/severity.ts`). `sbxbot`'s CodeRabbit-like first lines did not decide its
  severity, so the sandbox could not exercise a severity mark.
- **The prompt's quiet-round sentence is shorter than the spec (observation).** `7c-prompt.md` line
  375 says the quiet round "resolves the threads an external review answered and nobody contested".
  finding-threads, "The quiet round resolves the answered threads", also leaves open a blocked
  thread and a human reviewer's thread whose finding was not fixed. Publish mode followed the spec:
  case 6 resolved the refuted bot thread, cases 4 and 7 left the blocked and the human thread open.

### Not verified

- 13.1, the bootstrap of `wrap-up`, `qa` and `ready-to-merge` on the real trackers: the go-ahead was
  withdrawn; only the preflight exists.
- 13.2, the real task from `code-review` to `wrap-up`: not approved.
- 13.3, the measurements of Greptile and Pullfrog and the defaults of `mention` and
  `answerWaitMinutes`: not approved.
- The real bots' behaviour: first lines, check runs, answers to a reply, timing, with the shipped
  30-minute wait and 10-minute answer wait. The sandbox bot is a workflow script.
- The state `reviewing` of a real bot. Only `sbxbot`'s `in_progress` workflow check run showed
  `reviewing` (`1a.json`, `3a.json`).
- The text form of case 1b.
- An `HITL` task, a fix pushed by an external review round, and a run with the loop running.
