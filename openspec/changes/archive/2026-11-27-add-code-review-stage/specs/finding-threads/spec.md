## Purpose

Findings published on a task's pull request as finding threads, which hold each finding's state (ADR 0008): the record a stage writes, what publish mode publishes from it and in which state, the comment format and its markers, anchoring, replies and resolutions, idempotency, and the publish receipt.

## ADDED Requirements

### Requirement: The record of the findings

A stage that publishes SHALL keep its record in `findings.json` in the attempt's directory, identified by `schema: "autonomous.findings.v1"`. It holds every finding and doubt of every review round: its id, round, reporters, title, statement, location, severity, label, destination and reason, refutation outcome and reproduction, publication state, and the thread it continues, if any.

#### Scenario: Record of a round

- **WHEN** a code review's first round reports five findings and one doubt
- **THEN** `findings.json` holds six entries, each with its round `1`, its reporters and its destination

### Requirement: An invalid record publishes nothing

Publish mode SHALL validate the whole record before it writes anything. A record that does not parse, does not follow its schema, or names a location outside the repository SHALL publish nothing, and the report SHALL name the file and each field at fault.

#### Scenario: Missing destination

- **WHEN** an entry of `findings.json` has no destination
- **THEN** nothing is posted, the report names the entry and the field, and the mode exits with code 3

### Requirement: Only surviving findings are published

Publish mode SHALL open a new thread for a finding only when it survived the refutation, and for a doubt only when the record marks it for publication. A fixed `SUGGESTION`, a refuted finding and a dismissed finding SHALL NOT be published. This governs new threads: an entry linked to an existing thread is answered whatever its outcome (see "A linked entry that is not published is answered").

#### Scenario: Refuted finding

- **WHEN** the record holds a `WARNING` refuted for lack of a reproduction
- **THEN** no thread is published for it

#### Scenario: Fixed suggestion

- **WHEN** the record holds a fixed `SUGGESTION`
- **THEN** no thread is published for it

### Requirement: A thread's state follows the finding's outcome

A published thread SHALL be resolved when the finding is accounted for: a fixed `CRITICAL` or `WARNING`, with its commit, or a finding deferred to a follow-up task that was created, with the task's URL. It SHALL stay open when someone must act before the merge: a deferred finding whose follow-up is only proposed, a finding passed on, a blocked finding, or a doubt.

#### Scenario: Fixed warning

- **WHEN** the record holds a `WARNING` fixed in commit `abc1234`
- **THEN** its thread is published resolved, and its status line names `abc1234`

#### Scenario: Follow-up only proposed

- **WHEN** an `AFK` record holds a deferred finding whose follow-up task is proposed and not created
- **THEN** its thread is published open

#### Scenario: Created follow-up

- **WHEN** an `HITL` record holds a deferred finding whose follow-up task was created at `https://linear.app/monolab/issue/DOT-170`
- **THEN** its thread is published resolved, and its status line holds that URL

### Requirement: A thread several entries share stays open while one needs it

When several entries of the record are answered in one thread, each SHALL be answered in it, and the thread SHALL be resolved only when none of them needs it open.

#### Scenario: Two entries in one thread, one open

- **WHEN** the record links two findings to one thread, the first fixed and the second blocked
- **THEN** both are answered in the thread, and the thread stays open

#### Scenario: Two entries in one thread, both fixed

- **WHEN** the record links two fixed findings to one thread
- **THEN** both are answered in the thread, and the thread is resolved once

### Requirement: A finding passed on is addressed to its stage

A finding passed on to a later stage SHALL be published as an open thread carrying the visible tag `#<stage>` and a hidden marker `for=<stage>`, so that the stage it is addressed to finds it.

#### Scenario: Passed on to QA

- **WHEN** the record passes a finding on to QA
- **THEN** its thread is open, shows `#qa` and carries the marker `for=qa`

### Requirement: The comment format

