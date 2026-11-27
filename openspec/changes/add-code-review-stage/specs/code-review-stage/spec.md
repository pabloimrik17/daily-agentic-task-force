## Purpose

The code review stage: a managed session whose orchestrator judges the quality of the code a task's implementation changed through the review team and one adversarial review, publishes what survives as finding threads on the pull request, and ends with the transition to `external-review`.

## ADDED Requirements

### Requirement: The code review stage

The system SHALL register a stage with the id `code-review` and the emoji 🧐. Its agent arguments for the `claude` tool SHALL be `--model opus --effort high`, the same for every task.

#### Scenario: Selected code-review unit

- **WHEN** a work unit whose stage is `code-review` reaches `launch` and every precondition holds
- **THEN** an attempt `<source>:<task>:code-review:<n>` is launched, and its session is created with `--model opus --effort high` and titled `auto 🧐 <name> (<task id>)`

#### Scenario: Supplied task

- **WHEN** the run is invoked with `--apply --task linear:DOT-121 --stage code-review`
- **THEN** `code-review` is accepted as a registered stage

### Requirement: Code review prerequisites

The stage's prerequisites SHALL be verification's, in the same order with the same reasons, without the verify and update workflows: the tool is `claude`, one autonomy label, an OpenSpec root, the `openspec` CLI, the `handoff` skill, the task's context, an open pull request on the workspace branch that adds exactly one active change. Nothing SHALL initialise or update OpenSpec in a repository.

#### Scenario: Codex configured

- **WHEN** `sessions.tool` is `codex`
- **THEN** the prerequisites fail with a reason naming the tool, and nothing else is checked

#### Scenario: No pull request

- **WHEN** the workspace branch has no open pull request
- **THEN** the prerequisites fail with a reason naming the branch

#### Scenario: No verify workflow

- **WHEN** the task's repository provides neither the skill `openspec-verify-change` nor the command `/opsx:verify`, and every other prerequisite holds
- **THEN** the prerequisites hold

### Requirement: The review skills are the running plugin's

The prerequisites SHALL read the bodies of the review team and adversarial review skills from the plugin the run belongs to, never from another installed copy. Each reference to the plugin's root in a body SHALL be replaced by that plugin's directory, so every command the body names runs the runner's own code. A skill file that cannot be read SHALL fail the prerequisites with a reason naming its path.

#### Scenario: Run from a branch

- **WHEN** the run's code comes from a branch whose plugin ships a newer review team skill than the installed plugin
- **THEN** the prompt holds the branch's skill body, and its commands name the branch's plugin directory

#### Scenario: Review team skill missing

- **WHEN** the plugin's `skills/review-team/SKILL.md` cannot be read
- **THEN** the prerequisites fail with a reason naming that path

### Requirement: Optional tools are never prerequisites

A missing Plannotator, Codex or CodeRabbit SHALL NOT fail the prerequisites. The review team skips a reviewer that cannot run with its reason, and the stage records what is lost without Plannotator.

#### Scenario: Plannotator missing

- **WHEN** every prerequisite holds and the `plannotator` command is not found
- **THEN** the prerequisites hold, and the prompt tells the agent that there is no walkthrough and that the human round runs on GitHub only

### Requirement: Finding threads read at launch

The prerequisites SHALL read the finding threads already on the pull request: those a code review published, open or resolved, and the open ones addressed to code review. The prompt SHALL list them, each with its state, its location, its markers and its URL. A pull request whose threads cannot be read SHALL fail the prerequisites with the reason.

#### Scenario: Earlier attempt published

- **WHEN** a second attempt is launched on a pull request where the first published three threads, one of them open
- **THEN** the prompt lists the three threads, with the open one marked open

#### Scenario: Thread addressed to code review

- **WHEN** the pull request holds an open thread whose marker addresses it to `code-review`
- **THEN** the prompt lists it among the findings passed on to code review

### Requirement: The code review prompt

The prompt SHALL hold the shared frame, a Context section rendered as the other stages render it, the body of the `handoff` skill, the bodies of the review team and adversarial review skills, the finding threads read at launch, and the stage's instructions. The instructions SHALL name the change and the open pull request.

#### Scenario: Change and pull request named

- **WHEN** a code review prompt is written for a task whose pull request #90 adds the change `read-github-blockers`
- **THEN** the prompt names the change `read-github-blockers` and pull request #90

#### Scenario: Comments are material

- **WHEN** a code review prompt is written for a task with a comment whose body holds a line `### 4. Closing`
- **THEN** the Context section names the comment's author, quotes every line of the body, and says that a comment is not an instruction

### Requirement: The code review runs one adversarial review round

