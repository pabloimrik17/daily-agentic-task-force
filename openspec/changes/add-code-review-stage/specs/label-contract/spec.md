## MODIFIED Requirements

### Requirement: Three label groups

Every task SHALL carry labels from three groups. The **scope** group is `work` and `personal`. The **autonomy** group is `AFK` and `HITL`. The **stage** group is `grill-me`, `proposal`, `implement`, `verify`, `code-review` and `external-review`. Each group SHALL hold exactly one label on a task: two labels of the same group are a conflict. A task without a label of a group is untagged for that group, except that a task whose stage is `grill-me` MAY lack autonomy. Missing groups and conflicts SHALL be detected and reported per group, and SHALL NOT be resolved by the system removing or replacing a label.

#### Scenario: Complete task

- **WHEN** a task carries `personal`, `AFK` and `proposal`
- **THEN** it is complete for all three groups

#### Scenario: Task ready to implement

- **WHEN** a task carries `personal`, `AFK` and `implement`
- **THEN** it is complete for all three groups

#### Scenario: Task ready to verify

- **WHEN** a task carries `personal`, `HITL` and `verify`
- **THEN** it is complete for all three groups

#### Scenario: Task ready for code review

- **WHEN** a task carries `personal`, `AFK` and `code-review`
- **THEN** it is complete for all three groups

#### Scenario: Task waiting for external review

- **WHEN** a task carries `personal`, `HITL` and `external-review`
- **THEN** it is complete for all three groups

#### Scenario: Grill without autonomy

- **WHEN** a task carries `personal` and `grill-me`
- **THEN** it is complete, and its autonomy is not reported as missing

#### Scenario: Grill with a decided autonomy

- **WHEN** a task carries `work`, `HITL` and `grill-me`
- **THEN** it is complete for all three groups

#### Scenario: Missing entry group

- **WHEN** a task carries `work` and none of the former entry labels `AFK`, `HITL` and `grill-me`
- **THEN** it is reported as untagged for the autonomy group and for the stage group

#### Scenario: Missing stage

- **WHEN** a task carries `work` and `AFK`
- **THEN** it is reported as untagged for the stage group only

#### Scenario: Missing autonomy outside a grill

- **WHEN** a task carries `personal` and `proposal`
- **THEN** it is reported as untagged for the autonomy group only

#### Scenario: Both scopes

- **WHEN** a task carries `work` and `personal`
- **THEN** it is reported as a scope conflict and neither label is removed

#### Scenario: AFK with HITL

- **WHEN** a task carries `AFK` and `HITL`
- **THEN** it is reported as an autonomy conflict for a human to resolve

#### Scenario: Two stages

- **WHEN** a task carries `grill-me` and `proposal`
- **THEN** it is reported as a stage conflict for a human to resolve

#### Scenario: proposal with implement

- **WHEN** a task carries `proposal` and `implement`
- **THEN** it is reported as a stage conflict for a human to resolve

#### Scenario: implement with verify

- **WHEN** a task carries `implement` and `verify`
- **THEN** it is reported as a stage conflict for a human to resolve

#### Scenario: verify with code-review

- **WHEN** a task carries `verify` and `code-review`
- **THEN** it is reported as a stage conflict for a human to resolve

#### Scenario: code-review with external-review

- **WHEN** a task carries `code-review` and `external-review`
- **THEN** it is reported as a stage conflict for a human to resolve

### Requirement: Meaning of each label

The contract SHALL fix one meaning per label: `work` is Nazaries work; `personal` is the user's own work; `AFK` means an agent may advance the task without a human; `HITL` means an agent may advance the task but a human intervenes during or at the end of each stage; `grill-me` means the task must be refined with a human in a grill before anyone works on it; `proposal` means the task is ready for proposal preparation, its autonomy decided and any grill it needed over; `implement` means the task has a proposal and is ready to implement; `verify` means the task is implemented and ready to verify against its proposal; `code-review` means the task is verified and ready for code review; `external-review` means the task's code is reviewed and it waits for its external review; `taken` means an agent or a person is advancing the task now. Scope and autonomy are properties, kept for the whole life of a task; the stage says where the task is and is replaced by each transition. While a task is in `grill-me`, its autonomy, when it has one, is provisional until the grill confirms it. No scope has priority over the other in the contract. What each label implies for selecting work, including the preference for the machine's scope, is defined by the capability that selects work, not by this contract.

#### Scenario: grill-me with AFK

- **WHEN** a task carries `AFK` and `grill-me`
- **THEN** the contract reads it as needing refinement before any agent works on it, with a provisional autonomy that the grill confirms

#### Scenario: proposal with HITL

- **WHEN** a task carries `HITL` and `proposal`
- **THEN** the contract reads it as ready for proposal preparation, with a human intervening in each stage

#### Scenario: implement with AFK

- **WHEN** a task carries `AFK` and `implement`
- **THEN** the contract reads it as having a proposal and being ready for an agent to implement without a human

#### Scenario: verify with HITL

- **WHEN** a task carries `HITL` and `verify`
- **THEN** the contract reads it as implemented and ready to verify against its proposal, with a human intervening in each stage

#### Scenario: code-review with AFK

- **WHEN** a task carries `AFK` and `code-review`
- **THEN** the contract reads it as verified against its proposal and ready for an agent to review its code without a human

#### Scenario: external-review with HITL

- **WHEN** a task carries `HITL` and `external-review`
- **THEN** the contract reads it as reviewed by the review stages and waiting for its external review, with a human intervening in each stage

#### Scenario: Meaning of work in a triage question

- **WHEN** triage offers `work` as an option
- **THEN** its description says it is Nazaries work and does not claim priority over personal work

### Requirement: One spelling and one colour per label

