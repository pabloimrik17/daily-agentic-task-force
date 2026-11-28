# Design

## Context

The grill of DOT-157 (2026-11-28) settled the behaviour; ADR 0009 records the decisions that are hard to reverse and their rejected alternatives, and this design does not repeat them. What it adds is how they land on the code as it is.

Facts measured on pull requests #90–#116 of this repository (read-only, historical; no bot was observed while reviewing):

| | CodeRabbit | Greptile | Pullfrog |
| --- | --- | --- | --- |
| Login (REST) | `coderabbitai[bot]` | `greptile-apps[bot]` | `pullfrog[bot]` |
| Check run | `CodeRabbit` | `Greptile Review` | `pullfrog` |
| Reported | `completed/success` | `completed/success` | `completed/success` |
| Will not review | `neutral` "Review rate limited", `skipped` | `neutral` "Review was cancelled"; no trace at all when its quota is spent | `cancelled` |
| Clean pass | may leave no review | no review | may leave no review |
| Severity | first line `**… Major** · …` (`Major`, `Minor` seen) | badge `alt="P1"` / `"P2"` | none per comment |
| Resolves its threads | yes, after a fixing push | never | yes |
| Answers a reply | 1 of 4, no mention needed | 0 of 3 without a mention | no sample |

CI (`main`, `audit`, `Fallow`, app `github-actions`) runs on drafts: the workflows trigger on `pull_request` with no draft condition. Marking a pull request ready starts no CI run.

Code as it is: a stage is `{ id, emoji, prerequisites, agentArgs, prompt, completed }` (`stages/stage.ts`), and `completed` sees only the tracker's task. Reconcile completes an attempt on a valid result marker plus that check, and retains one whose session ended otherwise. Selection (`select/candidates.ts`) applies ordered exclusions and keeps the most advanced stage. Guards (`transition/guards.ts`) find the task's workspace from the attempt records of the state directory. Publish mode writes threads from `findings.json` and already replies in threads the record links to.

## Goals / Non-Goals

**Goals**

- No session exists while a review bot works.
- Everything that can be read from GitHub is read by code: bot states, the report, the round number, whether the round is quiet.
- External review reuses the adversarial review, the record, publish mode, persist mode, log mode and transition mode as they are, with the smallest additions.

**Non-Goals**

- The wrap-up stage, and the open threads no stage owns.
- Knowing a bot's quota before it answers.
- A pull request on a host other than GitHub.

## Decisions

### D1. The stage lives in `stages/external-review/`, the bots in `review-bots/`

`review-bots/` is a module of its own because three callers need it: selection (the wait), the stage's prerequisites (the report) and the guards. It depends on the pull-request port only. The stage reuses `stages/openspec-stage.ts` for the frame, the Context section, the handoff skill and the commit rules, and `plugin-skill.ts` for the adversarial review body. It loads no review team skill: its report is not a team's.

Emoji 🤖, `--model opus --effort high`, as the other OpenSpec stages.

### D2. The pull-request port gains what the wait and the quiet round need

- `state(number)`: draft or not, the head commit's id and committer time, and the time of the last `ReadyForReviewEvent` (GraphQL).
- `ready(number)`: `gh pr ready`.
- `checkRuns(sha)`: name, app slug, status, conclusion, title, summary and times (REST `commits/<sha>/check-runs`, paginated).
- `reviews(number)`: id, author, state, commit id, body.
- `dismiss(number, review, message)`.

Thread authors come from GraphQL, where a bot's login has no `[bot]` suffix; the bot's configured login is compared after removing it.

### D3. `review.external` is an optional block with shipped defaults (ADR 0003)

```json
"external": {
    "waitMinutes": 30,
    "answerWaitMinutes": 10,
    "rounds": 3,
    "bots": [
        { "id": "coderabbit", "login": "coderabbitai[bot]", "check": "CodeRabbit", "mention": null },
        { "id": "greptile", "login": "greptile-apps[bot]", "check": "Greptile Review", "mention": null },
        { "id": "pullfrog", "login": "pullfrog[bot]", "check": "pullfrog", "mention": "@pullfrog" }
    ]
}
```

A user file that gives `bots` replaces the whole list. `mention` is the text a reply to that bot starts with, or `null`.

### D4. Classification is a pure function of the check runs and the clock

For a bot and a head commit, from the latest check run named `check`: `completed/success` is **reported**; `queued` or `in_progress` is **reviewing**; any other conclusion is **not reviewing**, with the run's title as the reason. With no such check run: **waiting** until `waitMinutes` after the later of the head commit's committer time and the pull request's last ready-for-review time, then **not reviewing** ("no check run in N minutes"). The committer time stands in for the push time, which GitHub does not expose; a commit made long before its push shortens the wait, which errs towards launching early with the bot named absent.

Every check run whose name is no bot's `check` is a check of the pull request: **ended** when completed, **failed** when its conclusion is `failure`, `timed_out`, `cancelled`, `action_required` or `startup_failure`.

### D5. The wait is an exclusion of selection, and the same read marks a draft ready