Each published comment SHALL be in English, open with a Conventional Comments label (`issue`, `suggestion` or `question`, decorated `blocking` for a `CRITICAL` finding and for a doubt), and hold a one-to-three-line statement, a status line, a folded trace (reporters, severity, reproduction, tool versions) and hidden markers. Follow-up references SHALL be explicit URLs.

#### Scenario: Critical finding

- **WHEN** a `CRITICAL` finding reported by `code-review` and `codex` is published
- **THEN** its comment opens with `issue (blocking):`, and its folded trace names both reporters and the severity `CRITICAL`

#### Scenario: Doubt

- **WHEN** an `AFK` doubt is published
- **THEN** its comment opens with `question (blocking):` and its thread is open

### Requirement: Hidden markers

Each comment SHALL carry a hidden, versioned marker: `autonomous:finding v1` or `autonomous:doubt v1` on a thread's first comment, `autonomous:resolution v1` on a reply that changes its state, and `autonomous:review v1` on a review's body. Each marker SHALL name the attempt and, for a finding or a doubt, its id in the record.

#### Scenario: Marker of a finding

- **WHEN** finding `f3` of attempt `linear:DOT-121:code-review:1` is published
- **THEN** its first comment carries a hidden `autonomous:finding v1` marker naming that attempt and `f3`

### Requirement: Where a comment is anchored

A thread SHALL be anchored to the finding's line on the final diff when the diff holds it; else to its file, at file level, when the diff changes that file; else to the change's `proposal.md`, at file level; and only when none of these is possible, in the review's body.

#### Scenario: Line in the diff

- **WHEN** a finding names line 42 of a file the diff changes, and line 42 is in a hunk
- **THEN** its thread is anchored to that line

#### Scenario: Line outside every hunk

- **WHEN** a finding names a line of a changed file that no hunk holds
- **THEN** its thread is anchored to that file at file level

#### Scenario: Whole change

- **WHEN** a finding is located on the whole change
- **THEN** its thread is anchored at file level to the change's `proposal.md`

### Requirement: One review per round that opens threads

Publish mode SHALL post the new threads of one review round in one review, with the event `COMMENT`, whose body is a three-line index of what the round published. For a reply to an existing thread, or a change of its state, publish mode SHALL post no review of its own; the review GitHub itself attaches to a reply is not one. A round that opens no thread SHALL post no review.

#### Scenario: First round

- **WHEN** publish mode runs after a round that published four new threads
- **THEN** the pull request gains one review with event `COMMENT` holding the four threads

#### Scenario: Human round with replies only

- **WHEN** a human round only answers the human's two GitHub threads
- **THEN** publish mode posts no review of its own, and each thread gains a reply

### Requirement: Existing threads are answered, never duplicated

For a record entry linked to an existing thread, publish mode SHALL reply in that thread with the entry's state, resolve the thread when the finding is accounted for, and unresolve it when it is open again. It SHALL NOT open a new thread for that entry.

#### Scenario: Human comment fixed

- **WHEN** a finding of the reviewer `human` is linked to the human's GitHub thread and is fixed
- **THEN** the thread gains a reply naming the commit and is resolved

#### Scenario: Human suggestion fixed

- **WHEN** a `suggestion` of the reviewer `human` is linked to the human's GitHub thread and is fixed
- **THEN** the thread gains a reply naming the commit and is resolved, and no new thread is opened

#### Scenario: Earlier fix that did not hold

- **WHEN** a second attempt links a finding to a thread the first attempt resolved as fixed, and the finding is open again
- **THEN** the thread gains a reply and is unresolved

### Requirement: A linked entry that is not published is answered

For a linked entry that is not published, publish mode SHALL reply in the thread with its outcome (`not published`, and `refuted`, `dismissed`, `settled` or `asked` when it applies) and its reason, under a hidden `autonomous:resolution v1` marker. It SHALL NOT resolve or unresolve the thread, which a person closes, and SHALL report it among the threads answered. An unpublished entry linked to no thread SHALL post nothing.