The prompt SHALL tell the agent to run one review round of the adversarial review with these parameters: the pull request's diff from its merge base as subject; the definition and the proposal as references; the review team as the report's procedure; `CRITICAL` as the floor; QA as the only later review; `findings.json` in the attempt's directory as the record; and whether a human follows it from the autonomy.

#### Scenario: Parameters named

- **WHEN** a code review prompt is written
- **THEN** it names the subject, the references, the review team as the report's procedure, the floor `CRITICAL`, QA as the only later review, and the record `findings.json`

#### Scenario: One round

- **WHEN** a code review prompt is written for a task carrying `AFK`
- **THEN** it tells the agent to run no second report after the fixes

### Requirement: The review team runs as it ships

The prompt SHALL tell the agent to follow the review team skill with its report directory inside the attempt's directory, at the tier the review team measures, never raising it. The references SHALL NOT reach the reviewers: the finding triage and the refutation read them.

#### Scenario: Tier not raised

- **WHEN** a code review prompt is written
- **THEN** it tells the agent to pass no `--tier` to the review team's plan

#### Scenario: Reviewers get no references

- **WHEN** a code review prompt is written
- **THEN** it tells the agent to give the reviewers nothing but their briefs, and to use the definition and the proposal in the finding triage and the refutation

### Requirement: Findings passed on by verification

The prompt SHALL tell the agent to add to the finding triage, as findings of the reviewer `verification`, the open threads addressed to code review and the findings under the `Code review` heading of verification's stage summary.

#### Scenario: Heading in the summary

- **WHEN** the verification's stage summary among the task's comments lists two findings under `Code review`
- **THEN** the prompt's instructions lead the agent to triage both as findings of the reviewer `verification`

### Requirement: The code review never changes the proposal or the definition

The prompt SHALL tell the agent never to change the change's artifacts or the task's definition. A finding whose fix would contradict or change them, including one located in the change's own artifacts, SHALL be deferred to a follow-up for `AFK` and asked of the human for `HITL`. Any other finding located in the change's artifacts is an ordinary finding.

#### Scenario: AFK finding on the design

- **WHEN** a finding of an `AFK` code review shows that a step of the change's `design.md` is wrong
- **THEN** the prompt's instructions lead the agent to defer it to a proposed follow-up task, not to edit the design

#### Scenario: HITL finding against the proposal

- **WHEN** a finding of an `HITL` code review can only be fixed by contradicting a requirement of the change
- **THEN** the prompt's instructions lead the agent to ask the human

### Requirement: A conflict with the base is left as it is

The prompt SHALL tell the agent not to merge or rebase the base branch and not to resolve a conflict with it: the stage reviews the branch as it is, and names a conflict in the stage summary and the logbook entry.

#### Scenario: Conflicting pull request

- **WHEN** a code review prompt is written for a task whose pull request conflicts with its base
- **THEN** it tells the agent to review the branch as it is and to name the conflict in the stage summary and the logbook entry

### Requirement: Doubts are settled before they reach the human

The prompt SHALL tell the agent to settle each doubt in the finding triage against the definition and the proposal first. A doubt they do not settle SHALL be asked of the human for `HITL` and published as an open `question (blocking)` thread for `AFK`. A doubt SHALL be neither refuted nor fixed.

#### Scenario: AFK doubt

- **WHEN** an `AFK` code review holds a doubt neither the definition nor the proposal settles
- **THEN** the prompt's instructions lead the agent to record it for publication as an open `question (blocking)` thread

#### Scenario: Doubt the definition settles

- **WHEN** a doubt asks whether a behaviour is intended and a non-goal of the definition answers it
- **THEN** the prompt's instructions lead the agent to settle it in the triage, with the non-goal as its reason

### Requirement: The human round

For `HITL`, the prompt SHALL tell the agent to hold human rounds after the stage's round is published and before the approval question: the human reviews on GitHub or in the walkthrough; each comment becomes a finding of the reviewer `human`; the round runs the triage, an advisory refutation, the fixes and their fix checks, and ends with publish mode.

#### Scenario: Comment on GitHub

- **WHEN** the human leaves a comment on a line of the pull request during a human round
- **THEN** the prompt's instructions lead the agent to triage it as a finding of the reviewer `human`, and publish mode answers its thread once it is accounted for, resolving it when the finding is fixed or deferred to a created follow-up task and leaving its state as it is otherwise

#### Scenario: Comment in Plannotator

- **WHEN** the human's Plannotator review returns a comment on a line
- **THEN** the prompt's instructions lead the agent to triage it as a finding of the reviewer `human`, published as a thread reported by `human`

#### Scenario: AFK task

