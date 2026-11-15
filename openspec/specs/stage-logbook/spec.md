# stage-logbook Specification

## Purpose
The pull request of a task and the logbook on it: how a stage finds or opens the task's draft pull request, what its cover says, and how each attempt leaves one logbook entry that a person can read to catch up on what happened.

## Requirements

### Requirement: One pull request per workspace branch

Pull-request mode SHALL act on the workspace branch of the attempt it is given. When that branch has an open pull request, the mode SHALL reuse it and open no other. Otherwise it SHALL push the branch and open a draft pull request against the repository's default branch. It SHALL never mark a pull request ready, merge it or close it, never force a push and never skip a hook.

#### Scenario: First stage to finish

- **WHEN** pull-request mode runs for an attempt whose branch has one commit ahead of the default branch and no pull request
- **THEN** the branch is pushed and a draft pull request is opened against the default branch

#### Scenario: Pull request already open

- **WHEN** pull-request mode runs for an attempt whose branch already has an open pull request
- **THEN** that pull request is reported and no second one is opened

#### Scenario: Push rejected

- **WHEN** the push is rejected by a hook
- **THEN** no pull request is opened, the report names the failed command, and the mode exits with code 3

### Requirement: A branch with nothing to show

When the branch has no commit ahead of the default branch, pull-request mode SHALL add one empty commit before pushing, so the pull request can exist. The exception is a task that has subtasks: for it the mode SHALL open no pull request, add no commit, and report that the parent of a split has nothing to show.

#### Scenario: Grill without documentation changes

- **WHEN** the mode runs for a task without subtasks whose branch equals the default branch
- **THEN** one empty commit is added, the branch is pushed and the draft pull request is opened

#### Scenario: Parent of a split without commits

- **WHEN** the mode runs for a task with two subtasks whose branch equals the default branch
- **THEN** no commit is added, no pull request is opened, and the mode exits with code 0 reporting no pull request and the reason

#### Scenario: Parent of a split with documentation commits

- **WHEN** the mode runs for a task with subtasks whose branch has a glossary commit ahead of the default branch
- **THEN** the draft pull request is opened as for any task

### Requirement: Pull request title

The title SHALL be the text the agent passes, followed by ` (<task id>)` unless the text already ends with it. A title SHALL be required to open a pull request: without one, nothing is pushed and the mode exits with code 3. When a title is passed for a pull request that is already open, the mode SHALL replace its title; when none is passed, the title is left as it is.

#### Scenario: Title with the task id

- **WHEN** the mode opens a pull request for Linear `DOT-121` with the title `feat(autonomous): read GitHub blockers`
- **THEN** the pull request is titled `feat(autonomous): read GitHub blockers (DOT-121)`

#### Scenario: No title and no pull request

- **WHEN** the mode runs without a title for a branch with no pull request
- **THEN** nothing is pushed or opened, and the mode exits with code 3 naming the missing title

#### Scenario: Title corrected by a later stage

- **WHEN** the mode runs with the title `fix(autonomous): read GitHub blockers` for a pull request that is already open
- **THEN** the pull request's title becomes `fix(autonomous): read GitHub blockers (DOT-121)`

### Requirement: The cover

The pull request's description SHALL be its cover, written by code from the task as its tracker holds it: a link to the task, or its id when it has no URL; the same for the parent task when the task is a subtask; and the Problem and the Solution sections of the task's definition. The mode SHALL write the cover every time it runs, replacing the description.

#### Scenario: Task with a definition

- **WHEN** the mode runs for a task whose description starts with `## Definition` and holds `### Problem` and `### Solution`
- **THEN** the cover holds the task's link and the text of those two sections, and none of the definition's other sections

#### Scenario: Subtask

- **WHEN** the mode runs for a subtask
- **THEN** the cover links the subtask and its parent task

#### Scenario: Cover refreshed

- **WHEN** the mode runs again after the task's definition changed
- **THEN** the pull request's description holds the new Problem and Solution

### Requirement: Cover of a task without a definition

For a task whose description holds no definition, the cover SHALL carry, in place of the Problem and the Solution, the first paragraph of the description, cut to 500 characters. For a task with no description, the cover SHALL carry the links only.

#### Scenario: Task triaged straight to proposal

- **WHEN** the mode runs for a task whose description is three paragraphs of free text
- **THEN** the cover holds the task's link and the first paragraph, cut to 500 characters

#### Scenario: Task without a description

- **WHEN** the mode runs for a task with no description
- **THEN** the cover holds the task's link and nothing else