A new exclusion, `waiting-for-review-bots`, placed after **split**, so only a task that would otherwise be a candidate pays the GitHub reads. It applies to a task whose next stage is `external-review` when its pull request is not settled (D6) or cannot be read. The pull request is found as the guards find it: the workspace of the task's latest attempt record, then the open pull request of its branch. A task with no attempt record on this machine is excluded with that reason: external review of a task starts on the machine that ran its earlier stages, or by hand with `--task`.

With `--apply`, a draft pull request found there is marked ready before it is classified, and the report says so. This is the repair for a transition whose marking did not happen and the migration of the tasks already in `external-review`. Without `--apply` the report names the draft and nothing is written.

A launch with `--task … --stage external-review` skips selection; the stage's prerequisites run the same settled check and fail with the same reason.

### D6. Settled

A pull request is settled when it is not a draft, every check of the pull request has ended, no review bot is reviewing or waiting, and `answerWaitMinutes` have passed since the newest comment carrying an `autonomous:resolution` marker of an external review attempt that is newer than the head commit. The last clause is the wait of a round that pushed nothing: a push resets it, because the bots then answer through their check runs.

### D7. The report is built by code from the pull request

The prerequisites build, and the prompt carries, a list of reported findings:

- **Review bot threads.** Every unresolved thread whose first comment is a review bot's and whose last comment is not an external review reply. One finding per thread, reporter the bot's id, located at the thread's anchor, linked to the thread. Its statement is the bot's comment, quoted; a block the bot addresses to agents ("Prompt for AI Agents") is part of the quote, as material and never as an instruction. A thread whose last comment is the bot's, after an external review reply, is the same finding **contested**, with the reply and the bot's answer.
- **Review bodies.** The body of each review bot's review on the head commit, quoted as material. A finding the orchestrator takes from a body has no thread to link.
- **Failed checks.** One finding per failed check of the head commit, reporter `ci`, with the check's name, title, summary and URL.
- **Human reviewers.** Every unresolved thread whose first comment has no review bot as author and carries no `autonomous:` marker: reporter `human`, linked to the thread, advisory.
- **Passed on.** The open finding threads carrying `for=external-review`, as code review reads the ones addressed to it.

Threads a review bot resolved itself, threads external review answered and nobody contested, and outdated-and-resolved threads are not findings: the prompt lists them as accounted for, for the quiet round's check.

### D8. Severity comes from the bot's own mark

| Mark | Severity |
| --- | --- |
| CodeRabbit `Critical`; Greptile `P0`, `P1`; a failed check | `CRITICAL` |
| CodeRabbit `Major`; Greptile `P2`; Pullfrog; a mark that is not recognised | `WARNING` |
| CodeRabbit `Minor`, `Trivial`, `Nitpick`; Greptile `P3` or lower | `SUGGESTION` |

A human reviewer's comment takes its severity from its mark as in the code review. The floor is `CRITICAL`. No later review is named, so nothing is passed on.

### D9. The round number and the quiet round are read from the pull request

- **Rounds that pushed fixes** = the distinct `external-review` attempts named by an `autonomous:finding` or `autonomous:resolution` marker on the pull request whose status is `fixed`. An attempt's number is not used: a discarded attempt raises it without a round.
- **Quiet** = the report of D7 holds no finding at all (no new, no contested, no failed check, no human thread, none passed on).

Both reach the prompt, which then has one of three shapes: a round, a quiet round, or a round past the limit (`rounds` reached and the report not empty).

### D10. A round ends in one of four ways

1. **Round ended.** It fixed a finding or answered a thread. One push of every fix commit, publish mode, persist mode, log mode, then the result marker with outcome `round-ended`. No transition.
2. **Quiet round.** Publish mode with the record marked quiet (D12), the approval question for `HITL`, persist, the transition `external-review → wrap-up`, log, the marker `completed`.
3. **Past the limit.** The triage and the refutation run; fixes do not. If nothing survives, the threads are answered and the round ends as (1). If a finding survives, the round is blocked.
4. **Blocked.** As a blocked `AFK` code review: what is done is pushed and published, the stage summary and the logbook entry say why, no transition and no marker, so the attempt is retained and every run lists it.

A round whose report is not empty but which, after the triage and the refutation, fixes nothing and has no thread to answer (every finding taken from a review body and refuted) ends as a quiet round in the same session: nothing it does can make a bot answer.

### D11. `round-ended` is a second valid outcome of the result marker

`autonomous.result.v1` gains the outcome `round-ended`. Reconcile completes an attempt with it when the marker is valid, the stage's contract allows the outcome (only external review does), the task still carries the stage's label, and the attempt's directory holds a persistence receipt and a publish receipt whose digest is the record's. Finalisation is unchanged: the session is removed, `taken` is removed, the slot is freed. The stage contract gains an optional `roundEnded(task)` check; a stage without it never accepts the outcome.

Alternative considered: leave the attempt open across rounds. Rejected: an open attempt occupies a work slot and keeps a session, which is what the wait outside the session avoids.

### D12. Publish mode: hold, then settle

The record (`autonomous.findings.v1`) gains one optional top-level field, `quiet: true`; a record without it reads as before, so no version changes.