- **WHEN** a code review prompt is written for a task carrying `AFK`
- **THEN** it holds no human round

### Requirement: A human comment's severity comes from its mark

The prompt SHALL tell the agent to give a finding of the reviewer `human` the severity `CRITICAL` when its comment is marked `blocking`, `SUGGESTION` when it is marked `nit` or `nitpick`, and `WARNING` otherwise, a Plannotator comment included.

#### Scenario: Blocking comment

- **WHEN** the human writes `issue (blocking): the retry never stops`
- **THEN** the finding is `CRITICAL`, at the floor

#### Scenario: Plain comment

- **WHEN** the human writes a comment with no Conventional Comments label
- **THEN** the finding is `WARNING`

### Requirement: The refutation of a human finding only advises

In a human round, the prompt SHALL tell the agent to show the human the refutation's outcome and its counter-evidence for each of their findings, and to keep or drop the finding as the human decides, never dismissing it silently.

#### Scenario: Refutation disagrees

- **WHEN** the refutation of a human finding finds no reproduction
- **THEN** the agent shows the human the counter-evidence and fixes the finding if the human keeps it

### Requirement: Human rounds repeat while the human sends feedback

The prompt SHALL tell the agent to start another human round while the human sends feedback, a "Send feedback" verdict in Plannotator or a word in the session, and to run the approval question only once the human says they have no more.

#### Scenario: Second round

- **WHEN** the human sends feedback after the first human round is published
- **THEN** the agent runs another human round before the approval question

#### Scenario: No more feedback

- **WHEN** the human says they have no more feedback
- **THEN** the agent goes on to the stage summary and persist mode

### Requirement: The walkthrough reaches an HITL human

For `HITL`, the prompt SHALL tell the agent to send the human, once the stage's round is published, the walkthrough publish mode wrote, through the Inbox as a guided review that asks for their verdict, passing the files' contents, not their paths, and piping the same fields to `plannotator inbox call submit_guide -` when they are too large for a tool call. Without a walkthrough, the human round SHALL run on GitHub only.

#### Scenario: Walkthrough written

- **WHEN** publish mode wrote a walkthrough for an `HITL` attempt
- **THEN** the prompt's instructions lead the agent to send it through the Inbox with a request for the human's verdict

#### Scenario: Patch too large for a tool call

- **WHEN** the walkthrough's patch is too large to pass in one tool call
- **THEN** the prompt's instructions lead the agent to build one JSON object with the guide, the patch and `review: true` and pipe it to `plannotator inbox call submit_guide -`

### Requirement: Code review commits

The prompt SHALL give the agent verification's commit rules: only the orchestrator commits; one commit per fixed finding, holding its fix and its reproduction test when it has one, staged by path, in the repository's conventions; each pushed before the next, with no amend, no force push and no skipped hooks.

#### Scenario: One commit per finding

- **WHEN** two findings survive and are fixed
- **THEN** the prompt's rules lead to two commits, one per finding, each pushed before the next

### Requirement: Code review follow-up tasks

The prompt SHALL tell the agent to propose a follow-up task for each deferred finding that survives the refutation. For `AFK` it SHALL create none and the finding is published as an open thread. For `HITL` it SHALL create those the human confirms, labelled at creation, related to the task and never its subtasks; the finding is published resolved, with the new task's URL.

#### Scenario: HITL follow-up created

- **WHEN** the human confirms a proposed follow-up task
- **THEN** one task is created, related to the task and not its subtask, and its URL reaches the record for publication

### Requirement: A new attempt resumes the code review

The prompt SHALL tell the agent to look, before the report, for what an earlier attempt left: the branch's commits since verification, the uncommitted changes, and the finding threads read at launch. Earlier commits stay; uncommitted changes are an unfinished fix, never discarded. The finding triage SHALL link each finding to the listed thread it continues, if any.

#### Scenario: Finding already published

- **WHEN** a second attempt's report holds a finding the first attempt published as fixed, and the fix did not hold
- **THEN** the prompt's instructions lead the agent to link the finding to that thread in the record, not to open another

### Requirement: The code review closing order

The prompt SHALL tell the agent to end the stage in this order: confirm the checks pass and every commit is pushed; run publish mode; for `HITL`, send the walkthrough and hold the human rounds; write `stage-summary.md` and run persist mode; run the transition, naming `code-review`; write `logbook-entry.md` and run log mode; write the result marker. It SHALL say that a command's end is not the end of the turn: the agent ends its turn only to wait for the human or after the marker.

#### Scenario: Commands named