### Requirement: A logbook entry per attempt

Log mode SHALL publish at most one logbook entry per attempt, as a comment on the open pull request of the attempt's workspace branch. The body is the file `logbook-entry.md` that the agent writes in the attempt's directory. An entry that was already published for the attempt SHALL NOT be published again. When the branch has no open pull request, nothing is published and the mode exits with code 3.

#### Scenario: Entry published

- **WHEN** log mode runs for a started attempt with a valid `logbook-entry.md` and an open pull request
- **THEN** one comment is added to that pull request, holding the header and the body

#### Scenario: Mode run twice

- **WHEN** log mode runs again for an attempt whose entry is already on the pull request
- **THEN** no second comment is added, and the mode exits with code 0

#### Scenario: No pull request

- **WHEN** log mode runs for an attempt whose branch has no open pull request
- **THEN** nothing is published, the report says so, and the mode exits with code 3

### Requirement: Logbook entry body

The body SHALL hold the sections `### What I did`, `### Decisions`, `### Assumptions` and `### Next stage`, and MAY hold further sections of the stage's own. Log mode SHALL reject a body, publishing nothing, when a required section is missing, when What I did is empty, when the body has more than 300 words, or when it contains the home directory of the machine. A rejection SHALL name every rule the body breaks.

#### Scenario: Minimal body

- **WHEN** the body holds the four sections, with Decisions and Assumptions saying `none`
- **THEN** the entry is published

#### Scenario: Section missing

- **WHEN** the body has no `### Assumptions` section
- **THEN** nothing is published, the report names the missing section, and the mode exits with code 3

#### Scenario: Body too long

- **WHEN** the body has 340 words
- **THEN** nothing is published and the report gives the count and the limit of 300

#### Scenario: Stage section

- **WHEN** the body adds a section `### Proposal` to the four required ones and stays within 300 words
- **THEN** the entry is published with that section

#### Scenario: Machine detail

- **WHEN** the body contains the absolute path of a file under the home directory
- **THEN** nothing is published and the report names the rule

### Requirement: Logbook entry header

Log mode SHALL write the header of the entry itself, from the attempt's record and its files and never from the agent's text. The header SHALL carry the stage, the attempt number, the task's autonomy label, the agent arguments of the launch, the start, the end and the duration, the transition answer recorded for the attempt, and the commits made on the branch since the attempt started, other than the empty commit pull-request mode adds. A value that is not recorded SHALL be left out.

#### Scenario: Grill with an answered autonomy

- **WHEN** log mode runs for the first grill-me attempt of a task, launched with `--model opus --effort high`, whose transition was answered `HITL` and which made one commit
- **THEN** the header names the grill-me stage with its emoji, attempt 1, `HITL`, `--model opus --effort high`, the start, the end and the duration, the answer `HITL`, and one commit with its short id

#### Scenario: Record from before this capability

- **WHEN** the attempt's record holds no agent arguments
- **THEN** the entry is published and its header omits them

#### Scenario: No commits

- **WHEN** the attempt made no commit on the branch
- **THEN** the header says there are no commits

### Requirement: The entry is read back and leaves a receipt

After publishing, log mode SHALL read the pull request's comments back and check that the entry is among them. Only then SHALL it write a logbook receipt in the attempt's directory, holding the attempt id, the pull request and the time. A failed publish or read-back SHALL leave no receipt and exit with code 3.

#### Scenario: Receipt written

- **WHEN** the entry is published and read back
- **THEN** the attempt's directory holds a logbook receipt naming the pull request

#### Scenario: Comment not found on read-back

- **WHEN** the comments read back do not hold the entry
- **THEN** no receipt is written and the mode exits with code 3

### Requirement: A discarded attempt leaves an entry

When an attempt is discarded and its workspace branch has an open pull request, discard mode SHALL publish one entry written entirely by code: the stage, the attempt number, that the attempt was discarded, and when. It SHALL NOT publish one when the attempt already has a logbook receipt. A failure to publish it SHALL be reported as a note and SHALL NOT change the outcome of the discard.

#### Scenario: Retained attempt discarded

- **WHEN** a retained attempt with no receipt is discarded and its branch has an open pull request
- **THEN** the pull request gains one comment saying that the attempt was discarded

#### Scenario: No pull request yet

- **WHEN** a discarded attempt's branch has no pull request
- **THEN** nothing is published and the discard succeeds

#### Scenario: Comment fails

- **WHEN** publishing the entry fails
- **THEN** the attempt is still discarded, and the report carries a note naming the failed command
