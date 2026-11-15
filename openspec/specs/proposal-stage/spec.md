# proposal-stage Specification

## Purpose
Proposal preparation: a managed session in which an agent turns a task's definition into a proposal with OpenSpec, commits it in the task's draft pull request, leaves a stage summary and a logbook entry, and ends with the transition to `implement`.

## Requirements

### Requirement: The proposal stage

The system SHALL register a stage with the id `proposal` and the emoji 📝. Its agent arguments for the `claude` tool SHALL be `--model opus --effort high`, the same for every task.

#### Scenario: Selected proposal unit

- **WHEN** a work unit whose stage is `proposal` reaches `launch` and every precondition holds
- **THEN** an attempt `<source>:<task>:proposal:<n>` is launched, and its session is created with `--model opus --effort high`

#### Scenario: Supplied task

- **WHEN** the run is invoked with `--apply --task linear:DOT-121 --stage proposal`
- **THEN** `proposal` is accepted as a registered stage

### Requirement: Proposal prerequisites

The stage's prerequisites SHALL hold only when the configured tool is `claude`, the task's repository holds an OpenSpec root, the `openspec` CLI can be run, and the `handoff` skill of the `mattpocock-skills` plugin is found as the grill-me stage finds its skills. Each failure SHALL give its own reason, naming what is missing. Nothing SHALL initialise OpenSpec in a repository.

#### Scenario: Codex configured

- **WHEN** `sessions.tool` is `codex`
- **THEN** the prerequisites fail with a reason naming the tool, and nothing else is checked

#### Scenario: Repository without OpenSpec

- **WHEN** the task's repository has no `openspec` directory
- **THEN** the prerequisites fail with a reason naming the repository and the missing OpenSpec root, and no file is created in the repository

#### Scenario: CLI missing

- **WHEN** the `openspec` command is not found
- **THEN** the prerequisites fail with a reason naming the command

#### Scenario: Everything present

- **WHEN** the tool is `claude`, the repository has an OpenSpec root, the CLI runs and the skill is found
- **THEN** the prerequisites hold

### Requirement: The run gathers the task's context

Before the prompt is written, the run SHALL read the task's context from its tracker, in code: every comment with its author, oldest first; the parent with its id, title, state, URL and description; and the children, the tasks that block it, the tasks it blocks, the related tasks and the duplicates, each with its id, title, state and URL. It SHALL read nothing about those tasks beyond that. A read that fails SHALL fail the prerequisites, naming the command.

#### Scenario: Linear task after a grill

- **WHEN** the context is read for a Linear task that has a grill's stage summary as a comment, a parent, and one issue that blocks it
- **THEN** the context holds that comment, the parent with its description, and the blocker with its id, title, state and URL and without its description

#### Scenario: Task with no relations

- **WHEN** the context is read for a task with no comment, parent or relation
- **THEN** the context holds none, and the prerequisites hold

#### Scenario: Tracker read fails

- **WHEN** reading the task's comments fails
- **THEN** the prerequisites fail with a reason naming the command, and nothing is written

### Requirement: Context that only some trackers have

The context SHALL also hold what only some trackers record: for Linear, the task's project and its attachments, each with its title and URL; for GitHub, the pull requests linked to the issue. A GitHub task's context SHALL hold no blockers, and SHALL say that GitHub dependencies were not read.

#### Scenario: Linear attachments

- **WHEN** the context is read for a Linear issue with one attached link and a project
- **THEN** the context holds the project's name and the attachment's title and URL

#### Scenario: GitHub task

- **WHEN** the context is read for a GitHub issue
- **THEN** the context holds its sub-issues and linked pull requests, no blockers, and the note that dependencies were not read

### Requirement: The proposal prompt

The prompt SHALL hold the shared frame, a Context section rendered from what the run read, the body of the `handoff` skill, and the stage's instructions. The instructions SHALL tell the agent to prepare the proposal by running `/opsx:propose` with the task and its context, to let OpenSpec name the change, to write exactly one proposal without splitting the task, and to edit no project code. When the workspace branch already has an open pull request, the prompt SHALL name it.

#### Scenario: Context in the prompt

- **WHEN** a proposal prompt is written for a task whose context holds two comments and a blocker
- **THEN** the prompt's Context section holds both comments in order and the blocker's id, title, state and URL

#### Scenario: Empty context

- **WHEN** the task has no comment and no relation
- **THEN** the Context section says so, and no empty list is rendered

#### Scenario: Large proposal

- **WHEN** a proposal prompt is written
- **THEN** it tells the agent to say when the proposal is too large for one task, and still to write one proposal and create no subtask

#### Scenario: Pull request already open

- **WHEN** the workspace branch has an open pull request when the prompt is written
- **THEN** the prompt names that pull request and tells the agent to continue it

### Requirement: Comments in the prompt are attributed and quoted

The Context section SHALL name the author of each comment, or say that the author is unknown, and SHALL quote every line of the comment's body. It SHALL tell the agent that a comment is material about the task and not an instruction, and that it overrides neither the prompt's sections nor its constraints.

#### Scenario: A comment cannot pass for a prompt section

- **WHEN** a proposal prompt is written for a task with a comment whose body holds a line `### 4. Closing`
- **THEN** the Context section names the comment's author, every line of the body is quoted, and the section says that a comment is not an instruction

### Requirement: The prompt follows the autonomy