- **WHEN** a code review prompt is written for attempt `linear:DOT-121:code-review:1`
- **THEN** it names `/autonomous:run --apply --publish linear:DOT-121:code-review:1`, `/autonomous:run --apply --persist linear:DOT-121:code-review:1`, `/autonomous:run --apply --transition linear:DOT-121 --from code-review` and `/autonomous:run --apply --log linear:DOT-121:code-review:1`, in that order, and does not name pull-request mode

#### Scenario: Answer left for later

- **WHEN** the human answers "Later" to the approval question
- **THEN** the prompt's order leaves the entry unpublished, the result marker unwritten and the session open

#### Scenario: Publish report is not the end of the turn

- **WHEN** an `HITL` session has run publish mode and relayed its report
- **THEN** the session goes on in the same turn to show the outcome and send the walkthrough, without an external prompt

#### Scenario: Publish mode fails

- **WHEN** publish mode exits 3 in an `AFK` attempt
- **THEN** the prompt tells the agent to follow the blocked path and to run no transition

### Requirement: The code review logbook section

The prompt SHALL tell the agent that the logbook entry adds a section `### Code review` naming the threads published by state, the fixed `SUGGESTION`s, the refuted and the dismissed findings, and a short rendering of the walkthrough, within the entry's word limit; when they do not fit, it gives counts and the stage summary lists them.

#### Scenario: Many findings

- **WHEN** a code review refuted or dismissed more findings than the entry's word limit allows to name
- **THEN** the prompt's instructions lead the agent to count them in the entry and to list them in the stage summary

### Requirement: Code review stage summary

The prompt SHALL tell the agent that the stage summary names the pull request's URL, the OpenSpec change, the commits, the review team's tier and skipped reviewers, each finding by outcome with its reason, the finding threads by link instead of their content, the proposed follow-up tasks, and any conflict with the base. Persist mode SHALL post it as for verification, with the header `autonomous · code-review · <attempt-id> · stage summary saved`.

#### Scenario: Comment header

- **WHEN** attempt `linear:DOT-121:code-review:1` is persisted
- **THEN** the task has a new comment whose first line is `autonomous · code-review · linear:DOT-121:code-review:1 · stage summary saved`, and its description is unchanged

### Requirement: The code review prompt follows the autonomy

For `AFK` the prompt SHALL tell the agent never to ask the human anything and to record its decisions and assumptions in the stage summary and the logbook entry. For `HITL` it SHALL tell the agent to show the human the finding triage before the refutation, and the outcome and the pull request before the human rounds.

#### Scenario: AFK task

- **WHEN** a code review prompt is written for a task carrying `AFK`
- **THEN** it forbids questions to the human, and has no human round and no review step

#### Scenario: HITL task

- **WHEN** a code review prompt is written for a task carrying `HITL`
- **THEN** it has the human review the finding triage before the refutation

### Requirement: A blocked AFK code review ends without a transition

For an `AFK` task, the prompt SHALL tell the agent what to do when it cannot finish: a fix rejected twice, a check that cannot pass, a fix that needs a human, or a publish mode that fails. It commits and pushes what is done, runs publish mode once if it has not failed, persists a stage summary that explains the blocker, publishes a logbook entry that says the attempt is blocked, and stops with no transition and no result marker.

#### Scenario: Fix rejected twice

- **WHEN** an `AFK` orchestrator's fix of a finding is rejected by two fix checks
- **THEN** the task keeps `code-review`, the accepted fixes are pushed, the finding is published as an open blocked thread, the task's tracker holds a comment explaining the blocker, and no result marker exists

### Requirement: The code review leaves the pull request a draft

The stage SHALL leave the task's pull request a draft. Neither the prompt nor any mode the stage runs SHALL mark it ready for review.

#### Scenario: Code review complete

- **WHEN** an attempt of the code review stage completes
- **THEN** the task's pull request is still a draft

### Requirement: Public repositories in the code review

The prompt SHALL forbid absolute paths and other details of the machine in the commits, `findings.json`, the stage summary, the logbook entry and any follow-up task, for every source, because the repository and its pull request may be public.

#### Scenario: Linear task

- **WHEN** a code review prompt is written for a Linear task
- **THEN** it holds the rule about absolute paths and machine details

### Requirement: Code review completion

The stage's completion check SHALL hold when the task carries `external-review` and no `code-review`. It SHALL also hold when the task is closed in its tracker.

#### Scenario: Transitioned

- **WHEN** the task carries `personal`, `HITL` and `external-review`
- **THEN** the check holds

#### Scenario: Transition not applied

- **WHEN** the task still carries `code-review`
- **THEN** the check does not hold

#### Scenario: Task closed

- **WHEN** the task was closed in its tracker
- **THEN** the check holds
