# Spec Delta

## MODIFIED Requirements

### Requirement: The autonomy decision depends on the stage

For a task with no autonomy and no stage label, the autonomy decision SHALL choose among `AFK`, `HITL` and `grill-me`, where `grill-me` leaves the autonomy to a grill. For a task whose stage is `proposal` or `implement`, it SHALL choose between `AFK` and `HITL` only. A task in `grill-me` without an autonomy label SHALL need no autonomy decision.

#### Scenario: Task with neither

- **WHEN** a task carries `personal` only
- **THEN** its autonomy decision may be `AFK`, `HITL` or `grill-me`

#### Scenario: Task in grill-me

- **WHEN** a task carries `personal` and `grill-me`
- **THEN** no autonomy decision is requested for it

#### Scenario: Task in implement

- **WHEN** a task carries `personal` and `implement`
- **THEN** its autonomy decision may be `AFK` or `HITL`, and never `grill-me`
