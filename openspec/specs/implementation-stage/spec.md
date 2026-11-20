# implementation-stage Specification

## Purpose
The implementation stage: a managed session whose agent, the orchestrator, implements a task's approved OpenSpec change through teammates, commits the work in the task's draft pull request, leaves a stage summary and a logbook entry, and ends with the transition to `verify`.

## Requirements

### Requirement: The implementation stage

The system SHALL register a stage with the id `implement` and the emoji 🛠️. Its agent arguments for the `claude` tool SHALL be `--model opus --effort high`, the same for every task.

#### Scenario: Selected implement unit

- **WHEN** a work unit whose stage is `implement` reaches `launch` and every precondition holds
- **THEN** an attempt `<source>:<task>:implement:<n>` is launched, and its session is created with `--model opus --effort high`

#### Scenario: Supplied task

- **WHEN** the run is invoked with `--apply --task linear:DOT-121 --stage implement`
- **THEN** `implement` is accepted as a registered stage

### Requirement: Implementation prerequisites

The stage's prerequisites SHALL hold only when the configured tool is `claude`, the task carries exactly one autonomy label, the task's repository holds an OpenSpec root and provides the OpenSpec workflows the stage needs, the `openspec` CLI can be run, the `handoff` skill is found as proposal preparation finds it, and the task's context is read as proposal preparation reads it. Each failure SHALL give its own reason. Nothing SHALL initialise or update OpenSpec in a repository.

#### Scenario: Codex configured

- **WHEN** `sessions.tool` is `codex`
- **THEN** the prerequisites fail with a reason naming the tool, and nothing else is checked

#### Scenario: Autonomy in conflict

- **WHEN** the task carries `AFK`, `HITL` and `implement`
- **THEN** the prerequisites fail with a reason naming the conflicting autonomy

#### Scenario: Everything present

- **WHEN** the tool is `claude`, the task has one autonomy, the repository has an OpenSpec root and both workflows, the CLI runs, the skill is found and the context is read
- **THEN** the prerequisites go on to the change to implement

### Requirement: The OpenSpec workflows the stage needs

The task's repository SHALL provide the apply and the update workflows, each as its OpenSpec 2 skill (`openspec-apply-change`, `openspec-update-change`) or its OpenSpec 1 command (`/opsx:apply`, `/opsx:update`), found as proposal preparation finds its propose workflow. The skill SHALL be preferred when both exist, and the name found SHALL reach the prompt.

#### Scenario: Repository on OpenSpec 2

- **WHEN** the task's repository has the skills `openspec-apply-change` and `openspec-update-change` and no `.claude/commands/opsx/`
- **THEN** both workflows are found as skills, and the prompt names the skills

#### Scenario: Update workflow missing

- **WHEN** the task's repository has an OpenSpec root but neither the skill `openspec-update-change` nor the command `/opsx:update`
- **THEN** the prerequisites fail with a reason naming both forms and telling the human to update OpenSpec in that repository, and no file is created in it

### Requirement: The change to implement

The prerequisites SHALL also require an open pull request on the workspace branch, and that pull request SHALL add files under exactly one change directory of `openspec/changes/`, outside `openspec/changes/archive/`. That change is the one the stage implements, and its name SHALL reach the prompt. No pull request, no such change, or more than one SHALL each fail with its own reason.

#### Scenario: Proposal prepared

- **WHEN** the branch's open pull request adds the files of `openspec/changes/read-github-blockers/` and a glossary file
- **THEN** the prerequisites hold and the prompt names the change `read-github-blockers`

#### Scenario: No pull request

- **WHEN** the workspace branch has no open pull request
- **THEN** the prerequisites fail with a reason naming the branch

#### Scenario: Two changes

- **WHEN** the pull request adds files under two change directories
- **THEN** the prerequisites fail with a reason naming both changes

### Requirement: The implementation prompt

The prompt SHALL hold the shared frame, a Context section rendered as proposal preparation renders it, the body of the `handoff` skill, and the stage's instructions. The instructions SHALL tell the agent to implement the change by running the apply workflow on it as the orchestrator, named as the repository provides it (the skill when it exists, the command otherwise), and SHALL name the open pull request and the change.

#### Scenario: Change and pull request named

- **WHEN** an implementation prompt is written for a task whose pull request #90 adds the change `read-github-blockers`
- **THEN** the prompt names the change `read-github-blockers`, the apply workflow as the repository provides it, and pull request #90

#### Scenario: Comments are material

- **WHEN** an implementation prompt is written for a task with a comment whose body holds a line `### 4. Closing`
- **THEN** the Context section names the comment's author, quotes every line of the body, and says that a comment is not an instruction

