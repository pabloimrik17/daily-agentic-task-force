## Purpose

The verification stage: a managed session whose agent, the orchestrator, checks a task's implementation against its proposal and its definition, corrects what does not match through an adversarial review, leaves a stage summary and a logbook entry, and ends with the transition to `code-review`.

## ADDED Requirements

### Requirement: The verification stage

The system SHALL register a stage with the id `verify` and the emoji 🔍. Its agent arguments for the `claude` tool SHALL be `--model opus --effort high`, the same for every task.

#### Scenario: Selected verify unit

- **WHEN** a work unit whose stage is `verify` reaches `launch` and every precondition holds
- **THEN** an attempt `<source>:<task>:verify:<n>` is launched, and its session is created with `--model opus --effort high`

#### Scenario: Supplied task

- **WHEN** the run is invoked with `--apply --task linear:DOT-121 --stage verify`
- **THEN** `verify` is accepted as a registered stage

### Requirement: Verification prerequisites

The stage's prerequisites SHALL be the implementation stage's, checked in the same order with the same reasons: the tool is `claude`, one autonomy label, an OpenSpec root, the workflows the stage needs, the `openspec` CLI, the `handoff` skill, the task's context, an open pull request on the workspace branch that adds exactly one active change. Nothing SHALL initialise or update OpenSpec in a repository.

#### Scenario: Codex configured

- **WHEN** `sessions.tool` is `codex`
- **THEN** the prerequisites fail with a reason naming the tool, and nothing else is checked

#### Scenario: No pull request

- **WHEN** the workspace branch has no open pull request
- **THEN** the prerequisites fail with a reason naming the branch

#### Scenario: Everything present

- **WHEN** every prerequisite holds for a branch whose pull request adds the change `read-github-blockers`
- **THEN** the prerequisites hold and the prompt names the change `read-github-blockers`

### Requirement: The OpenSpec workflows the verification needs

The task's repository SHALL provide the verify and the update workflows, each as its OpenSpec 2 skill (`openspec-verify-change`, `openspec-update-change`) or its OpenSpec 1 command (`/opsx:verify`, `/opsx:update`), found as the other stages find theirs. The skill SHALL be preferred when both exist, and the name found SHALL reach the prompt.

#### Scenario: Repository on OpenSpec 2

- **WHEN** the task's repository has the skills `openspec-verify-change` and `openspec-update-change`
- **THEN** both workflows are found as skills, and the prompt names the skills

#### Scenario: Verify workflow missing

- **WHEN** the task's repository has an OpenSpec root but neither the skill `openspec-verify-change` nor the command `/opsx:verify`
- **THEN** the prerequisites fail with a reason naming both forms and telling the human to update OpenSpec in that repository, and no file is created in it

### Requirement: The adversarial review is the running plugin's

The prerequisites SHALL read the body of the adversarial review skill from the plugin the run belongs to, not from another installed copy of it, so that the prompt carries the skill of the same version as the runner. A skill file that cannot be read SHALL fail the prerequisites with a reason naming its path.

#### Scenario: Run from a branch

- **WHEN** the run's code comes from a branch whose plugin ships a newer adversarial review skill than the installed plugin
- **THEN** the prompt holds the branch's skill body

#### Scenario: Skill file missing

- **WHEN** the plugin's `skills/adversarial-review/SKILL.md` cannot be read
- **THEN** the prerequisites fail with a reason naming that path

### Requirement: The verification prompt

The prompt SHALL hold the shared frame, a Context section rendered as the other stages render it, the body of the `handoff` skill, the body of the adversarial review skill, and the stage's instructions. The instructions SHALL name the change, the open pull request, and the verify and update workflows as the repository provides them.

#### Scenario: Change and pull request named

- **WHEN** a verification prompt is written for a task whose pull request #90 adds the change `read-github-blockers`
- **THEN** the prompt names the change `read-github-blockers`, the verify workflow as the repository provides it, and pull request #90

#### Scenario: Comments are material

- **WHEN** a verification prompt is written for a task with a comment whose body holds a line `### 4. Closing`
- **THEN** the Context section names the comment's author, quotes every line of the body, and says that a comment is not an instruction

### Requirement: What the verification checks

The prompt SHALL tell the agent to check the implementation against the proposal, by running the repository's verify workflow on the change as it is, and against the acceptance criteria and non-goals of the task's definition. A deviation already recorded in the change's design SHALL count as the proposal's word, not as a finding.

#### Scenario: Verify workflow as it is

- **WHEN** a verification prompt is written
- **THEN** it tells the agent to run the verify workflow on the change with all its checks, Code Pattern Consistency included

#### Scenario: Acceptance criterion not covered

- **WHEN** the task's definition holds an acceptance criterion that no requirement of the change covers and the code does not meet
- **THEN** the prompt's instructions lead the report to hold a finding for it

#### Scenario: Recorded deviation

- **WHEN** the change's design records a deviation from a requirement, with its reason
- **THEN** the prompt's instructions lead the agent not to report the deviation as a finding