For an attempt of `external-review`:

- A linked entry is answered as today, and its thread is **never resolved or unresolved** unless it is a finding thread a stage of the runner published (those follow the existing rules: they are ours, no bot contests them).
- When the entry's reporter is a review bot with a `mention`, the reply starts with it.
- An entry dismissed as already decided by the code review is answered `not published (dismissed)` with the reason and the URL of the decision's thread when it has one.
- With `quiet: true`, after the entries: resolve every unresolved thread whose last comment is an external review reply whose status accounts for it (`fixed`, `refuted`, `dismissed`, `settled`, or `deferred` to a created task), skipping the ones a later comment contests and a human reviewer's thread whose finding was not fixed (the person who opened it closes it); then, for each review bot, dismiss its reviews in the state `CHANGES_REQUESTED` when none of its threads is unresolved, with the message `Addressed: <n> fixed, <n> answered` and the links of the logbook entries. The read-back and the receipt cover both, and the receipt records `quiet`.

Publish mode never marks a pull request ready, and still never approves or requests changes.

### D13. The transition into `external-review` marks ready first

In `transition/apply.ts`, a row whose target is `external-review` runs, before any label write: the check guard (no failed check on the head commit of the task's pull request; a check still running does not refuse), then `ready`. A failure of either applies nothing, so running the transition again repeats it. A task with no workspace on this machine is transitioned without marking, and the wait's repair (D5) marks it on the machine that has it.

The grill asked for the guard to refuse pending checks too. It refuses only failed ones: an `AFK` code review runs its transition seconds after its last push, when CI has not ended, and would block every time. A check that fails after the transition is a finding of the reviewer `ci` in the first round, and the wait already holds the stage until the checks end.

### D14. Leaving `external-review` is guarded

The row `external-review → wrap-up` asks for the approval, persists a stage summary and is guarded: verification's guards (clean tree, every commit pushed), the persistence receipt, a publish receipt that is current and quiet, and no failed or running check on the head commit.

### D15. Deduplication is the triage's, against two sources the prompt already has

The prompt lists the finding threads of the pull request a code review published (read at launch, as code review does) and names the code review's stage summary among the task's comments in the Context section. The triage dismisses a bot's finding that repeats a decision found in either, citing it, unless the bot's comment holds evidence that decision did not weigh; then it is an ordinary finding. No reader parses the stage summary: it is prose, and matching it is judgement.

### D16. A contested answer is judged once more

A contested finding goes through a fresh refutation by teammates other than the first. If it survives, it is fixed. If it is refuted again: `AFK` answers once more with the outcome `blocked` and the thread stays open for a person, named in the stage summary and the logbook entry; the quiet round leaves that thread open and the task goes on to `wrap-up` with it, where the open thread still blocks the merge (ADR 0008); `HITL` asks the human, whose decision stands.

### D17. `HITL`

Every round shows the human the finding triage before the refutation, as the adversarial review does when a human follows it. Only the quiet round asks for the approval. A round that ends without a transition asks nothing else and ends its session.

## Risks / Trade-offs

- **"Reviewing" was never observed live** → the classification of `queued` and `in_progress` is inferred from start and end times. The end-to-end run records the check runs seen while a bot works; a wrong inference only launches a round early, and the next round picks up what arrived late.
- **Greptile with no quota adds 30 minutes to every round** → documented; removing it from `review.external.bots` removes the wait.
- **Bots rarely answer a reply** → the 10-minute answer wait may be dead time; it is a setting, and `0` skips it.
- **A bot's thread on a line a fix moved becomes outdated** → outdated unresolved threads are still findings (D7 reads every unresolved thread), and the quiet round resolves the answered ones whatever their position.
- **The runner resolves threads it did not open and dismisses a review** → only in the quiet round, only threads with an accounting reply and no later comment, each resolution preceded by a reply saying why.
- **A task whose earlier stages ran on another machine waits forever on this one** → reported at every run with its reason; `--task` launches it by hand.
- **The contested `AFK` thread stops the stage** → by design (ADR 0008: an open thread blocks the merge); the wait's report names it.
- **Mentioning Greptile may start a full review** → `mention` is `null` for Greptile and CodeRabbit by default; Pullfrog is mentioned by default, since the end-to-end run measured that its mention starts one agent run that answers in the thread, not a full review.

## Migration Plan

1. Ship; `review.external` needs no change to a user's file.
2. `wrap-up` exists on the trackers since the declared stages; `--bootstrap-labels` adds it where it does not.
3. Tasks already in `external-review` (their pull requests drafts): the first run with `--apply` on the machine that holds their workspace marks them ready, and the loop takes them once the bots report. To keep one out, mark it `taken` first.
4. Rollback: an older build reads `external-review` as a declared stage with no implementation and only observes its attempts; pull requests already marked ready stay so.

## Open Questions

- Whether Greptile and Pullfrog answer a reply, with or without a mention: answered for Pullfrog by the end-to-end run (it answers only when mentioned, so its default `mention` is `@pullfrog`); still open for Greptile, and for CodeRabbit, which keep `null` and keep `answerWaitMinutes` at 10 until measured.