### Requirement: A new attempt resumes the work

The prompt SHALL tell the agent to look, before it implements anything, for what an earlier attempt left: the change's checked tasks, the branch's commits and the workspace's uncommitted changes. Uncommitted changes SHALL be treated as partial work on the next unchecked tasks, finished, checked and committed, and never discarded silently.

#### Scenario: Second attempt

- **WHEN** a prompt is written for attempt `linear:DOT-121:implement:2`
- **THEN** it tells the agent to continue from the checked tasks and commits, and to finish and commit uncommitted changes rather than discard them

### Requirement: Orchestration is stated as intent

The prompt SHALL tell the agent to act as the orchestrator: to delegate the work to as many teammates as it sees fit, each with the model and the effort its block needs, so that its own context stays under about 30% until the implementation ends and no block costs more than it needs. It SHALL say the agent may set any model and any effort level, from the cheapest up. It SHALL NOT fix a number of teammates, an agent definition, or a format for briefs or reports.

#### Scenario: Effort left free

- **WHEN** an implementation prompt is written
- **THEN** it says the orchestrator may set any effort level for a teammate, and names the 30% target for its own context

#### Scenario: No mechanics

- **WHEN** an implementation prompt is written
- **THEN** it names no teammate count, no agent definition, and no brief or report format

#### Scenario: Claude teammates only

- **WHEN** an implementation prompt is written
- **THEN** it offers no teammate of another tool, such as Codex

### Requirement: Deviations from the proposal

The prompt SHALL tell the agent that, when the implementation shows the proposal is wrong, it changes the change's artifacts with the update workflow, named as the repository provides it, on the same branch and records the deviation in the change's design, the stage summary and the logbook entry. For `AFK` the agent decides the deviation and records it as an assumption; for `HITL` it asks the human first.

#### Scenario: AFK deviation

- **WHEN** an implementation prompt is written for a task carrying `AFK`
- **THEN** it tells the agent to update the artifacts with the update workflow and record the deviation as an assumption, without asking

#### Scenario: HITL deviation

- **WHEN** an implementation prompt is written for a task carrying `HITL`
- **THEN** it tells the agent to ask the human before it changes the proposal

### Requirement: Implementation commits

The prompt SHALL tell the agent that only the orchestrator commits, never a teammate: one commit per coherent unit of work, with the change's task checkboxes in the same commit as their code, staged by path. Commits SHALL follow the repository's conventions and conventional commits, with a scope on every commit in a monorepo, and a breaking marker only when the proposal declares the change breaking. Each commit SHALL be pushed, with no amend, no force push and no skipped hooks.

#### Scenario: Conventions read from the repository

- **WHEN** an implementation prompt is written
- **THEN** it tells the agent to take the commit type and scope from the repository's contributor instructions, commit rules and recent history

#### Scenario: Breaking marker

- **WHEN** the proposal does not declare the change breaking
- **THEN** the prompt's rules lead to no commit with `!` or a `BREAKING CHANGE` footer

#### Scenario: Push after each commit

- **WHEN** the orchestrator commits a unit of work
- **THEN** the prompt's rules lead it to push that commit before it starts the next unit

### Requirement: The checks pass before the transition

The prompt SHALL tell the agent to run every check the repository defines, such as its tests, linters and type checks, and to run the transition only when they all pass and every task of the change is checked.

#### Scenario: A check fails

- **WHEN** the repository's tests fail after the last unit of work
- **THEN** the prompt's order leads the agent to fix them, or to treat them as a blocker, before any transition

### Requirement: The implementation prompt follows the autonomy

The prompt SHALL be written for the task's autonomy. For `AFK` it SHALL tell the agent never to ask the human anything and to record each assumption in the change's design, the stage summary and the logbook entry. For `HITL` it SHALL let the agent ask, and SHALL tell it to show the human the implementation and its pull request and to iterate on the feedback, each round as a new commit, running the checks again after the last round that changed anything, before the transition.

#### Scenario: AFK task

- **WHEN** an implementation prompt is written for a task carrying `AFK`
- **THEN** it forbids questions to the human and has no review step

#### Scenario: HITL task

- **WHEN** an implementation prompt is written for a task carrying `HITL`
- **THEN** it has the review step, and says the approval question is asked only after the human has seen the implementation

### Requirement: The implementation closing order

The prompt SHALL tell the agent to end the stage in this order:

