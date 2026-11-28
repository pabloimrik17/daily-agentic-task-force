# External review stage verification

End-to-end checks of tasks 13.1–13.4. The plugin code under test is this feature worktree,
`feature/DOT-157-add-external-review-stage`, run from source. Phase 1 (cases 1, 2, 3 and 6) ran at
commit `d05be61`; phase 2 (cases 7, 5 and 4) ran at commit `be39496`, the fix of the defect case 1
found (see "Findings"). The worktree had only `bun.lock` modified in both phases (operator's log,
10:35:05 and 10:52:28). The real-tracker runs, 13.1 and 13.2, ran at commit `0045776`
(`verification-real/evidence-13/plugin-head.txt`), the head after the sandbox phases.

Go-aheads, all in the Plannotator Inbox thread "DOT-157 external review stage: implementación",
2026-11-28, relayed by the orchestrator (the thread is not in the evidence directory). At 10:16 the
user approved "Solo el sandbox (13.4) y el bootstrap (13.1)". At about 10:42 they approved the
bootstrap creating three labels, and one minute later withdrew it: "crea solo los que necesitemos
para las pruebas ... así validamos el proceso de bootstrap cuando toque". 13.4 ran first, from 10:35
to 11:23. At 12:16 they approved the full bootstrap, which ran as 13.1 (see its section). For 13.2
they chose the task DOT-121 in the same thread, confirmed keeping the merge of `main` into #90, and
answered Approve to the transition (see 13.2). 13.3 has its own section.

The raw files are in `~/.local/state/autonomous/verification-sandbox/evidence-13` and are cited by
file name. The operator's log (`operator-log.txt`) holds every step with its UTC time, its verdict
and its deviations; its times are when each line was written, not when the command started. The
runbook the operator followed states what each case intended; it is not in the evidence directory.
Where the log and a raw file disagree, the raw file wins and the text says so. Times are UTC. The
directory listing shows local time (UTC+1); this text converts it.

## 13.1 Bootstrap of `wrap-up`

Run on 2026-11-28 at 12:18 UTC, with the loop stopped. The user approved it in the Inbox thread at
12:16: "Ejecuta el bootstrap completo ahora (15 etiquetas) y registra el informe". This replaced the
go-ahead withdrawn at 10:37. The raw files of this section and of 13.2 and 13.3 are in
`~/.local/state/autonomous/verification-real/evidence-13`; its `operator-log.txt` holds each step
with its UTC time.

- **Loop stopped.** `pgrep` found no `run.ts` or `loop.ts` process (`pgrep.exit`: 1), and the
  pid 76811 named by `loop.lock` was dead and `run.lock` was absent (`locks-before.txt`,
  `loop-pid.exit`).
- **Configuration.** A copy of the real configuration that differs only in `sessions`
  (`config-diff.txt`), with the real state directory. The code is this worktree at `0045776`
  (`plugin-head.txt`).
- **Before** (`13.1-before.json`, 12:18:15): `qa`, `wrap-up` and `ready-to-merge` absent in
  `dotfiles`, `kinkoi-project`, `monolab`, `daily-agentic-task-force` and in Linear; Beads had no
  `wrap-up`.
- **The run** (`13.1-bootstrap.json`, exit 0, 12:18:15 to 12:18:31): `--bootstrap-labels --json`,
  schema `autonomous.bootstrap.v1`, outcome `advance`. GitHub: 12 labels `created` and
  48 `present` over the four repositories, none recoloured. Linear: `qa`, `wrap-up` and
  `ready-to-merge` `created`, the other 12 `present`. Beads: not applicable, "Beads needs no label
  creation: labels exist by use". 15 creations in all.
- **After** (`13.1-after.json`, 12:19:04, and an independent listing at 12:36, orchestrator only):
  the three labels exist in the four repositories and in Linear with the contract's colours
  (`qa` `0d9488`, `wrap-up` `64748b`, `ready-to-merge` `15803d`).

