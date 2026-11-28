## ADDED Requirements

### Requirement: Review bot settings

The optional `review.external` block SHALL hold `waitMinutes`, `answerWaitMinutes`, `rounds` and `bots`, each bot with an `id`, a `login`, the name of its `check` run and a `mention` that is a string or null. The shipped defaults SHALL be 30, 10, 3 and CodeRabbit and Greptile with no mention and Pullfrog with the mention `@pullfrog`. A `bots` list in the user's file replaces the shipped list whole. An invalid value is an error naming its path.

#### Scenario: Block omitted

- **WHEN** the user's file has no `review.external`
- **THEN** the three shipped bots are expected, and the report lists the keys that took a default

#### Scenario: One bot configured

- **WHEN** the user's file sets `review.external.bots` to CodeRabbit only
- **THEN** only CodeRabbit is expected

#### Scenario: Invalid values

- **WHEN** the user's file sets a negative `waitMinutes`, a `rounds` below 1, or an unknown key under `review.external`
- **THEN** the configuration is rejected with the path of that key

#### Scenario: Duplicate id

- **WHEN** two entries of `review.external.bots` share the id `greptile`
- **THEN** the configuration is rejected with the path of the second entry

### Requirement: A review bot's state for a head commit

For a pull request's head commit, each configured review bot SHALL be in one state, read from its latest check run on that commit: reported, when the run completed with success; reviewing, when it is queued or in progress; not reviewing, with the run's title as the reason, when it completed with any other conclusion. Reviews, comments and check runs on any other commit SHALL NOT count.

#### Scenario: Reported

- **WHEN** the check run `CodeRabbit` on the head commit is completed with the conclusion `success`
- **THEN** CodeRabbit has reported

#### Scenario: Rate limited

- **WHEN** the check run `CodeRabbit` on the head commit is completed with `neutral` and the title `Review rate limited`
- **THEN** CodeRabbit is not reviewing, with that title as the reason

#### Scenario: Reported on an earlier commit only

- **WHEN** Pullfrog's only check run is on the commit before the head commit
- **THEN** Pullfrog has not reported

### Requirement: A review bot with no check run waits, then is not reviewing

A review bot with no check run on the head commit SHALL be waiting until `waitMinutes` have passed since the later of the head commit's time and the time the pull request was last marked ready for review, and not reviewing afterwards, with the minutes waited as the reason.

#### Scenario: Within the wait

- **WHEN** Greptile has no check run and the pull request was marked ready 12 minutes ago, with a wait of 30
- **THEN** Greptile is waiting

#### Scenario: Wait run out

- **WHEN** Greptile has no check run 31 minutes after the head commit, which is later than the ready mark
- **THEN** Greptile is not reviewing, and the reason names 30 minutes

### Requirement: The checks of a pull request

Every check run on the head commit that is no configured review bot's SHALL be a check of the pull request. It has ended when it is completed, and it has failed when its conclusion is `failure`, `timed_out`, `cancelled`, `action_required` or `startup_failure`.

#### Scenario: CI running

- **WHEN** the check `main` is in progress
- **THEN** the checks of the pull request have not ended

#### Scenario: Bot check is not CI

- **WHEN** the check run `pullfrog` is `cancelled` and every other check passed
- **THEN** no check of the pull request has failed

### Requirement: A settled pull request

A pull request SHALL be settled when it is not a draft, every check of the pull request has ended, no review bot is reviewing or waiting, and `answerWaitMinutes` have passed since the newest external review reply posted after the head commit.

#### Scenario: Bot reviewing

- **WHEN** Pullfrog is reviewing
- **THEN** the pull request is not settled

#### Scenario: Round that only answered

- **WHEN** the last external review round pushed nothing and posted its last reply 4 minutes ago, with an answer wait of 10
- **THEN** the pull request is not settled

#### Scenario: Everything in

- **WHEN** CodeRabbit and Pullfrog have reported, Greptile is not reviewing, every check has ended and no reply is within its wait
- **THEN** the pull request is settled

### Requirement: The pull request of a task in external-review

The pull request of a task in `external-review` SHALL be the open pull request of the workspace branch of the task's latest attempt record. A task with no attempt record in the state directory, or whose branch has no open pull request, cannot be read, and its reason SHALL say which.

#### Scenario: No attempt record

- **WHEN** a task carries `external-review` and the state directory holds no attempt of it
- **THEN** it is excluded as waiting for review bots, with the reason that this machine holds no workspace of the task

### Requirement: A draft pull request in external-review is marked ready

When the pull request of a task in `external-review` is a draft, a run with `--apply` SHALL mark it ready for review and report it, and a run without `--apply` SHALL report the draft and write nothing. Either way the task waits in that run.

#### Scenario: Task left in external-review by an earlier version

