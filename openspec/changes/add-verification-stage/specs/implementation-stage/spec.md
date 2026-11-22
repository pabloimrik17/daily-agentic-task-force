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

### Requirement: The implementation closing order

The prompt SHALL tell the agent to end the stage in this order:

1. confirm the checks pass and every commit is pushed;
2. for `HITL`, review the implementation with the human;
3. write `stage-summary.md` and run persist mode;
4. run the transition, naming `implement` as the stage it leaves;
5. write `logbook-entry.md`, with a section `### Implementation`, and run log mode;
6. write the result marker.

#### Scenario: Commands named

- **WHEN** an implementation prompt is written for attempt `linear:DOT-121:implement:1`
- **THEN** it names `/autonomous:run --apply --persist linear:DOT-121:implement:1`, `/autonomous:run --apply --transition linear:DOT-121 --from implement` and `/autonomous:run --apply --log linear:DOT-121:implement:1`, in that order, and does not name pull-request mode

#### Scenario: Answer left for later

- **WHEN** the human answers "Later" to the approval question
- **THEN** the prompt's order leaves the entry unpublished, the result marker unwritten and the session open

#### Scenario: Transition refused, HITL

- **WHEN** the transition of an `HITL` task is refused because a task of the change is unchecked
- **THEN** the prompt's order leaves the entry unpublished, the result marker unwritten and the session open

#### Scenario: Transition refused once, AFK

- **WHEN** the transition of an `AFK` task is refused because a task of the change is unchecked, an uncommitted change is left or a commit is unpushed
- **THEN** the prompt tells the agent to fix what the refusal names, checking a task only when it is done, and to run the transition once more

#### Scenario: Transition refused again, AFK

- **WHEN** the transition of an `AFK` task is refused a second time, or the refusal names something the agent cannot fix, such as a task that needs a human
- **THEN** the prompt tells the agent not to post the stage summary again, to publish a logbook entry that says the attempt is blocked and why, quoting the transition's reason, to write no result marker and to stop, so the task keeps `implement` and reconcile retains the attempt once the session ends

#### Scenario: Transition applied but not read back, AFK

- **WHEN** the first transition of an `AFK` task moves its labels but cannot read them back, and the second run is refused because the task is no longer in `implement`, carrying `verify` and no `implement`
- **THEN** the prompt tells the agent the transition is applied and to go on to the logbook entry, not to the blocked path

#### Scenario: Logbook section

- **WHEN** an implementation prompt is written
- **THEN** it tells the agent that the `### Implementation` section lists the tasks done and the commits by subject

## ADDED Requirements

### Requirement: The implementation leaves the review stages theirs

The prompt SHALL tell the agent that verifying the change against its proposal, reviewing the code's quality, running what the task delivers as its end user would, and archiving the change belong to later stages, and that it does none of them, even when the apply workflow suggests verifying or archiving once every task is done. The repository's checks and the review of each teammate's block SHALL stay the agent's.

#### Scenario: Apply workflow suggests verifying

- **WHEN** an implementation prompt is written
- **THEN** it tells the agent to run neither the verify workflow nor the archive workflow, whatever the apply workflow suggests at its end

#### Scenario: Checks kept

- **WHEN** an implementation prompt is written
- **THEN** it still tells the agent to run every check the repository defines before the transition
