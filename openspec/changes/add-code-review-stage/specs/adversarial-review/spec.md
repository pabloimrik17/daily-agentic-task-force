## MODIFIED Requirements

### Requirement: The phases

The skill SHALL run these phases in order: the report, the finding triage, the refutation, the fix and the fix check. One round SHALL run them once: no second report follows the fixes. The one exception SHALL be the human's round: when a human follows the review and the caller allows it, the human's comments on the outcome MAY start one more round, whose report is those comments.

#### Scenario: One round

- **WHEN** every fix of a round passes its fix check
- **THEN** the review ends without a second report

#### Scenario: Human comments on the outcome

- **WHEN** a caller that allows the human's round shows the outcome to the human and the human leaves two comments
- **THEN** one more round runs, whose report holds those two comments as findings of the reviewer `human`

## ADDED Requirements

### Requirement: The human's findings

In the human's round, the refutation SHALL be advisory: teammates look for evidence against each of the human's findings, the orchestrator shows the human what they found, and the human decides whether each finding stands. A finding the human keeps SHALL survive without a reproduction. A comment the human marks blocking SHALL carry the floor severity; any other, the severity just below it.

#### Scenario: Counter-evidence found

- **WHEN** a teammate finds that the behaviour the human asks for already exists elsewhere
- **THEN** the orchestrator shows the human that evidence, and the finding is dropped only if the human drops it

#### Scenario: Blocking comment

- **WHEN** the human marks a comment blocking and the caller's floor is `CRITICAL`
- **THEN** the finding's severity is `CRITICAL` and it is sent only to fix