Not run: a second run to show that nothing is created twice. It was not approved.

## 13.2 Real task

Run on 2026-11-28 from 12:57 to 15:03 UTC on the real task `linear:DOT-121` ("Read GitHub blockers
in the selection reader", labels `personal`, `HITL`) and its pull request
`pabloimrik17/daily-agentic-task-force#90`, with the real bots. The code is this worktree at
`0045776` (`plugin-head.txt`), with the configuration copy of 13.1 (`config-diff.txt`: only
`sessions` differs). Sessions ran `opus` at effort `high` (`13.2-attempt-1/record.json`). The
runbook followed is `runbook-13-dot121.md` in the orchestrator's scratchpad; it is not in the
evidence directory. Each claim below names its raw file; a claim only the orchestrator saw is marked
"orchestrator only". Times are UTC; the directory listing shows local time (UTC+1).

### Task and preparation
- **Choice** (orchestrator only). The user picked DOT-121 in the Inbox thread at 12:16, over the
  scout's first candidate. No real task was in `code-review`. DOT-121 was already in
  `external-review` from an earlier build, so the orchestrator put it back by hand: added
  `code-review`, removed `external-review` (`13.2-reset-1.exit`, `13.2-reset-2.exit`). Read-back:
  labels `personal`, `HITL`, `code-review`; Linear state `backlog` (`13.2-reset-readback.json`;
  before: `13.2-task-before-query.json`).
- **Merge of `main`** (operator's log, 12:59:14). #90 conflicted with `main`. A merge of
  `origin/main`, not a rebase, was committed as `b059b1b` and pushed by 12:59. The commit was made
  with `--no-verify` because lint-staged's backup fails on a directory-to-symlink change that came
  from `main`; gitleaks and oxfmt were run by hand, and pre-push passed (3836 tests). The user
  confirmed keeping the merge and the edited delta spec at about 14:04 UTC (orchestrator only). Its
  CI (`main`, `audit`, `Fallow`) passed (`13.2-checks-before.tsv`). The log calls it the first CI on
  this work since 2026-11-15 (orchestrator only).
- **Preconditions** (operator's log, 12:59:40). #90 draft, `MERGEABLE`, head `b059b1b`; four
  threads, all resolved, all by the user's account (`13.2-threads-before.json`); workspace in sync
  with its remote (`13.2-workspace-before.txt`); attempts dir held no `external-review` attempt
  (`13.2-attempts-before.txt`); aoe baseline of 8 sessions (`aoe-baseline.tsv`).

### The transition marks the pull request ready
- **No dry mode.** `--transition` has no dry run. With `--apply` on a `HITL` task it only hands off
  the question: outcome `advance`, `applied` false, one question "the code review is ready. Approve
  it to move the task to external-review?" with the options Approve and Later
  (`13.2-transition-handoff.json`, 12:59:59). Labels and the draft were unchanged afterwards:
  `personal`, `HITL`, `code-review`, draft (operator's log, 13:00:08).
- **The answer.** The user answered Approve in the Inbox (orchestrator only; the log gives the
  message id and 13:02:24). `--apply --answer transition:linear:DOT-121=external-review`
  (`13.2-transition.json`, started 13:02:03, exit 0): status `applied`, "added external-review,
  removed code-review on linear DOT-121, read back".
- **Pull request marked ready** at 13:02:13 by the user's account (`13.2-ready-event.json`, one
  `ready_for_review` event), before the label change was read back. Labels after: `personal`,
  `HITL`, `external-review` (operator's log, 13:02:24). Call this T0.

### First wait, on `b059b1b`
- **Check runs while the bots reviewed** (`13.2-checks-timeline.tsv`, sampled about every 20 s from
  13:02:41):
  - CodeRabbit: `completed`, `neutral`, "Review rate limited", created and completed 13:02:22, 9 s
    after T0. It never changed.
  - Pullfrog: `in_progress` from 13:02:18, "Pullfrog is running"; `completed` `success` at 13:04:30.
    Its review (`COMMENTED`) is at 13:04:19 and its one inline thread at 13:04:18
    (`13.2-r1-threads.json`).
  - Greptile: no check run on any head of #90, at any time in the timeline. The user's note at about
    14:50 explains it: without quota (50 a month) it does not activate at all (operator's log;
    orchestrator only).
- **The wait as the run reports it** (`13.2-poll.log`, `--task` dry polls). Poll 1, 13:03:36:
  "greptile is waiting, 29 minutes left; pullfrog is reviewing". So the state `reviewing` was
  observed for a real bot, while its check run was `in_progress`. Poll 2, 13:08:57: "greptile is
  waiting, 24 minutes left", Pullfrog no longer listed. Polls 3 and 4: 20 and 16 minutes left
  (13:13:07, 13:17:17). No poll ran between 13:17 and 14:04, so the instant the wait ended was not
  observed. Poll 5, 14:04:32, exit 0: "would launch external-review for linear:DOT-121".
- **The same wait in the pipeline dry run** (`13.2-wait-1.json`, started 13:03:38, 10 s after poll 1
  at 13:03:28). The task is under `select` `data.excluded[]` with reason `waiting-for-review-bots`;
  `wait.bots`: `coderabbit` `not-reviewing` ("Review rate limited"), `greptile` `waiting` with
  `minutesLeft` 29, `pullfrog` `reported`; the only reason "greptile is waiting, 29 minutes left".
  The pipeline selected an unrelated Beads task. Pullfrog reads `reported` here and `reviewing` in
  poll 1, 10 s earlier: a pipeline dry run takes several minutes (label triage and the comparison),
  so its select step read the bots after Pullfrog's check had ended at 13:04:30. After the wait,
  `13.2-wait-2.json` (started 14:04:34) selected DOT-121 for `external-review` and did not list it
  as excluded.
- **No session during the wait.** `13.2-aoe-wait-1.diff` (written 13:03) is empty against the
  baseline, and so is `13.2-aoe-wait-2.diff` (14:04). The pipeline's reconcile step reported "2
  retained, nothing changed" in each, and no `external-review` attempt existed.
- **CodeRabbit's rate limit counts as settled.** It is `not-reviewing` and it appears in no wait
  reason; only Greptile's minutes held the task (`13.2-poll-1.json`).

### Round 1 (attempt 1)
- **Launch.** `--apply --task linear:DOT-121 --stage external-review` (`13.2-r1-launch.json`,
  started 14:09:28): "launched linear:DOT-121:external-review:1", aoe session `678a765a28e14eed`
  (`13.2-attempt-1/record.json`). The session title came from the fallback, because the generated
  name had five words, not one to four (`13.2-poll.log`, poll 5).
- **Report.** The prompt (`13.2-attempt-1/prompt.md`) lists, on `b059b1b`: Pullfrog reported;
  CodeRabbit not reviewing, review rate limited; Greptile not reviewing, no check run in 30 minutes;
  no failed check, no human thread (`13.2-attempt-1/stage-summary.md`).
- **Triage and question.** One finding, f1, from Pullfrog: the test file
  `github-listing-cap.test.ts` reads like a leftover probe (`13.2-attempt-1/findings.json`:
  `WARNING`, label `issue`, destination `fix`, refutation `survived`). The triage went to the
  Plannotator Inbox as a question, not through `AskUserQuestion`: thread
  `msg_01M8H7WTXFT3TS9DW0AV08PK74`, sent at about 14:10 (orchestrator only; the log records 0
  `AskUserQuestion`). The aoe status read `idle` from 14:10:52 to 14:16:49 and `running` again from
  14:17:10 (`13.2-r1-watch.log`). The user approved the triage (`findings.json`, `reason`: "The
  human approved the triage").
- **Record.** `findings.json` holds one entry; the receipt `published.json` is stamped 14:22:14.853;
  `persisted.json` 14:22:38 (stage summary saved); `logbook.json` 14:22:52.
- **Push.** The fix is one commit, `6011a37` "test(autonomous): move the listing cap sentinel test
  beside the reader (DOT-121)", pushed as `b059b1b..6011a37`; the record's head column changes at
  14:19:14 (`13.2-r1-watch.log`). Before the push the repository checks passed (3835 tests) and so
  did the hooks (`stage-summary.md`).
- **Reply.** The thread got "Status: fixed in 6011a37" with the `autonomous:resolution` marker,
  authored by the user's account at 14:22:18 (`13.2-r1-threads.json`). The runner left the thread
  open, since only the quiet round resolves (`stage-summary.md`). Pullfrog replied "Addressed in
  6011a37." at 14:22:52, 34 s after the runner's reply. The thread reads `isResolved` true and
  `isOutdated` true in that file. Pullfrog resolved it: `resolvedBy` is `pullfrog[bot]` (live
  GraphQL read-back by the verifier, 15:4x UTC).
- **Logbook entry** (`13.2-attempt-1/logbook-entry.md`, posted as a comment on #90): "Round 1 of 3",
  the push range, the three bots' state on `b059b1b`, "Threads, answered as fixed: f1".
- **Result** (`13.2-attempt-1/result.json`): `round-ended`, finished 14:23:07. The session was
  `idle` at 14:23:28.

### Between the rounds
- **A dry `--task` poll cannot show the wait while the attempt is unreconciled.** Poll 6 (14:24:09)
  said "linear:DOT-121 is excluded: taken", although the result was written at 14:23:07. An `--apply
  --task` run (`13.2-r1-finalise.json`, started 14:24:21) reconciled it: "1 attempt observed, 1
  finalised, 2 retained". Its launch step then waited, with one reason holding three facts:
  "coderabbit is reviewing; greptile is waiting, 25 minutes left; the review bots have 8 minutes
  left to answer the last external review reply". The answer wait is the 10 minutes after the
  runner's reply of 14:22:18.
- **The wait after the push** (`13.2-wait-3.json`, started 14:24:53; `13.2-poll.log`). `coderabbit`
  `reported`, `greptile` `waiting` 25 minutes, `pullfrog` `reported`; the reasons are Greptile's 25
  minutes and the answer wait, 8 minutes. Poll 7, 14:30:13: "greptile is waiting, 19 minutes left;
  the review bots have 3 minutes left to answer the last external review reply". From poll 8
  (14:34:25, 15 minutes) only Greptile remained, down to 4 minutes at poll 12 (14:45:43). Poll 13,
  14:50:01, exit 0: "would launch external-review". Greptile's 30 minutes were counted from the head
  commit's time, 14:19:02 (orchestrator only); poll 7 agrees (19 minutes left at 14:30).
- **Check runs on `6011a37`** (`13.2-checks-timeline.tsv`). Pullfrog `in_progress` 14:22:02,
  `completed` `success` 14:23:05; its reviews are at 14:22:52 and 14:23:01, both `COMMENTED`
  (`13.2-r1-threads.json`). CodeRabbit `in_progress` "Review in progress" from 14:22:17 to
  `completed` `success` "Finished" at 14:27:01. The final state shows a CodeRabbit review `APPROVED`
  (`13.2-final-state.txt`), submitted at 14:26:59 (live read-back by the verifier, 15:4x UTC).
  Greptile: none. CI `main`, `audit`, `Fallow` passed.
- **No session during the wait.** `13.2-aoe-wait-3.diff` (written 14:24) and `13.2-aoe-wait-4.diff`
  (14:50) are empty against the baseline.

### Round 2, the quiet round (attempt 2)
- **Launch** (`13.2-r2-launch.json`, started 14:50:04): "launched linear:DOT-121:external-review:2",
  aoe session `61f1447be15540fc`. Labels were `personal`, `HITL`, `external-review` (operator's
  log).
- **Report.** CodeRabbit reported and approved, with no finding; Pullfrog reported, "No new issues
  found"; Greptile not reviewing, no check run in 30 minutes; all checks green on `6011a37`; no
  human thread (`13.2-attempt-2/stage-summary.md`).
- **Record.** `13.2-attempt-2/findings.json`: `entries` empty, `quiet` true. Receipt
  `published.json` stamped 14:53:05, `quiet` true. Nothing pushed; head stays `6011a37`.
- **The quiet round's resolutions and dismissal were not exercised.** The one thread, f1's, was
  already resolved by Pullfrog and outdated, so the quiet round found nothing left to resolve, and
  `stage-summary.md` says publish mode "answered and resolved nothing new". No review on #90 was
  ever `CHANGES_REQUESTED` (`13.2-final-state.txt`: `COMMENTED` and one `APPROVED`), so there was
  nothing to dismiss. Case 6 of 13.4 covers both with a sandbox bot; the real bots did not.
- **Wrap-up approval.** It was asked with `AskUserQuestion` inside the aoe pane, not in the Inbox.
  The aoe status was `waiting` from 14:54:03 to 15:01:17 (`13.2-r2-watch.log`; the log says "about
  14:57"). The user was told in the Inbox that the pane was waiting (orchestrator only).
  `transition.json`: answer `["wrap-up"]`, by `human`, at 15:01:57.
- **Logbook and result.** `logbook.json` 15:02:04, with "Round 2, the quiet round"; `result.json`:
  `completed`, finished 15:02:13; session `idle` at 15:02:20.

### Final state
- `13.2-final-dry.json` (15:02:42, dry): reconcile "1 would-finalise", launch "excluded: taken".
  `13.2-final.json` (`--apply --task` without `--stage`, 15:02:46): reconcile "1 finalised"; launch
  "linear:DOT-121 is excluded: unsupported stage". Nothing launched.
- **Labels**: `personal`, `HITL`, `wrap-up` (`13.2-final-state.txt`). **Linear state**: `started`;
  it was `backlog` before (`13.2-reset-readback.json`). Linear's `issue.history` (live read-back by
  the verifier, 15:4x UTC) dates the move: Backlog to In Progress at 13:02:16, by the user's
  account, during the transition (3 s after the ready event). Likely Linear's GitHub integration;
  not confirmed.
- **Pull request**: `OPEN`, not a draft, head `6011a37`, `MERGEABLE`, `reviewDecision` empty, six
  reviews, in order: the user, Pullfrog, the user, Pullfrog, Pullfrog (all `COMMENTED`) and
  CodeRabbit (`APPROVED`) (`13.2-final-state.txt`);
  the branch equals its remote; `pgrep` found no `run.ts` or `loop.ts` process.
- **Rounds**: 2 of the limit 3.
- **No session open in any of the four waits**: `13.2-aoe-wait-1.diff` to `13.2-aoe-wait-4.diff` are
  all empty.

### Not exercised by the real run

A contested answer, a human reviewer's thread, a round past the limit, a dismissal, a resolution by
the quiet round, an `AFK` task and a run with the loop running. The first four and the AFK case are
covered only by the sandbox cases of 13.4.

### Findings of the real run
- **A dry `--task` poll hides the wait while the last attempt is not reconciled.** After round 1 it
  said "excluded: taken" (poll 6, `13.2-poll-6.json`); the wait appeared only after an `--apply
  --task` run finalised the attempt (`13.2-r1-finalise.json`). The wait cannot be observed with a
  dry `--task` in that window.
- **`--transition` has no dry mode.** `--apply` on a `HITL` task hands off the question and applies
  nothing; `--apply --answer` applies it (`13.2-transition-handoff.json`, `13.2-transition.json`).
- **The Linear state changed from `backlog` to `started`** at 13:02:16, during the transition,
  with no step of the runner that writes it. The actor is the user's account; likely Linear's
  GitHub integration reacting to ready-for-review (not confirmed).
- **Pullfrog resolves its own thread** when it considers the finding addressed, so a thread the
  runner holds open can still be resolved before the quiet round.
- **A rate-limited CodeRabbit counts as settled.** Its `neutral` "Review rate limited" check made it
  `not-reviewing`, so it did not hold the wait (`13.2-wait-1.json`). It reviewed only after the
  push: `in_progress` 14:22:17, approved.
- **Greptile without quota never creates a check run**, so its 30-minute wait always runs to its
  end: about 13:02 to 13:33 in the first wait (first seen ended at 14:04) and 14:19 to 14:49 in the
  second (seen at 14:50).
- **The two HITL questions of the stage appeared in different places.** The triage of round 1 went
  to the Plannotator Inbox; the wrap-up approval of round 2 was asked with `AskUserQuestion` in the
  aoe pane. The aoe status was `idle` during the first and `waiting` during the second.
- **The session title came from the fallback** every time: polls 5 and 13 (`13.2-poll.log`),
  `13.2-wait-2.json`, and both launches (`titleSource` `fallback` in `13.2-attempt-1/record.json`
  and `13.2-attempt-2/record.json`): the generated name had five words and the validator wants one
  to four.

## 13.3 Measurements of Greptile and Pullfrog

Run on 2026-11-28 from 14:22 to 15:43 UTC, after DOT-121 reached `wrap-up`, so no round could read
the replies as findings. Raw files: `13.3-*` in `verification-real/evidence-13`. The user chose
the order in the Inbox thread at about 15:02: first the resolved thread of #90 and, only with no
answer there, a throwaway pull request (orchestrator only).

| Bot      | Reply                                   | Answer in the thread   | New check run             |
| -------- | --------------------------------------- | ---------------------- | ------------------------- |
| Greptile | none sent                               | not measurable         | not measurable            |
| Pullfrog | no mention, a push in flight (#90)      | 34 s, "Addressed in"   | the push's own run        |
| Pullfrog | no mention, resolved thread (#90)       | none in 15 minutes     | none                      |
| Pullfrog | no mention, open thread (#120)          | none in 15 minutes     | none                      |
| Pullfrog | `@pullfrog`, the same open thread (#120) | 71 s                   | one, 15:41:47 to 15:43:01 |

The 71 s is the substantive answer. A placeholder, "Review submitted. Leaping into action...", came
3 s after the mention and was later replaced.

- **Greptile: not measurable.** It left no check run, review or comment on any head of #90 or on
  #120 (`13.2-checks-timeline.tsv`, `13.3-probe-checks.tsv`). Its organisation is out of credits
  since 2026-11-26 (`pabloimrik17/monolab#448`), and the user confirmed that without quota it does
  not activate at all. Nothing was sent to it: neither "answers without a mention" nor "a mention
  starts a full review" was measured.
- **Pullfrog with a push in flight** (round 1 of 13.2, not a clean measurement). The runner replied
  "Status: fixed in 6011a37" at 14:22:18 and Pullfrog answered "Addressed in 6011a37." at 14:22:52
  (`13.2-r1-threads.json`). Its check run on the pushed commit ran from 14:22:02 to 14:23:05, so
  the answer may belong to that review of the push.
- **Pullfrog, no mention, resolved thread.** Reply at 15:03:40 on the thread of round 1, resolved
  and outdated (`13.3-M2-reply.json`). In 15 minutes: no comment in the thread, no review, no new
  check run (`13.3-M2-observe.tsv` records the thread and reviews; `13.2-checks-timeline.tsv` shows
  no new run on `6011a37` through 15:45). The resolved state is a confound.
- **The throwaway pull request.** `pabloimrik17/daily-agentic-task-force#120`, branch
  `chore/review-bot-reply-probe`, one commit `74b19c3` with a port parser that accepts "80abc".
  Pullfrog's check ran from 15:24:10 to 15:25:16 and left one open inline thread on the flaw;
  CodeRabbit was "Review rate limited" again (`13.3-probe-checks.tsv`,
  `13.3-probe-threads-before.json`).
- **Pullfrog, no mention, open thread.** Reply at 15:25:41 (`13.3-M2b-reply.json`). Up to 15:41: no
  comment, no review, no check run (`13.3-M2b-observe.tsv`). Pullfrog does not answer a bare reply.
- **Pullfrog with a mention.** Reply starting with `@pullfrog` at 15:41:42 on the same thread
  (`13.3-M4-reply.json`). A workflow run "Address reviews on #120" started at 15:41:48 and Pullfrog
  answered in the thread at 15:42:53, 71 s after the mention. A placeholder, "Review submitted.
  Leaping into action...", came as a thread comment and a review at 15:41:45, 3 s after the
  mention (`13.3-M4-observe.tsv`); it is not in the final thread and was later replaced by the
  answer. The answer concedes that the finding has no
  caller (`13.3-M4-observe.tsv`, `13.3-probe-threads-after.json`). The `pullfrog` check run of the
  head was replaced by a new one, 15:41:47 to 15:43:01 (`13.3-probe-checks-after.tsv`). It posted
  no new review summary and pushed nothing: the head stayed `74b19c3`.
- **Cleanup.** #120 was closed without merging at 15:43, and its branch and worktree were deleted.
- **CodeRabbit** was not part of the task and could not be measured: rate limited on #120 and on
  the first head of #90.

### Proposal for the defaults

The sample is two pull requests on one day, with Greptile missing.

- **`mention`**: Pullfrog answers a reply only when it is mentioned, and the mention costs one
  agent run of the Pullfrog workflow on the repository's own model key for each reply. Proposed:
  keep `null` for the three bots, and document `"@pullfrog"` as the value that makes Pullfrog
  answer. Greptile's and CodeRabbit's values stay unmeasured.
- **`answerWaitMinutes`**: the one measured answer took 71 s, and its check run ended 79 s after
  the mention, so the wait for a running check already covers it. With `mention` `null` the answer
  wait serves only bots that answer a bare reply, which this run could not measure. Proposed: keep
  `10` until Greptile and CodeRabbit are measured. A reader of the thread that counts the first bot
  comment as the answer would see the placeholder first, 3 s after the mention, not the answer.

### Decision

On 2026-11-28 the user decided in the Inbox thread to change Pullfrog's default `mention` to
`"@pullfrog"`, on the condition that the mention starts an agent run for the message and not a
full review, which is what was measured once; what a mention does with several open threads was not
measured. They also decided to keep `answerWaitMinutes` at 10 until Greptile and CodeRabbit are
measured. CodeRabbit and Greptile keep `null`.

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

- 13.1, a second bootstrap run to show that nothing is created twice: not approved.
- 13.2, the quiet round's resolutions and dismissal against real bots: round 2 found nothing to
  resolve or dismiss (see "Not exercised by the real run" in 13.2). The sandbox covers them with a
  script bot (case 6).
- 13.2, a contested answer, a human reviewer's thread, a round past the limit, an `AFK` task and a
  run with the loop running.
- 13.3, Greptile's two measurements (no credits) and any measurement of CodeRabbit (rate limited).
  The default of `mention` was changed for Pullfrog only, after this measurement (see 13.3, Decision); `answerWaitMinutes` was not.
- The real bots' answers to a reply, and the answer wait with the loop running. The 30-minute wait
  and the 10-minute answer wait were observed once each against CodeRabbit, Greptile and Pullfrog
  (13.2).
- In the sandbox phases only: the state `reviewing` of a real bot. 13.2 observed it for Pullfrog
  (poll 1) and CodeRabbit (`13.2-r1-finalise.json`).
- The text form of case 1b.
- A fix pushed by an external review round and an `HITL` task are covered by 13.2, not by the
  sandbox cases.
