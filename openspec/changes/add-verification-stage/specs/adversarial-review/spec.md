## Purpose

The adversarial review: the way a review stage, or any other review, handles what it finds. A reviewer reports findings, the orchestrator triages them, other teammates try to refute them, others fix those that survive, and others judge each fix. It ships as a skill of the autonomous plugin so that every review can run the same way.

## ADDED Requirements

### Requirement: The adversarial review skill

The autonomous plugin SHALL ship a skill named `adversarial-review` whose body describes the adversarial review for any subject. Its description SHALL make it apply only when an adversarial review is asked for by name or named by a stage or another skill, never to a request to review something in general.

#### Scenario: Asked by name

- **WHEN** a person asks a session for an adversarial review of a change
- **THEN** the skill `autonomous:adversarial-review` applies

#### Scenario: General review request

- **WHEN** a person asks a session to review a pull request, without naming an adversarial review
- **THEN** the skill's description does not claim the request

### Requirement: What the caller supplies

The skill SHALL take from its caller: the subject of the review, the references it is checked against, the procedure of the report, the scale of severities and its floor, the later reviews a finding can be passed on to, where the record of the findings is kept, and whether a human follows the review. It SHALL hold no fact about a particular stage.

#### Scenario: Verification as caller

- **WHEN** the verification stage inlines the skill
- **THEN** its own prompt supplies the implementation as subject, the proposal and the definition as references, the verify workflow as the report's procedure, `CRITICAL` as the floor, code review and QA as later reviews, and the attempt's directory for the record

### Requirement: The phases

The skill SHALL run these phases in order: the report, the finding triage, the refutation, the fix and the fix check. One round SHALL run them once: no second report follows the fixes.

#### Scenario: One round

- **WHEN** every fix of a round passes its fix check
- **THEN** the review ends without a second report

### Requirement: Nobody judges their own work

The orchestrator SHALL start each phase's teammates fresh: the reporter only reads, a finding is refuted by teammates other than its reporter, and a fix is judged by teammates other than its fixer. The orchestrator SHALL choose how many teammates each phase takes and their model and effort, and SHALL be the only one that commits.

#### Scenario: Fixer and checker

- **WHEN** a teammate fixes a finding
- **THEN** a different teammate runs its fix check

#### Scenario: Effort left free

- **WHEN** the skill is read
- **THEN** it says the orchestrator chooses the model and effort of every teammate, the reporter's from the complexity of the subject, and fixes no number of teammates

### Requirement: The report

The reporter SHALL follow the caller's procedure and SHALL report each finding with its severity, on the caller's scale, and its evidence. It SHALL change no file of the subject.

#### Scenario: Finding reported

- **WHEN** the reporter finds a requirement with no implementation
- **THEN** its report holds a finding with a severity and the evidence, a file and line or an artifact section

### Requirement: The finding triage

The orchestrator SHALL make the reported findings its own: it MAY merge duplicates and split a finding that mixes concerns, keeping each one's link to the reported findings, and SHALL send each to fix now, pass on to a later review, defer to a follow-up, or dismiss, with a reason. It SHALL NOT change a finding's severity.

#### Scenario: Duplicates merged

- **WHEN** two reported findings share one root cause
- **THEN** the orchestrator may merge them into one, which names both reported findings

#### Scenario: Plainly false finding

- **WHEN** a finding below the floor is plainly contradicted by the subject
- **THEN** the orchestrator may dismiss it, with its reason, without a refutation

#### Scenario: Severity kept

- **WHEN** the orchestrator judges a `CRITICAL` finding to be minor
- **THEN** the finding keeps `CRITICAL`

### Requirement: The severity floor

A finding at or above the caller's severity floor SHALL be sent only to fix, and SHALL leave the review unfixed only when the refutation shows it does not hold.

#### Scenario: Critical finding

- **WHEN** the report holds a `CRITICAL` finding and the floor is `CRITICAL`
- **THEN** the finding triage sends it to fix

### Requirement: A human changes the finding triage

When a human follows the review, the orchestrator SHALL show them the finding triage, each finding with its destination and reason, before the refutation, and SHALL apply their changes. When none does, it SHALL record each decision and its reason as an assumption.

#### Scenario: Human present

- **WHEN** the caller says a human follows the review
- **THEN** the human sees the finding triage before any refutation starts

### Requirement: The refutation

Teammates SHALL try to refute each finding sent to fix or to defer; findings passed on or dismissed SHALL NOT be refuted. A finding SHALL survive only with its reproduction: a test that fails because of it, when a test can show it, or else the exact text it contradicts or misses beside the place that does so.

#### Scenario: Behaviour a test can show

- **WHEN** a finding says a scenario's behaviour is missing and a test can show it
- **THEN** it survives only with a test that fails because of it

#### Scenario: Refuted

- **WHEN** the refutation finds the requirement implemented under another name
- **THEN** the finding does not survive, and the record says why

### Requirement: The fix

A teammate SHALL fix each surviving finding sent to fix, and SHALL NOT change its reproduction test. The test SHALL stay with the fix as a regression test.

#### Scenario: Reproduction test kept

- **WHEN** a finding's reproduction is a failing test
- **THEN** the fix leaves that test unchanged and it is committed with the fix

### Requirement: The fix check

Teammates SHALL judge each fix: its reproduction no longer holds, a reproduction test fails without the fix and passes with it, and the fix does no more than its finding asks. A fix SHALL get at most two fix checks: a fix rejected by its first SHALL go back to the fix with the reasons; a fix rejected by its second SHALL block the review when no human follows it, and go to the human otherwise.

#### Scenario: Accepted fix

- **WHEN** the reproduction test fails without the fix and passes with it, and the fix touches only what the finding needs
- **THEN** the fix is accepted and the orchestrator commits it

#### Scenario: Rejected twice

- **WHEN** a fix is rejected by its second fix check and no human follows the review
- **THEN** the review is blocked and names the finding and the rejections

### Requirement: Deferred findings become follow-ups

A deferred finding that survives the refutation SHALL become a proposed follow-up, with a title, its reason and the finding it comes from. Whether a follow-up is created, and where, SHALL be the caller's to decide.

#### Scenario: Deferred finding survives

- **WHEN** a deferred finding survives the refutation
- **THEN** the record proposes a follow-up for it

### Requirement: The record of the findings

The orchestrator SHALL keep a record, where the caller says, of every reported finding: its severity, its destination and reason, the refutation's outcome and reproduction, and the fix's commit and fix check verdicts. What the caller writes for a person or the next agent SHALL be built from it.

#### Scenario: Record complete

- **WHEN** a round ends
- **THEN** every reported finding appears in the record with its destination, and every fixed one with its commit