#### Scenario: Linked entry refuted

- **WHEN** a second attempt links a refuted finding to the open `question (blocking)` thread of the first attempt
- **THEN** the thread gains one reply whose status line says `not published (refuted)` with the entry's reason, the thread stays open, and the report lists it among the threads answered

#### Scenario: Linked entry dismissed or settled

- **WHEN** a record links a dismissed finding to an open thread and a settled doubt to a resolved one
- **THEN** each thread gains one reply naming its outcome (`dismissed`, `settled`) and keeps its state

#### Scenario: Human's finding withdrawn

- **WHEN** a human round links to the human's GitHub thread a finding the human withdrew, and the record does not publish it
- **THEN** the thread gains one reply with the outcome and the reason, and is neither resolved nor unresolved

#### Scenario: Unpublished entry linked to no thread

- **WHEN** the record holds a refuted finding linked to no thread
- **THEN** nothing is posted for it

### Requirement: Publishing is idempotent within an attempt

Running publish mode again in the same attempt SHALL post nothing already posted: a finding whose marker for that attempt is on the pull request SHALL NOT be published again, and a state already replied SHALL NOT be replied again.

#### Scenario: Mode run twice

- **WHEN** publish mode runs twice in a row on the same record
- **THEN** the second run posts nothing and exits with code 0

#### Scenario: Linked entry answered once

- **WHEN** publish mode runs twice in the same attempt on a record that links a refuted finding to an existing thread
- **THEN** the second run posts no second reply, because the first reply's hidden marker names the attempt and the finding

#### Scenario: Run cut short

- **WHEN** publish mode stopped after posting the review and before resolving its fixed threads
- **THEN** the next run resolves them and posts no second review

### Requirement: An exact match continues an existing thread

A record entry linked to no thread whose anchor and title match, exactly, an open or resolved thread a code review published, SHALL be published as a reply in that thread, not as a new thread. The report SHALL name each such match. The title SHALL be compared ignoring case and whitespace.

#### Scenario: Same finding found again

- **WHEN** a second attempt's record holds, unlinked, a finding with the same file, side, line range and title as a thread of the first attempt
- **THEN** publish mode replies in that thread and reports the match

### Requirement: Only the stage's own threads are touched

Publish mode SHALL change only threads a code review published, threads addressed to code review, and the threads the record links to. It SHALL NOT reply in, resolve or unresolve any other thread.

#### Scenario: Bot thread

- **WHEN** the pull request holds an open CodeRabbit thread that no record entry links to
- **THEN** publish mode leaves it untouched

### Requirement: The publish receipt

After publishing, publish mode SHALL read the pull request's threads back and check that every post of the run is there in its state. Only then SHALL it write `published.json` in the attempt's directory, holding the attempt id, the pull request, the digest of the `findings.json` it published, and the time.

#### Scenario: Receipt written

- **WHEN** every post of the run is read back in its state
- **THEN** `published.json` names the pull request and the digest of the record

#### Scenario: Read-back fails

- **WHEN** a thread the run resolved is read back open
- **THEN** no receipt is written and the mode exits with code 3

### Requirement: Comments are posted with the user's account

Publish mode SHALL post with the `gh` account of the machine. The markers and the folded trace, not the author, SHALL tell a stage's comments from the human's.

#### Scenario: Human comment beside a stage's

- **WHEN** a thread holds a stage's comment and a reply by the human, both by the same account
- **THEN** only the stage's comment carries a hidden marker

### Requirement: Publishing leaves the pull request a draft

Publish mode SHALL NOT mark the pull request ready for review, and SHALL NOT approve or request changes on it.

#### Scenario: Draft kept

- **WHEN** publish mode runs on a draft pull request
- **THEN** the pull request is still a draft and its reviews hold only `COMMENT` events from the run
