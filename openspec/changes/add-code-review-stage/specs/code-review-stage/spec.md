## Purpose

The code review stage: a managed session whose agent, the orchestrator, judges the quality of the code a task's implementation changed through one adversarial review whose report is the review team, publishes what survives as finding threads on the task's pull request, and ends with the transition to `external-review`.

## ADDED Requirements

### Requirement: The code review stage

The system SHALL register a stage with the id `code-review` and the emoji 🧐. Its agent arguments for the `claude` tool SHALL be `--model opus --effort high`, the same for every task.

#### Scenario: Selected code-review unit

- **WHEN** a work unit whose stage is `code-review` reaches `launch` and every precondition holds
- **THEN** an attempt `<source>:<task>:code-review:<n>` is launched, and its session is created with `--model opus --effort high`

#### Scenario: Supplied task

- **WHEN** the run is invoked with `--apply --task linear:DOT-164 --stage code-review`
- **THEN** `code-review` is accepted as a registered stage

### Requirement: Code review prerequisites

The stage's prerequisites SHALL be the verification's, checked in the same order with the same reasons, except that the stage needs no OpenSpec workflow: the tool is `claude`, one autonomy label, an OpenSpec root, the `openspec` CLI, the `handoff` skill, the task's context, and an open pull request on the workspace branch that adds exactly one active change.

#### Scenario: No pull request

- **WHEN** the workspace branch has no open pull request
- **THEN** the prerequisites fail with a reason naming the branch

#### Scenario: No verify workflow

- **WHEN** the task's repository has neither `openspec-verify-change` nor `/opsx:verify`, and every other prerequisite holds
- **THEN** the prerequisites hold

### Requirement: The skills are the running plugin's

The prerequisites SHALL read the bodies of the review team skill and of the adversarial review skill from the plugin the run belongs to, not from another installed copy. A skill file that cannot be read SHALL fail the prerequisites with a reason naming its path.

#### Scenario: Review team skill missing

- **WHEN** the plugin's `skills/review-team/SKILL.md` cannot be read
- **THEN** the prerequisites fail with a reason naming that path

### Requirement: The code review prompt

The prompt SHALL hold the shared frame, a Context section rendered as the other stages render it, the body of the `handoff` skill, the bodies of the adversarial review and review team skills, and the stage's instructions. The instructions SHALL name the change, the open pull request and the attempt's directory.

#### Scenario: Change and pull request named

- **WHEN** a code review prompt is written for a task whose pull request #120 adds the change `add-code-review-stage`
- **THEN** the prompt names the change, pull request #120 and the attempt's directory

### Requirement: What the code review judges

The prompt SHALL tell the agent to judge the quality of the code the implementation changed, not its match with the proposal, which is the verification's. The definition and the proposal SHALL serve as references for the intent. What the repository's automated checks enforce SHALL not be reported again.

#### Scenario: What a check already enforces

- **WHEN** a reviewer reports a formatting issue that the repository's formatter enforces
- **THEN** the prompt's instructions lead the agent to dismiss it, naming the check

### Requirement: The code review runs one adversarial review with the review team

The prompt SHALL tell the agent to run one round of the adversarial review with:

- the code the implementation changed as its subject;
- the definition and the proposal as its references;
- the review team as the report's procedure, written to the attempt's directory at the measured tier;
- `CRITICAL` as the severity floor;
- QA and external review as the later reviews.

The agent MAY raise the tier with a reason, never lower it.

#### Scenario: Parameters named

- **WHEN** a code review prompt is written
- **THEN** it names the subject, the references, the review team as the report's procedure, the floor `CRITICAL`, QA and external review as the later reviews, and `findings.md` in the attempt's directory as the record

#### Scenario: One round for AFK

- **WHEN** a code review prompt is written for a task carrying `AFK`
- **THEN** it tells the agent to run no second report after the fixes

### Requirement: What verification passed on is an input