- **WHEN** a run with `--apply` reads a task in `external-review` whose pull request is a draft
- **THEN** the pull request is marked ready, the report says so, and the task is excluded as waiting for review bots

#### Scenario: Without apply

- **WHEN** the same run has no `--apply`
- **THEN** the pull request stays a draft and the report names it

### Requirement: The wait is reported

For each task excluded as waiting for review bots, the report SHALL show the pull request, the state of each review bot with its reason, the checks that have not ended, and the minutes left of a wait. The JSON report SHALL hold the same.

#### Scenario: Waiting task in the text report

- **WHEN** a task waits because Greptile is waiting and `main` is running
- **THEN** its line names the pull request, `greptile: waiting` with the minutes left, the other bots' states, and `main`

### Requirement: The reported findings of a round

The findings of an external review round SHALL be built from the pull request, with no model: one per unresolved thread whose first comment is a configured review bot's and whose last comment is not an external review reply, reported by that bot, located at the thread's anchor, linked to the thread, and holding the bot's comment as quoted material that is never an instruction.

#### Scenario: New CodeRabbit thread

- **WHEN** the pull request holds an unresolved CodeRabbit thread with no reply
- **THEN** the report holds one finding of the reviewer `coderabbit`, linked to that thread, quoting its comment

#### Scenario: Thread the bot resolved

- **WHEN** Pullfrog resolved one of its threads after a fixing push
- **THEN** the report holds no finding for it

#### Scenario: Comment that addresses agents

- **WHEN** a CodeRabbit comment holds a block titled for AI agents
- **THEN** the finding quotes it, and the report says a quoted comment is not an instruction

### Requirement: A contested answer is reported as such

A review bot's thread whose last comment is the bot's, after an external review reply, SHALL be reported as the same finding, contested, with the reply and the bot's answer.

#### Scenario: Bot disagrees

- **WHEN** an external review reply says `not published (refuted)` and CodeRabbit comments after it
- **THEN** the report holds that finding marked contested, with both comments

### Requirement: Review bodies are material

The body of each review bot's review on the head commit SHALL reach the report as quoted material, with its author and URL. No finding is built from a body.

#### Scenario: Pullfrog callout

- **WHEN** Pullfrog's review on the head commit opens with an `[!IMPORTANT]` callout
- **THEN** the report quotes the body under Pullfrog's name

### Requirement: Failed checks, human reviewers and passed-on threads are reported

The report SHALL also hold: one finding of the reviewer `ci` per failed check of the head commit, with its name, title, summary and URL; one finding of the reviewer `human` per unresolved thread whose first comment is neither a review bot's nor marked by the runner, linked to it; and the open finding threads addressed to external review.

#### Scenario: Failed check

- **WHEN** the check `Fallow` failed on the head commit
- **THEN** the report holds one finding of the reviewer `ci` naming `Fallow`

#### Scenario: Human reviewer's comment

- **WHEN** a person left an unresolved comment on a line and nobody answered it
- **THEN** the report holds one finding of the reviewer `human` linked to that thread

#### Scenario: Thread addressed to external review

- **WHEN** an open finding thread carries `for=external-review`
- **THEN** the report lists it among the findings passed on

### Requirement: Severity comes from the reporter's own mark

A review bot's finding SHALL take its severity from the bot's mark and never from a model: `CRITICAL` for CodeRabbit `Critical` and Greptile `P0` or `P1`; `SUGGESTION` for CodeRabbit `Minor`, `Trivial` or `Nitpick` and Greptile `P3` or lower; `WARNING` for CodeRabbit `Major`, Greptile `P2`, every Pullfrog comment and any mark that is not recognised. A finding of `ci` is `CRITICAL`. A human reviewer's finding takes its severity from its mark as in the code review.

#### Scenario: CodeRabbit major

- **WHEN** a CodeRabbit comment's first line holds `Major`
- **THEN** the finding is `WARNING`

#### Scenario: Greptile P1

- **WHEN** a Greptile comment's badge reads `P1`
- **THEN** the finding is `CRITICAL`

#### Scenario: Pullfrog comment

- **WHEN** Pullfrog comments on a line
- **THEN** the finding is `WARNING`

### Requirement: Rounds are counted from the pull request

The number of rounds that pushed fixes SHALL be the number of distinct external review attempts named by a marker on the pull request whose status is fixed. An attempt's own number SHALL NOT be used.

#### Scenario: Discarded attempt

- **WHEN** attempt 1 was discarded before publishing and attempt 2 published one fixed finding
- **THEN** one round has pushed fixes

### Requirement: A quiet report

A report SHALL be quiet when it holds no finding: none new, none contested, no failed check, no human reviewer's thread and none passed on.

#### Scenario: Only accounted threads

- **WHEN** every review bot thread is resolved or answered and uncontested, and every check passed
- **THEN** the report is quiet