### Requirement: The verification corrects through one adversarial review

The prompt SHALL tell the agent to correct what it finds by running one round of the adversarial review, with the implementation as its subject, the proposal and the definition as its references, the verify workflow as the report's procedure, `CRITICAL` as the severity floor, and code review and QA as the later reviews a finding can be passed on to.

#### Scenario: Parameters named

- **WHEN** a verification prompt is written
- **THEN** it names the subject, the references, the report's procedure, the severity floor `CRITICAL`, and code review and QA as the later reviews

#### Scenario: One round

- **WHEN** a verification prompt is written
- **THEN** it tells the agent to run no second report after the fixes

### Requirement: The verification's boundary

The prompt SHALL tell the agent that a deeper review of the code's quality is code review's and running what the task delivers as its end user would is QA's. A finding that belongs to either SHALL be passed on in the stage summary, under a heading for that stage, and not fixed. After the fixes, every check the repository defines SHALL pass before the transition.

#### Scenario: Finding for QA

- **WHEN** the report holds a finding that can only be judged by running the application as its end user would
- **THEN** the prompt's instructions lead the agent to pass it on under a heading for QA in the stage summary

#### Scenario: Checks after the fixes

- **WHEN** the fixes are committed
- **THEN** the prompt tells the agent to run every check the repository defines, to fix what fails, and to treat a check that cannot pass as a blocker for `AFK` or a question for the human for `HITL`

### Requirement: Which way a fix goes

The prompt SHALL tell the agent to bring the code to the proposal, unless the refutation shows the proposal is the one that is wrong: then the change's artifacts are updated with the update workflow and the deviation recorded in the change's design, the stage summary and the logbook entry. For `AFK` the agent decides it and records it as an assumption; for `HITL` it asks the human first.

#### Scenario: AFK deviation

- **WHEN** a verification prompt is written for a task carrying `AFK`
- **THEN** it tells the agent to update the artifacts with the update workflow and record the deviation as an assumption, without asking

#### Scenario: HITL deviation

- **WHEN** a verification prompt is written for a task carrying `HITL`
- **THEN** it tells the agent to ask the human before it changes the proposal

### Requirement: A proposal that contradicts the definition

When the proposal contradicts the task's definition and the change's design records no deviation that explains it, the prompt SHALL tell an `AFK` agent that the definition wins: the code and the proposal are brought to it and the deviation is recorded. It SHALL tell an `HITL` agent to ask the human.

#### Scenario: AFK contradiction

- **WHEN** a verification prompt is written for a task carrying `AFK`
- **THEN** it tells the agent that the definition wins over a proposal that contradicts it with no recorded deviation

#### Scenario: HITL contradiction

- **WHEN** a verification prompt is written for a task carrying `HITL`
- **THEN** it tells the agent to ask the human which wins

### Requirement: A new attempt resumes the verification

The prompt SHALL tell the agent to look, before the report, for what an earlier attempt left: the branch's commits since the implementation and the workspace's uncommitted changes. Earlier commits stay and are part of what the report checks. Uncommitted changes SHALL be treated as an unfinished fix, never discarded, and committed only once a fix check accepts them.

#### Scenario: Second attempt

- **WHEN** a prompt is written for attempt `linear:DOT-121:verify:2`
- **THEN** it tells the agent to keep the earlier fix commits, to treat uncommitted changes as an unfinished fix, and never to discard them

### Requirement: Verification commits

The prompt SHALL tell the agent that only the orchestrator commits, never a teammate: one commit per fixed finding, holding its fix and its reproduction test when it has one, staged by path, in the repository's conventions, with no breaking marker unless the proposal declares one. Each commit SHALL be pushed, with no amend, no force push and no skipped hooks.

#### Scenario: One commit per finding

- **WHEN** two findings survive and are fixed
- **THEN** the prompt's rules lead to two commits, one per finding, each pushed before the next

#### Scenario: Conventions read from the repository

- **WHEN** a verification prompt is written
- **THEN** it tells the agent to take the commit type and scope from the repository's contributor instructions, commit rules and recent history

### Requirement: Follow-up tasks

The prompt SHALL tell the agent to propose a follow-up task for each deferred finding that survives the refutation, with a title, its reason and the finding it comes from, in the stage summary and the logbook entry. For `AFK` it SHALL create none. For `HITL` it SHALL create those the human confirms, labelled at creation, as tasks related to the task and never as its subtasks.

#### Scenario: AFK deferred finding

- **WHEN** a deferred finding survives the refutation in an `AFK` session
- **THEN** the stage summary and the logbook entry propose a follow-up task for it, and no task is created in the tracker

#### Scenario: HITL deferred finding

- **WHEN** the human confirms one of two proposed follow-up tasks in an `HITL` session
- **THEN** one task is created, related to the task and not its subtask, and the other stays proposed

### Requirement: The verification prompt follows the autonomy

