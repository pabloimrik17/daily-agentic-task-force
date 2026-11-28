## MODIFIED Requirements

### Requirement: What the caller supplies

The skill SHALL take from its caller: the subject of the review, the references it is checked against, the procedure of the report, the scale of severities and its floor, the later reviews a finding can be passed on to, where the record of the findings is kept, and whether a human follows the review. A caller MAY also add human rounds and name the reporters whose findings the refutation only advises on. It SHALL hold no fact about a particular stage.

#### Scenario: Verification as caller

- **WHEN** the verification stage inlines the skill
- **THEN** its own prompt supplies the implementation as subject, the proposal and the definition as references, the verify workflow as the report's procedure, `CRITICAL` as the floor, code review and QA as later reviews, and the attempt's directory for the record

#### Scenario: Code review as caller

- **WHEN** the code review stage inlines the skill for an `HITL` task
- **THEN** its own prompt supplies the pull request's diff as subject, the definition and the proposal as references, the review team as the report's procedure, `CRITICAL` as the floor, QA as the only later review, `findings.json` for the record, and human rounds whose reporter, `human`, the refutation only advises on

### Requirement: The phases

The skill SHALL run these phases in order: the report, the finding triage, the refutation, the fix and the fix check. One round SHALL run them once: no second report follows the fixes. Only a caller that adds human rounds SHALL get more: each human round runs the same phases once, with the human's comments as its report.

#### Scenario: One round

- **WHEN** every fix of a round passes its fix check
- **THEN** the review ends without a second report

#### Scenario: Human round added

- **WHEN** the caller adds human rounds and the human comments after the first round
- **THEN** a human round runs the finding triage, the refutation, the fix and the fix check on the human's comments, and no reviewer reports again

### Requirement: The refutation

Teammates SHALL try to refute each finding sent to fix or to defer; findings passed on or dismissed SHALL NOT be refuted. A finding SHALL survive only with its reproduction: a test that fails because of it, when a test can show it, or else the exact text it contradicts or misses beside the place that does so. For a reporter the caller names as one the refutation only advises on, the orchestrator SHALL show that reporter the outcome and its counter-evidence, and the finding SHALL survive or not as they decide; a fix check then judges a fix with no reproduction against the finding's statement.

#### Scenario: Behaviour a test can show

- **WHEN** a finding says a scenario's behaviour is missing and a test can show it
- **THEN** it survives only with a test that fails because of it

#### Scenario: Refuted

- **WHEN** the refutation finds the requirement implemented under another name
- **THEN** the finding does not survive, and the record says why

#### Scenario: Advisory refutation

- **WHEN** the refutation finds no reproduction for a finding of a reporter the caller names as advised only, and that reporter keeps it
- **THEN** the finding survives, goes to its fix, and its fix check judges the fix against the finding's statement