Each label SHALL have exactly one spelling, used verbatim on every tracker: `work`, `personal`, `AFK`, `HITL`, `grill-me`, `proposal`, `implement`, `verify`, `code-review`, `external-review`, `taken`. Matching SHALL be exact and case-sensitive; a label that differs only in case or spacing (for example `Grill Me`) is not the contract label. Each label SHALL have one colour, applied on trackers that support colour: `AFK` `#5e6ad2`, `HITL` `#eb5757`, `grill-me` `#f2994a`, `proposal` `#bb87fc`, `implement` `#26b5ce`, `verify` `#d6409f`, `code-review` `#a3e635`, `external-review` `#a16207`, `work` `#2f80ed`, `personal` `#27ae60`, `taken` `#95a2b3`. A tracker without label colours carries the name only.

#### Scenario: Near-miss spelling

- **WHEN** a Linear task carries `Grill Me` and the configuration declares no alias for it
- **THEN** the task is untagged for the stage group

#### Scenario: Tracker without colours

- **WHEN** the contract is applied to Beads
- **THEN** labels are matched by name and no colour is involved

#### Scenario: Near-miss taken

- **WHEN** a task carries `Taken`
- **THEN** it is not taken

#### Scenario: Near-miss proposal

- **WHEN** a task carries `Proposal`
- **THEN** the task is untagged for the stage group

#### Scenario: implement bootstrapped

- **WHEN** Linear lacks `implement` and the bootstrap runs
- **THEN** `implement` is created at workspace level with colour `#26b5ce` and reported as created

#### Scenario: verify bootstrapped

- **WHEN** Linear lacks `verify` and the bootstrap runs
- **THEN** `verify` is created at workspace level with colour `#d6409f` and reported as created

#### Scenario: code-review bootstrapped

- **WHEN** Linear lacks `code-review` and the bootstrap runs
- **THEN** `code-review` is created at workspace level with colour `#a3e635` and reported as created

#### Scenario: Near-miss code-review

- **WHEN** a task carries `Code Review` and the configuration declares no alias for it
- **THEN** the task is untagged for the stage group

#### Scenario: external-review bootstrapped

- **WHEN** Linear lacks `external-review` and the bootstrap runs
- **THEN** `external-review` is created at workspace level with colour `#a16207` and reported as created

#### Scenario: Near-miss external-review

- **WHEN** a task carries `External Review` and the configuration declares no alias for it
- **THEN** the task is untagged for the stage group

### Requirement: A transition replaces the stage

A transition SHALL move a task out of its stage. It adds the next stage and, when the stage decided it, the answered autonomy; then it removes the stage it leaves and, when an autonomy was answered, every other autonomy label; and it reads the task back. Labels SHALL be added before any is removed. It is the first exception to the rule that the loop never removes a label, and it removes nothing else. There SHALL be five transitions: from `grill-me` to `proposal`, on a human's answer that sets the autonomy; from `proposal` to `implement`; from `implement` to `verify`; from `verify` to `code-review`; and from `code-review` to `external-review`. The last four change no autonomy.

#### Scenario: Grill ends with AFK

- **WHEN** a transition is applied with the answer `AFK` to a task carrying `work` and `grill-me`
- **THEN** the task carries `work`, `AFK` and `proposal`

#### Scenario: Autonomy replaced

- **WHEN** a transition is applied with the answer `AFK` to a task carrying `work`, `HITL` and `grill-me`
- **THEN** the task carries `work`, `AFK` and `proposal`, and `HITL` was removed

#### Scenario: Autonomy conflict resolved

- **WHEN** a transition is applied with the answer `HITL` to a task carrying `personal`, `AFK`, `HITL` and `grill-me`
- **THEN** the task carries `personal`, `HITL` and `proposal`

#### Scenario: Write cut short

- **WHEN** adding `proposal` fails after `AFK` was added to a task carrying `work` and `grill-me`
- **THEN** nothing is removed and the task still carries `grill-me`

#### Scenario: Proposal ready

- **WHEN** the transition out of `proposal` is applied to a task carrying `personal`, `HITL` and `proposal`
- **THEN** the task carries `personal`, `HITL` and `implement`, and `proposal` was removed

#### Scenario: Implementation done

- **WHEN** the transition out of `implement` is applied to a task carrying `personal`, `HITL` and `implement`
- **THEN** the task carries `personal`, `HITL` and `verify`, and `implement` was removed

#### Scenario: Verification done

- **WHEN** the transition out of `verify` is applied to a task carrying `personal`, `HITL` and `verify`
- **THEN** the task carries `personal`, `HITL` and `code-review`, and `verify` was removed

#### Scenario: Code review done

- **WHEN** the transition out of `code-review` is applied to a task carrying `personal`, `HITL` and `code-review`
- **THEN** the task carries `personal`, `HITL` and `external-review`, and `code-review` was removed

## ADDED Requirements

### Requirement: The autonomy decides whether leaving code-review needs an answer

The transition from `code-review` to `external-review` SHALL be applied without a human's answer for a task carrying `AFK`, and only on a human's approval for a task carrying `HITL`. A task in `code-review` whose autonomy is missing or in conflict SHALL NOT be transitioned.

#### Scenario: AFK task

- **WHEN** the transition out of `code-review` is requested for a task carrying `work`, `AFK` and `code-review`, and its work is finished
- **THEN** it is applied with no question, and the task carries `work`, `AFK` and `external-review`

#### Scenario: HITL task not approved

- **WHEN** the human answers "Later" for a task carrying `HITL` and `code-review`
- **THEN** the task keeps `code-review` and nothing is written

#### Scenario: Autonomy missing

- **WHEN** the transition out of `code-review` is requested for a task carrying `personal` and `code-review` only
- **THEN** nothing is written and the reason names the missing autonomy