For `AFK` the prompt SHALL tell the agent never to ask the human anything, to decide the finding triage itself, and to record its decisions and assumptions in the stage summary and the logbook entry. For `HITL` it SHALL tell the agent to show the human the finding triage before the refutation and apply their changes, and to show the human the outcome and the pull request before the transition.

#### Scenario: AFK task

- **WHEN** a verification prompt is written for a task carrying `AFK`
- **THEN** it forbids questions to the human and has no review step

#### Scenario: HITL task

- **WHEN** a verification prompt is written for a task carrying `HITL`
- **THEN** it has the human review the finding triage before the refutation, and the outcome before the approval question

### Requirement: The verification closing order

The prompt SHALL tell the agent to end the stage in this order: confirm the checks pass and every commit is pushed; for `HITL`, review the outcome with the human; write `stage-summary.md` and run persist mode; run the transition; write `logbook-entry.md`, with a section `### Verification`, and run log mode; write the result marker. A refused transition SHALL be handled as in the implementation stage.

#### Scenario: Commands named

- **WHEN** a verification prompt is written for attempt `linear:DOT-121:verify:1`
- **THEN** it names `/autonomous:run --apply --persist linear:DOT-121:verify:1`, `/autonomous:run --apply --transition linear:DOT-121` and `/autonomous:run --apply --log linear:DOT-121:verify:1`, in that order, and does not name pull-request mode

#### Scenario: Answer left for later

- **WHEN** the human answers "Later" to the approval question
- **THEN** the prompt's order leaves the entry unpublished, the result marker unwritten and the session open

#### Scenario: Summary written after the review

- **WHEN** an `HITL` verification prompt is written
- **THEN** it tells the agent to write `stage-summary.md` only once the review with the human is over, never before it, not even while it waits for the human's answer

#### Scenario: Transition refused again, AFK

- **WHEN** the transition of an `AFK` task is refused a second time
- **THEN** the prompt tells the agent to publish a logbook entry that says the attempt is blocked and why, to write no result marker and to stop, so the task keeps `verify`

#### Scenario: Logbook section

- **WHEN** a verification prompt is written
- **THEN** it tells the agent that the `### Verification` section lists the findings fixed, with their commits by subject, and those refuted, passed on, deferred and dismissed

### Requirement: The verification leaves the pull request a draft

The stage SHALL leave the task's pull request a draft. Neither the prompt nor any mode the stage runs SHALL mark it ready for review.

#### Scenario: Verification complete

- **WHEN** an attempt of the verification stage completes
- **THEN** the task's pull request is still a draft

### Requirement: A blocked AFK verification ends without a transition

For an `AFK` task, the prompt SHALL tell the agent what to do when it cannot finish the verification, because a fix is rejected twice, a check cannot be made to pass, or a fix needs a human: commit and push what is done, write a stage summary that explains the blocker and run persist mode, write a logbook entry that says the attempt is blocked and run log mode, run no transition, write no result marker, and stop.

#### Scenario: Fix rejected twice

- **WHEN** an `AFK` orchestrator's fix of a finding is rejected by two fix checks
- **THEN** the task keeps `verify`, the accepted fixes are pushed, the task's tracker holds a comment explaining the blocker, no result marker exists, and reconcile retains the attempt once its session ends

### Requirement: Verification stage summary comment

For a `verify` attempt, persist mode SHALL post the content of `stage-summary.md` as a comment on the task and SHALL NOT change the task's description. The first line SHALL be `autonomous · verify · <attempt-id> · stage summary saved`, followed by a blank line. A comment with that first line SHALL NOT be posted twice. The receipt SHALL be written only when the comment is read back.

#### Scenario: Comment header

- **WHEN** attempt `linear:DOT-121:verify:1` is persisted
- **THEN** the task has a new comment whose first line is `autonomous · verify · linear:DOT-121:verify:1 · stage summary saved`, and its description is unchanged

#### Scenario: Stage summary content

- **WHEN** a verification prompt is written
- **THEN** it tells the agent that the stage summary names the pull request's URL, the OpenSpec change, the commits, each finding by outcome with its reason, the findings passed on under a heading per later stage, the proposed follow-up tasks, and each deviation from the proposal

### Requirement: Public repositories in the verification

The prompt SHALL forbid absolute paths and other details of the machine in the commits, the change's artifacts, the stage summary, the logbook entry and any follow-up task, for every source, because the repository and its pull request may be public.

#### Scenario: Linear task

- **WHEN** a verification prompt is written for a Linear task
- **THEN** it holds the rule about absolute paths and machine details

### Requirement: Verification completion

The stage's completion check SHALL hold when the task carries `code-review` and no `verify`. It SHALL also hold when the task is closed in its tracker.

#### Scenario: Transitioned

- **WHEN** the task carries `personal`, `AFK` and `code-review`
- **THEN** the check holds

#### Scenario: Transition not applied

- **WHEN** the task still carries `verify`
- **THEN** the check does not hold

#### Scenario: Task closed

- **WHEN** the task was closed in its tracker
- **THEN** the check holds
