## MODIFIED Requirements

### Requirement: Existing threads are answered, never duplicated

For a record entry linked to an existing thread, publish mode SHALL reply in that thread with the entry's state, resolve the thread when the finding is accounted for, and unresolve it when it is open again. It SHALL NOT open a new thread for that entry. An attempt of external review resolves and unresolves only as its own requirements say.

#### Scenario: Human comment fixed

- **WHEN** a finding of the reviewer `human` is linked to the human's GitHub thread and is fixed
- **THEN** the thread gains a reply naming the commit and is resolved

#### Scenario: Human suggestion fixed

- **WHEN** a `suggestion` of the reviewer `human` is linked to the human's GitHub thread and is fixed
- **THEN** the thread gains a reply naming the commit and is resolved, and no new thread is opened

#### Scenario: Earlier fix that did not hold

- **WHEN** a second attempt links a finding to a thread the first attempt resolved as fixed, and the finding is open again
- **THEN** the thread gains a reply and is unresolved

#### Scenario: Linked entry of an external review

- **WHEN** an external review attempt links a fixed finding to a review bot's thread
- **THEN** the thread gains a reply naming the commit, and is not resolved

### Requirement: Only the stage's own threads are touched

Publish mode SHALL change only threads a stage of the runner published, threads addressed to the attempt's stage, and the threads the record links to. In a quiet round of external review it SHALL also resolve the threads an external review attempt answered, as the quiet round defines. It SHALL NOT reply in, resolve or unresolve any other thread.
#### Scenario: Bot thread

- **WHEN** the pull request holds an open CodeRabbit thread that no record entry links to
- **THEN** publish mode leaves it untouched

#### Scenario: Bot thread linked by an external review

- **WHEN** an external review's record links an entry to an open CodeRabbit thread
- **THEN** publish mode replies in that thread

## ADDED Requirements

### Requirement: An external review holds the threads it answers open

For an attempt of external review, publish mode SHALL answer each linked entry in its thread with the entry's state and reason, under a hidden `autonomous:resolution v1` marker, and SHALL NOT resolve or unresolve the thread, unless the thread is a finding thread a stage of the runner published, which follows the rules of any linked entry. The status line SHALL name a fixed finding's commit, or the reason otherwise, with the earlier decision's URL when there is one.

#### Scenario: Refuted bot finding

- **WHEN** the record links a refuted finding to a Greptile thread
- **THEN** the thread gains one reply whose status line says `not published (refuted)` with the reason, and stays open

#### Scenario: Already decided by the code review

- **WHEN** the record links a finding dismissed as decided in the code review's thread `https://github.com/o/r/pull/9#discussion_r1`
- **THEN** the reply says `not published (dismissed)`, gives the reason and holds that URL

#### Scenario: Finding thread addressed to external review

- **WHEN** the record links a fixed finding to an open finding thread carrying `for=external-review`
- **THEN** the thread gains a reply naming the commit and is resolved

### Requirement: A reply may mention its review bot

When an entry's reporter is a review bot whose settings give a mention, publish mode SHALL start the reply in that bot's thread with the mention. Without one, the reply SHALL hold no mention of the bot.

#### Scenario: No mention configured

- **WHEN** a reply is posted in a Greptile thread and Greptile's `mention` is `null`
- **THEN** the reply's body holds no `@` mention of Greptile

#### Scenario: Mention configured

- **WHEN** CodeRabbit's `mention` is `@coderabbitai`
- **THEN** the reply in a CodeRabbit thread starts with `@coderabbitai`

### Requirement: The record may mark a quiet round

The record MAY hold a top-level `quiet: true`. Publish mode SHALL accept it only for an attempt of external review whose record holds no entry sent to fix, and SHALL refuse any other record that holds it, publishing nothing. A record without the field SHALL be read as before.

#### Scenario: Quiet mark on a code review record

- **WHEN** a `code-review` attempt's `findings.json` holds `quiet: true`
- **THEN** nothing is posted, the report names the field, and the mode exits with code 3

### Requirement: The quiet round resolves the answered threads

In a quiet round, after the record's entries, publish mode SHALL resolve every unresolved thread whose last comment is an external review reply that accounts for its finding: fixed, refuted, dismissed, settled, or deferred to a created follow-up task. It SHALL leave open a thread with a later comment, a thread whose last reply says blocked, asked or deferred to a proposed task, and a human reviewer's thread whose finding was not fixed.

#### Scenario: Greptile thread answered as fixed

- **WHEN** a quiet round runs and a Greptile thread's last comment is an external review reply naming the fixing commit
- **THEN** the thread is resolved

#### Scenario: Bot answered after the reply

- **WHEN** a CodeRabbit thread holds a comment of CodeRabbit after the external review reply
- **THEN** the thread is left open

#### Scenario: Human reviewer's thread refuted

- **WHEN** a human reviewer's thread's last comment is an external review reply saying `not published (refuted)`
- **THEN** the thread is left open

### Requirement: The quiet round dismisses a review bot's request for changes

In a quiet round, publish mode SHALL dismiss each review of a configured review bot in the state `CHANGES_REQUESTED` when none of that bot's threads is unresolved, with a message that starts with `Addressed:` and counts the threads fixed and the threads answered. It SHALL NOT dismiss a review of anyone else, and SHALL NOT approve the pull request.

#### Scenario: Every CodeRabbit thread resolved

- **WHEN** a quiet round has resolved the last open CodeRabbit thread and CodeRabbit's review is `CHANGES_REQUESTED`
- **THEN** that review is dismissed with a message starting `Addressed:`

#### Scenario: One CodeRabbit thread left open

- **WHEN** a CodeRabbit thread stays open because its answer is contested
- **THEN** CodeRabbit's review is not dismissed

#### Scenario: Human request for changes

- **WHEN** a human reviewer's review is `CHANGES_REQUESTED`
- **THEN** it is not dismissed

### Requirement: The receipt records a quiet round

The publish receipt of a quiet round SHALL record that it is one, and SHALL be written only after the resolutions and dismissals of the round are read back in their state.

#### Scenario: Resolution not read back

- **WHEN** a thread the quiet round resolved is read back open
- **THEN** no receipt is written and the mode exits with code 3