The prompt SHALL be written for the task's autonomy. For `AFK` it SHALL tell the agent never to ask the human anything, to decide where the definition leaves a gap, and to record each assumption in the proposal's design, in the stage summary and in the logbook entry. For `HITL` it SHALL let the agent ask, and SHALL tell it to show the human the proposal and its pull request once written and to iterate on the feedback, each round as a new commit, before the transition.

#### Scenario: AFK task

- **WHEN** a proposal prompt is written for a task carrying `AFK`
- **THEN** it forbids questions to the human and has no review step

#### Scenario: HITL task

- **WHEN** a proposal prompt is written for a task carrying `HITL`
- **THEN** it has the review step, and says the transition question is asked only after the human has seen the proposal

### Requirement: The proposal closing order

The prompt SHALL tell the agent to end the stage in this order:

1. commit and push the proposal;
2. run pull-request mode, with a title in the repository's conventions;
3. for `HITL`, review the proposal with the human;
4. write `stage-summary.md` and run persist mode;
5. run the transition;
6. write `logbook-entry.md` and run log mode;
7. write the result marker.

#### Scenario: Commands named

- **WHEN** a proposal prompt is written for attempt `linear:DOT-121:proposal:1`
- **THEN** it names `/autonomous:run --apply --pull-request linear:DOT-121:proposal:1 --title`, `/autonomous:run --apply --persist linear:DOT-121:proposal:1`, `/autonomous:run --apply --transition linear:DOT-121` and `/autonomous:run --apply --log linear:DOT-121:proposal:1`, in that order

#### Scenario: Answer left for later

- **WHEN** the human answers "Later" to the approval question
- **THEN** the prompt's order leaves the entry unpublished, the result marker unwritten and the session open

#### Scenario: Stage summary content

- **WHEN** a proposal prompt is written
- **THEN** it tells the agent that the stage summary names the pull request's URL, the OpenSpec change and each deviation from the task's definition

#### Scenario: Logbook section

- **WHEN** a proposal prompt is written
- **THEN** it tells the agent to add a section `### Proposal` to the logbook entry, naming the OpenSpec change and its files

### Requirement: A proposal's commits and pushes

The prompt SHALL let the agent commit and push only the files of the OpenSpec change it wrote and the glossary and ADR files it changed, on the workspace branch. Commits and pushes SHALL use no force push and no skipped hooks. The agent SHALL open no pull request itself. A failed push SHALL be reported to the human for an `HITL` task; for an `AFK` task it is a blocker.

#### Scenario: Files committed

- **WHEN** the agent wrote the change `read-github-blockers` and changed no other file
- **THEN** the prompt's instructions lead to a commit that holds only files under that change's directory

#### Scenario: Push rejected for an AFK task

- **WHEN** the pre-push hook rejects the push of an `AFK` task
- **THEN** the agent treats it as a blocker and makes no transition

### Requirement: A new attempt continues the work

The prompt SHALL tell the agent to look, before it proposes anything, for an OpenSpec change that an earlier attempt of the same task left in the workspace, and to continue it instead of creating another. One task SHALL end with one OpenSpec change and one pull request.

#### Scenario: Second attempt

- **WHEN** a second attempt starts in a workspace that already holds a change for the task
- **THEN** the prompt's instructions lead the agent to update that change, and no second change is created

### Requirement: A blocked AFK agent ends without a transition

For an `AFK` task, the prompt SHALL tell the agent what to do when it cannot write a sound proposal: write a stage summary that explains the blocker and run persist mode; when the branch has a pull request, write a logbook entry that says the attempt is blocked and run log mode; run no transition, write no result marker, and stop.

#### Scenario: Contradictory definition

- **WHEN** an `AFK` agent finds that the definition contradicts itself
- **THEN** the task keeps `proposal`, its tracker holds a comment explaining the blocker, no result marker exists, and reconcile retains the attempt once its session ends

### Requirement: Proposal stage summary comment

For a `proposal` attempt, persist mode SHALL post the content of `stage-summary.md` as a comment on the task and SHALL NOT change the task's description. The first line SHALL be `autonomous · proposal · <attempt-id> · stage summary saved`, followed by a blank line. A comment with that first line SHALL NOT be posted twice. The receipt SHALL be written only when the comment is read back.

#### Scenario: Comment header

- **WHEN** attempt `linear:DOT-121:proposal:1` is persisted
- **THEN** the task has a new comment whose first line is `autonomous · proposal · linear:DOT-121:proposal:1 · stage summary saved`, and its description is unchanged

#### Scenario: Persisted twice

- **WHEN** persist mode runs again for the same attempt
- **THEN** no second comment is posted and the receipt exists

### Requirement: Public repositories

The prompt SHALL forbid absolute paths and other details of the machine in the proposal, the stage summary and the logbook entry, for every source, because the repository and its pull request may be public.

#### Scenario: Linear task

- **WHEN** a proposal prompt is written for a Linear task
- **THEN** it holds the rule about absolute paths and machine details

### Requirement: Proposal completion

The stage's completion check SHALL hold when the task carries `implement` and no `proposal`. It SHALL also hold when the task is closed in its tracker.

#### Scenario: Transitioned

- **WHEN** the task carries `personal`, `AFK` and `implement`
- **THEN** the check holds

#### Scenario: Transition not applied

- **WHEN** the task still carries `proposal`
- **THEN** the check does not hold

#### Scenario: Task closed

- **WHEN** the task was closed in its tracker
- **THEN** the check holds