The prompt SHALL tell the agent to add to the report, as findings of the reviewer `verification`, the open finding threads addressed to code review on the pull request and the findings under the `Code review` heading of verification's stage summary. They go through the finding triage like the others. The review team's reviewers SHALL not receive them.

#### Scenario: Thread addressed to code review

- **WHEN** the pull request holds an open finding thread whose marker says `for=code-review`
- **THEN** the finding triage holds a finding from the reviewer `verification` for it, and the thread is resolved with its outcome when the stage publishes

#### Scenario: Stage summary heading

- **WHEN** verification's stage summary lists two findings under `Code review`
- **THEN** the finding triage holds two findings from the reviewer `verification`

### Requirement: The code review never changes the proposal

The prompt SHALL forbid changing the proposal or the definition. A finding whose fix would contradict either SHALL be deferred to a follow-up task for `AFK`. For `HITL`, the agent SHALL ask the human.

#### Scenario: Fix against an approved decision

- **WHEN** a finding's fix would replace a design decision recorded in the change's design, in an `AFK` session
- **THEN** the finding is deferred to a proposed follow-up and the change's artifacts are unchanged

### Requirement: Doubts are settled or handed to the human

The prompt SHALL tell the agent to settle each doubt the report holds against the definition and the proposal first. A doubt they do not settle SHALL be asked of the human for `HITL` and published as an open thread for `AFK`. A doubt SHALL be neither refuted nor fixed.

#### Scenario: Doubt settled by the proposal

- **WHEN** a doubt asks whether a removed flag is intended and the proposal says it is removed
- **THEN** the doubt is recorded as settled, with the proposal's text, and nothing is published for it

#### Scenario: AFK doubt left open

- **WHEN** neither the definition nor the proposal settles a doubt in an `AFK` session
- **THEN** it is published as an open finding thread labelled `question (blocking)`

### Requirement: What the code review publishes

The stage SHALL publish, as finding threads on the pull request (ADR 0008), the findings that survived the refutation and the doubts left open. Fixed `SUGGESTION`s, refuted findings and dismissed findings SHALL appear only in the logbook entry.

#### Scenario: Refuted finding

- **WHEN** a finding does not survive the refutation
- **THEN** no thread is published for it, and the logbook entry lists it as refuted

#### Scenario: Fixed suggestion

- **WHEN** a `SUGGESTION` finding is fixed
- **THEN** no thread is published for it, and the logbook entry lists it with its commit

### Requirement: A thread's state follows its outcome

A published thread SHALL be resolved when nothing is left to do before the merge, and open otherwise. Resolved threads are fixed `CRITICAL` and `WARNING` findings, with their commit, and findings deferred to a created follow-up, with its URL. Open threads are proposed follow-ups, findings passed on to QA or external review, blocked fixes and open doubts.

#### Scenario: Fixed critical finding

- **WHEN** a `CRITICAL` finding is fixed in commit `3f9c2e1`
- **THEN** its thread is published resolved, and its status line names `3f9c2e1`

#### Scenario: Passed on to QA

- **WHEN** a finding is passed on to QA
- **THEN** its thread is open, tagged `#qa`, and its hidden marker says `for=qa`

#### Scenario: Proposed follow-up

- **WHEN** an `AFK` session defers a finding to a proposed follow-up
- **THEN** its thread is open and says a person creates the follow-up or resolves the thread to drop it

### Requirement: The finding thread's format

Each thread SHALL open with a Conventional Comments label and decoration: `issue`, `suggestion` or `question`, `blocking` for a `CRITICAL` finding or a doubt and `non-blocking` otherwise. Then a one-line title, a statement of one to three sentences and a status line. Then a folded trace naming the reporters, the severity, the reproduction and the attempt. Last, a hidden versioned marker. Content SHALL be in English, and a follow-up SHALL be linked by its URL.

#### Scenario: Comment rendered

