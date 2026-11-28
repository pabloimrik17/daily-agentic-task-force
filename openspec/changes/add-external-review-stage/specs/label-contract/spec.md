## MODIFIED Requirements

### Requirement: A transition replaces the stage

A transition SHALL move a task out of its stage. It adds the next stage and, when the stage decided it, the answered autonomy; then it removes the stage it leaves and, when an autonomy was answered, every other autonomy label; and it reads the task back. Labels SHALL be added before any is removed. It is the first exception to the rule that the loop never removes a label, and it removes nothing else. There SHALL be six transitions: from `grill-me` to `proposal`, on a human's answer that sets the autonomy; from `proposal` to `implement`; from `implement` to `verify`; from `verify` to `code-review`; from `code-review` to `external-review`; and from `external-review` to `wrap-up`. The last five change no autonomy.

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

#### Scenario: External review done

- **WHEN** the transition out of `external-review` is applied to a task carrying `personal`, `HITL` and `external-review`
- **THEN** the task carries `personal`, `HITL` and `wrap-up`, and `external-review` was removed

## ADDED Requirements

### Requirement: The autonomy decides whether leaving external-review needs an answer

The transition from `external-review` to `wrap-up` SHALL be applied without a human's answer for a task carrying `AFK`, and only on a human's approval for a task carrying `HITL`. A task in `external-review` whose autonomy is missing or in conflict SHALL NOT be transitioned.

#### Scenario: AFK task

- **WHEN** the transition out of `external-review` is requested for a task carrying `work`, `AFK` and `external-review`, its work is finished and its findings are published
- **THEN** it is applied with no question, and the task carries `work`, `AFK` and `wrap-up`

#### Scenario: HITL task not approved

- **WHEN** the human answers "Later" for a task carrying `HITL` and `external-review`
- **THEN** the task keeps `external-review` and nothing is written

#### Scenario: Autonomy missing

- **WHEN** the transition out of `external-review` is requested for a task carrying `personal` and `external-review` only
- **THEN** nothing is written and the reason names the missing autonomy
