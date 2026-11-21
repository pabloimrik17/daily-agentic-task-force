# Spec Delta

## MODIFIED Requirements

### Requirement: The implementation prompt follows the autonomy

The prompt SHALL be written for the task's autonomy. For `AFK` it SHALL tell the agent never to ask the human anything and to record each assumption in the change's design, the stage summary and the logbook entry. For `HITL` it SHALL let the agent ask, and SHALL tell it to show the human the implementation and its pull request for a quick look at anything that jars, saying that verification, code review and QA follow, and to fix only what the human clearly asks for, each round as a new commit, running the checks again after the last round that changed anything, before the transition.

#### Scenario: AFK task

- **WHEN** an implementation prompt is written for a task carrying `AFK`
- **THEN** it forbids questions to the human and has no review step

#### Scenario: HITL task

- **WHEN** an implementation prompt is written for a task carrying `HITL`
- **THEN** it has the review step, presents it as a quick look before verification, code review and QA, and says the approval question is asked only after the human has seen the implementation

## ADDED Requirements

### Requirement: The implementation leaves the review stages theirs

The prompt SHALL tell the agent that verifying the change against its proposal, reviewing the code's quality, running what the task delivers as its end user would, and archiving the change belong to later stages, and that it does none of them, even when the apply workflow suggests verifying or archiving once every task is done. The repository's checks and the review of each teammate's block SHALL stay the agent's.

#### Scenario: Apply workflow suggests verifying

- **WHEN** an implementation prompt is written
- **THEN** it tells the agent to run neither the verify workflow nor the archive workflow, whatever the apply workflow suggests at its end

#### Scenario: Checks kept

- **WHEN** an implementation prompt is written
- **THEN** it still tells the agent to run every check the repository defines before the transition