- **WHEN** a fixed finding reported by two reviewers is published
- **THEN** its comment starts with `**issue (blocking):**`, folds its trace in a `<details>` block naming both reviewers, and ends with a marker `<!-- autonomous:finding v1 … -->`

### Requirement: One review per attempt, anchored to the final diff

The stage SHALL publish one review per attempt, with the event COMMENT. Its body SHALL be a short index: counts per outcome, the team and its skipped reviewers, and links to the logbook entry. Each thread SHALL be anchored to its lines in the final diff, else to its file, else to the review's body.

#### Scenario: Finding on an unchanged line

- **WHEN** a finding's lines are not part of the final diff but its file is
- **THEN** its thread is a file comment on that file

### Requirement: Publishing is idempotent

Publishing SHALL find the markers already on the pull request and SHALL NOT publish a thread or a review twice. A re-attempt SHALL resolve or update the threads an earlier attempt left, by their markers.

#### Scenario: Re-attempt

- **WHEN** attempt `linear:DOT-164:code-review:2` publishes a finding whose marker an earlier attempt already published
- **THEN** no second thread is created for it

### Requirement: The walkthrough at the close

The prompt SHALL tell the agent to bring the review team's guide up to the final diff once the fixes are committed, with each published finding as a note at its lines. It SHALL import the guide for the pull request with Plannotator and put a short markdown rendering of its intent and sections in the logbook entry. For `HITL`, it SHALL also send the guide to the human through the Plannotator Inbox. When Plannotator is not available, the logbook entry SHALL say so and the stage SHALL go on.

#### Scenario: Guide imported

- **WHEN** the fixes are committed and Plannotator is available
- **THEN** the guide holds a note per published finding and is imported for the task's pull request

### Requirement: The human round

For `HITL`, the prompt SHALL tell the agent to have the human review the outcome on GitHub or in Plannotator, and to take each comment as a finding of the reviewer `human` in one more round of the adversarial review. In that round the refutation is advisory. Comments made on GitHub SHALL be answered and resolved in their threads. Comments made in Plannotator SHALL be published as threads reported by `human`. Rounds SHALL repeat until the human approves at the transition question.

#### Scenario: Human comment on GitHub

- **WHEN** the human leaves a blocking review comment on the pull request during an `HITL` code review
- **THEN** it is fixed, committed and pushed, and its thread is answered with the commit and resolved

#### Scenario: AFK task

- **WHEN** a code review prompt is written for a task carrying `AFK`
- **THEN** it has no human round

### Requirement: Code review commits

The prompt SHALL apply the verification's commit rules. Only the orchestrator commits. Each fixed finding gets one commit, holding its fix and its reproduction test, staged by path and in the repository's conventions. Each commit is pushed before the next, with no amend, no force push and no skipped hook.

#### Scenario: One commit per finding

- **WHEN** two findings survive and are fixed
- **THEN** the prompt's rules lead to two commits, each pushed before the next

### Requirement: A new attempt resumes the code review

The prompt SHALL tell the agent to keep the commits an earlier attempt pushed, to treat uncommitted changes as an unfinished fix that is never discarded, and to read the threads an earlier attempt published before it publishes.

#### Scenario: Second attempt

- **WHEN** a prompt is written for attempt `linear:DOT-164:code-review:2`
- **THEN** it tells the agent to keep earlier commits, never to discard uncommitted changes, and to reuse the earlier threads by their markers

### Requirement: Follow-up tasks

The prompt SHALL apply the verification's rule on follow-up tasks. For `AFK`, the agent proposes them and creates none. For `HITL`, it creates those the human confirms, labelled at creation and related to the task, never its subtasks. A created follow-up's thread SHALL be resolved with its URL.

#### Scenario: HITL follow-up created

- **WHEN** the human confirms a proposed follow-up in an `HITL` session
- **THEN** the task is created and related, and the finding's thread is resolved with its URL

### Requirement: The code review prompt follows the autonomy