1. confirm the checks pass and every commit is pushed;
2. for `HITL`, review the implementation with the human;
3. write `stage-summary.md` and run persist mode;
4. run the transition;
5. write `logbook-entry.md`, with a section `### Implementation`, and run log mode;
6. write the result marker.

#### Scenario: Commands named

- **WHEN** an implementation prompt is written for attempt `linear:DOT-121:implement:1`
- **THEN** it names `/autonomous:run --apply --persist linear:DOT-121:implement:1`, `/autonomous:run --apply --transition linear:DOT-121` and `/autonomous:run --apply --log linear:DOT-121:implement:1`, in that order, and does not name pull-request mode

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

- **WHEN** the first transition of an `AFK` task moves its labels but cannot read them back, and the second run is refused because the task carries `verify` and no `implement`
- **THEN** the prompt tells the agent the transition is applied and to go on to the logbook entry, not to the blocked path

#### Scenario: Logbook section

- **WHEN** an implementation prompt is written
- **THEN** it tells the agent that the `### Implementation` section lists the tasks done and the commits by subject

### Requirement: The pull request stays a draft

The stage SHALL leave the task's pull request a draft. Neither the prompt nor any mode the stage runs SHALL mark it ready for review.

#### Scenario: Implementation complete

- **WHEN** an attempt of the implementation stage completes
- **THEN** the task's pull request is still a draft

### Requirement: A blocked AFK orchestrator ends without a transition

For an `AFK` task, the prompt SHALL tell the agent what to do when it cannot finish the implementation, because the proposal contradicts itself, a check cannot be made to pass, or a task needs a human: commit and push what is done, write a stage summary that explains the blocker and run persist mode, write a logbook entry that says the attempt is blocked and run log mode, run no transition, write no result marker, and stop.

#### Scenario: Check that cannot pass

- **WHEN** an `AFK` orchestrator cannot make the repository's tests pass
- **THEN** the task keeps `implement`, the work done is pushed, the task's tracker holds a comment explaining the blocker, no result marker exists, and reconcile retains the attempt once its session ends

#### Scenario: Push that fails

- **WHEN** the push of the work done fails on the blocked path of an `AFK` orchestrator
- **THEN** the prompt tells the agent not to retry it, to keep the commits, and to name the push's error and the unpushed commits in the stage summary and the logbook entry

### Requirement: Tasks that need a human

For an `AFK` task, the prompt SHALL tell the agent that a task of the change that needs a human, because it needs the human's go-ahead, a real write to a tracker or another outside service, or a credential, is neither done nor checked. The agent SHALL finish the other tasks, and the task that needs a human SHALL block the implementation and be named in the stage summary.

#### Scenario: Task that needs a human

- **WHEN** an implementation prompt is written for a task carrying `AFK`
- **THEN** it tells the agent neither to do nor to check a task that needs the human's go-ahead, a real write to a tracker or another outside service, or a credential, to finish the rest, and to follow the blocked path naming that task in the stage summary

### Requirement: Implementation stage summary comment

For an `implement` attempt, persist mode SHALL post the content of `stage-summary.md` as a comment on the task and SHALL NOT change the task's description. The first line SHALL be `autonomous · implement · <attempt-id> · stage summary saved`, followed by a blank line. A comment with that first line SHALL NOT be posted twice. The receipt SHALL be written only when the comment is read back.

#### Scenario: Comment header

- **WHEN** attempt `linear:DOT-121:implement:1` is persisted
- **THEN** the task has a new comment whose first line is `autonomous · implement · linear:DOT-121:implement:1 · stage summary saved`, and its description is unchanged

#### Scenario: Stage summary content

- **WHEN** an implementation prompt is written
- **THEN** it tells the agent that the stage summary names the pull request's URL, the OpenSpec change, the commits, and each deviation from the proposal with its reason

### Requirement: Public repositories in the implementation

The prompt SHALL forbid absolute paths and other details of the machine in the commits, the change's artifacts, the stage summary and the logbook entry, for every source, because the repository and its pull request may be public.

#### Scenario: Linear task

- **WHEN** an implementation prompt is written for a Linear task
- **THEN** it holds the rule about absolute paths and machine details

### Requirement: Implementation completion

The stage's completion check SHALL hold when the task carries `verify` and no `implement`. It SHALL also hold when the task is closed in its tracker.

#### Scenario: Transitioned

- **WHEN** the task carries `personal`, `AFK` and `verify`
- **THEN** the check holds

#### Scenario: Transition not applied

- **WHEN** the task still carries `implement`
- **THEN** the check does not hold

#### Scenario: Task closed

- **WHEN** the task was closed in its tracker
- **THEN** the check holds