For `AFK` the prompt SHALL forbid questions to the human, have the agent decide the finding triage itself, and record its decisions and assumptions in the stage summary and the logbook entry. For `HITL` it SHALL show the human the finding triage before the refutation, and the outcome, the threads and the walkthrough before the approval question.

#### Scenario: HITL task

- **WHEN** a code review prompt is written for a task carrying `HITL`
- **THEN** it has the human review the finding triage before the refutation, and the outcome before the approval question

### Requirement: The code review closing order

The prompt SHALL tell the agent to end the stage in this order:

1. Confirm the checks pass and every commit is pushed.
2. Publish the finding threads and the walkthrough.
3. For `HITL`, run the human round until the human is done.
4. Write `stage-summary.md` and run persist mode.
5. Run the transition, naming `code-review` as the stage it leaves.
6. Write `logbook-entry.md`, with a section `### Code review`, and run log mode.
7. Write the result marker.

#### Scenario: Commands named

- **WHEN** a code review prompt is written for attempt `linear:DOT-164:code-review:1`
- **THEN** it names `/autonomous:run --apply --publish linear:DOT-164:code-review:1`, `/autonomous:run --apply --persist linear:DOT-164:code-review:1`, `/autonomous:run --apply --transition linear:DOT-164 --from code-review` and `/autonomous:run --apply --log linear:DOT-164:code-review:1`, in that order

#### Scenario: Logbook section

- **WHEN** a code review prompt is written
- **THEN** it tells the agent that the `### Code review` section names the tier and the team, the findings by outcome with their threads and commits, the refuted and dismissed ones, and the walkthrough

### Requirement: The code review leaves the pull request a draft

The stage SHALL leave the task's pull request a draft. Neither the prompt nor any mode the stage runs SHALL mark it ready for review.

#### Scenario: Code review complete

- **WHEN** an attempt of the code review stage completes
- **THEN** the task's pull request is still a draft

### Requirement: A blocked AFK code review ends without a transition

For an `AFK` task that cannot finish, because a fix is rejected twice, a check cannot pass or a fix needs a human, the prompt SHALL tell the agent to:

1. commit and push what is done;
2. publish the threads, the blocked fix's thread open;
3. write the stage summary with the blocker and run persist mode;
4. write a blocked logbook entry and run log mode;
5. stop with no transition and no result marker.

#### Scenario: Fix rejected twice

- **WHEN** an `AFK` orchestrator's fix is rejected by two fix checks
- **THEN** the task keeps `code-review`, the accepted fixes are pushed, the blocked finding's thread is open, and no result marker exists

### Requirement: Code review stage summary comment

For a `code-review` attempt, persist mode SHALL post `stage-summary.md` as a comment on the task without changing its description. The comment's first line SHALL be `autonomous · code-review · <attempt-id> · stage summary saved`. The stage summary SHALL name the pull request, the tier and team, the commits, each finding by outcome with its thread, the proposed follow-ups and the open doubts.

#### Scenario: Comment header

- **WHEN** attempt `linear:DOT-164:code-review:1` is persisted
- **THEN** the task has a new comment whose first line is `autonomous · code-review · linear:DOT-164:code-review:1 · stage summary saved`

### Requirement: Public repositories in the code review

The prompt SHALL forbid absolute paths and other details of the machine in the commits, the finding threads, the review's body, the walkthrough, the stage summary, the logbook entry and any follow-up task, for every source.

#### Scenario: Thread content

- **WHEN** a finding's evidence names a file
- **THEN** the thread names it by its repository-relative path

### Requirement: Code review completion

The stage's completion check SHALL hold when the task carries `external-review` and no `code-review`, or when the task is closed in its tracker.

#### Scenario: Transitioned

- **WHEN** the task carries `personal`, `HITL` and `external-review`
- **THEN** the check holds

#### Scenario: Transition not applied

- **WHEN** the task still carries `code-review`
- **THEN** the check does not hold
