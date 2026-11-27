# autonomous

The autonomous loop: it reads the work the user defined in Linear, Beads and
GitHub, checks it against the label contract, and launches one managed session per
attempt to advance a stage.

Labels come in three groups: scope, autonomy and stage. Scope and autonomy are
properties that persist, and each transition replaces the stage
([ADR 0001](docs/adr/0001-properties-persist-stages-replace.md)). The grill,
proposal preparation, the implementation, the verification and the code review
run as stages (see the README's [grill-me stage](README.md#the-grill-me-stage),
[proposal stage](README.md#the-proposal-stage),
[implementation stage](README.md#the-implementation-stage),
[verification stage](README.md#the-verification-stage) and
[code review stage](README.md#the-code-review-stage)).

## Language

### Progress

**Task**:
A piece of work recorded in its tracker, carrying its current definition and
the references needed to continue it.
_Avoid_: ticket, issue

**Stage**:
One stage of advancing a task, performed by a fresh agent in a single session,
such as the grill or proposal preparation.
_Avoid_: step

**Grill**:
The stage that refines a task with the human before proposal preparation. It
ends with a confirmed definition and a decided autonomy.
_Avoid_: refinement

**Proposal preparation**:
The stage that turns a task's definition into a proposal. It ends with the
proposal committed on the task's branch, in a draft pull request, and the task
ready to implement.
_Avoid_: propose stage, proposal stage

**Implementation**:
The stage that turns a task's approved proposal into code. It ends with every
task of the proposal done, committed on the task's branch, and the task ready
to verify.
_Avoid_: apply, implement stage

**Verification**:
The stage that checks a task's implementation against its proposal, and
against the acceptance criteria and non-goals of its definition, and corrects
what does not match. It ends with every finding it chose to fix fixed,
committed on the task's branch, and the task ready for code review.
_Avoid_: review, code review

**Code review**:
The review stage that judges the quality of the code a task's implementation
changed, not its match with the proposal, through a review team, before
anyone outside sees the pull request. It publishes what survives as finding
threads on the pull request (see the README's
[code review stage](README.md#the-code-review-stage)).
_Avoid_: review, verification, external review, self review

**QA**:
The stage that runs what a task delivers, when it can be run, as its end user
would, to see that it works. It does not exist yet.
_Avoid_: acceptance, testing, end-to-end

**Review stage**:
A stage that judges what a task's implementation produced, each from its own
angle: verification, code review and QA.

**External review**:
The stage that follows every review stage: it opens a task's pull request to
the review bots and the human reviewers, waits for what the bots report and
handles it through an adversarial review. It is not a review stage, since it
judges what others found, not the work from its own angle. It does not exist
yet.
_Avoid_: bot review, pull request review, code review

**Wrap-up**:
The stage that follows external review and precedes the merge. It does not
exist yet.

**Adversarial review**:
The way a review stage, or any other review, handles what it finds: a
reviewer reports findings, the orchestrator triages them, other teammates try
to refute each one it keeps, others fix those that survive, and others judge
each fix. Nobody judges their own work. Its
phases are the report, the finding triage, the refutation, the fix and the fix
check (see the README's
[adversarial review](README.md#the-adversarial-review)).

**Review round**:
One pass of an adversarial review through its phases, from one report to its
fix checks. A review stage runs one, and an `HITL` code review adds human
rounds after it.
_Avoid_: round (alone), pass, iteration

**Human round**:
A review round of an `HITL` code review whose report is the human's comments
on the pull request or on the walkthrough. Its refutation is advisory: the
human, not the refutation, decides whether a finding of theirs stands.
_Avoid_: feedback round, second review

**Finding triage**:
The phase of an adversarial review in which the orchestrator makes the
reported findings its own: it merges and splits them, and sends each one to be
fixed now, passed on to a later review, deferred to a follow-up task, or
dismissed. It never changes a finding's severity.
_Avoid_: triage (alone), ruling, routing

**Finding**:
One thing a review reports as wrong or missing, with the evidence for it.
_Avoid_: issue, problem

**Reviewer**:
Whoever reports findings on a subject from one angle, such as correctness,
security or structure: a teammate, a tool, a person, or an earlier stage that
passed them on. As a reviewer it only reports: it never triages, refutes or
fixes.
_Avoid_: agent, bot

**Review team**:
The reviewers one report brings together, each from its own angle, whose
findings are pooled into that report without being judged. Its review tier
decides which reviewers it takes.
See the README's [review team](README.md#the-review-team).
_Avoid_: panel, review squad

**Review tier**:
The size class of a change, S, M or L, measured from its diff, that decides
which reviewers its review team takes. A caller may raise it, never lower it.
_Avoid_: level, review size

**Doubt**:
Something a reviewer cannot judge without knowing the intent, when neither the
definition nor the proposal settles it. It is not a finding: it has no
reproduction, it is neither refuted nor fixed, and only the human resolves it.
_Avoid_: question, open question

**Finding thread**:
The comment thread on a task's pull request where a published finding or
doubt lives. It is open while someone must act on it before the merge, and
resolved, with a reply saying how, once it is accounted for. It holds the
finding's state: every other place that shows the finding is a view of it
([ADR 0008](docs/adr/0008-findings-live-in-pull-request-threads.md)).
_Avoid_: review comment, inline comment

**Walkthrough**:
The explanation of a task's pull request for the human who reviews it: the
whole change at a glance, then a guided tour of its changes with each
published finding at its place. Its author is also a reviewer, of
comprehension: what it cannot explain, it reports.
_Avoid_: guide, explainer, tour

**Reproduction**:
The evidence that a finding holds: a test that fails because of it, or the
exact text the work contradicts or misses beside the place that does so.

**Follow-up task**:
A task proposed from a finding that is real but deferred: not for this task,
not now. It is related to the task it comes from, never its subtask.
_Avoid_: subtask, child task

**Proposal**:
The planning documents of a task, written before any code: what changes and
why, the design, the requirements it adds or changes, and the tasks to
implement it.
_Avoid_: change, spec, plan

**Definition**:
The confirmed description of a task: its objective, its non-goals, its
acceptance criteria, the decisions that shape it and its autonomy. A grill
produces it, and the task's tracker holds the current one.
_Avoid_: result, spec

**Non-goals**:
What a task's definition explicitly leaves out.
_Avoid_: scope, out of scope

**Stage summary**:
A comment a stage leaves on its task for the next agent, holding what the
definition does not: rejected options, open nuances and the skills to use.
_Avoid_: continuation note, handoff

**Logbook**:
The story of how a task's pull request came to be, told by the logbook
entries on it, in order: enough for a person to catch up on what happened
without reading the work itself.
_Avoid_: log, journal, history

**Cover**:
The description of a task's pull request, which opens its logbook: a link to
the task and the problem and solution of its definition, or the start of its
description when it has no definition.
_Avoid_: pull request body, summary

**Logbook entry**:
A comment an agent of a stage leaves on its task's pull request for the human
who reads it: what it did and what it decided. Unlike the stage summary, it
lives in the pull request and addresses a person, not the next agent.
_Avoid_: stage summary, report

**Split**:
The division of a task into subtasks during its grill, each with its own
definition and autonomy, while the parent keeps the overall definition.
_Avoid_: breakdown

**Work unit**:
A task together with its next stage.

**Step**:
One part of an `/autonomous:run` invocation, such as the quota gate or label
triage.
_Avoid_: stage, run step

### Selection

**Machine scope**:
The scope, `work` or `personal`, that a machine prefers when work is selected
on it. Work from the other scope is selected only as a visible, justified
exception.
_Avoid_: machine type, work-first

**Taken task**:
A task that carries the taken label: an agent or a person has declared that
they are advancing it. It is never a candidate, whether or not its session
occupies a slot. A tracker status such as "in progress" does not make a
task taken.
_Avoid_: claimed, locked

**Candidate**:
A work unit that every verifiable constraint permits now. Selection compares
candidates; it never chooses anything else.

**Subtask**:
A task whose tracker records another task as its parent. While any subtask is
open, its parent is never a candidate.

### Quota

**Claude account**:
A Claude subscription whose quota OpenUsage reports with usage data. The quota
gate evaluates exactly one per run: the active account.
_Avoid_: candidate, provider

**Active account**:
The Claude account that Claude Code is logged in as on this machine right now.
It can change at any moment, outside the run's control. It is the account the
quota gate evaluates.
_Avoid_: current account, default account, best account

**Quota source**:
The tool that reports each Claude account's quota. The quota gate reads only
this for usage data.
_Avoid_: usage provider, quota provider

**Account error**:
A failure of OpenUsage to refresh one Claude account. OpenUsage keeps that
account's last values, which go stale; while it stands, that account's data is
not fresh, and the other accounts' data is unaffected.

### Sessions

**Attempt**:
One launch of a managed session for one stage of one task, identified as
`<source>:<task>:<stage>:<n>`, where `n` counts the attempts of that task and
stage from 1. Its record lives in the local state directory, outside every
tracker and every workspace.
_Avoid_: session

**Managed session**:
A session of the session manager whose id is recorded in an attempt. The runner
acts only on managed sessions; a session made by hand is never touched, even
when it shares a workspace path with an attempt.

**Slot**:
The unit of capacity for managed sessions. Every open attempt occupies one,
whichever command launched it, until it is finalised or discarded; a session
made by hand occupies none. Only the loop is bound by the slot limits: a launch
a person asks for is never refused for capacity, and still occupies its slot
([ADR 0005](docs/adr/0005-slot-limits-bind-only-the-loop.md)).
_Avoid_: runner slot, seat

**Loop**:
The continuous mode of the runner: it repeats iterations at a fixed interval
until a person stops it. Only one loop runs at a time.
_Avoid_: watch, daemon

**Iteration**:
One pass of the loop: it brings the open attempts up to date and then launches
at most one session, into a free slot.
_Avoid_: tick, cycle

**Grill slot**:
A slot occupied by an attempt of the grill stage. Grill slots have their own
limit, so that tasks can keep being defined while the work slots are full.
_Avoid_: human slot

**Work slot**:
A slot occupied by an attempt of any stage other than the grill.

**Orchestrator**:
The agent of a stage session that shares the stage's work out among teammates
and is the only one that commits it: the implementation, the verification and
the code review each have one.
_Avoid_: main agent, lead

**Teammate**:
An agent the orchestrator starts within its session for one block of work,
with the model and effort that block needs. It never commits.
_Avoid_: subagent, worker

**Stage contract**:
What a stage declares: its id, its emoji, its prerequisites, its prompt for a
task, its agent arguments and its completion check against the task's tracker.
A stage can be launched only when an implementation is registered for its id
and its prerequisites hold; what they read at launch is passed to its prompt.

**Workspace**:
The git worktree of a task's repository, on the branch
`feature/<task id>-<slug>`. It is reused across attempts and stages, and the
runner removes it only when an attempt is discarded with `--release-workspace`.
It never deletes the branch.

**Result marker**:
The file `result.json` that the agent writes in the attempt's directory, with
the schema `autonomous.result.v1`, the attempt's id and the outcome
`completed`. It is valid only when it parses, names that attempt and reports
`completed`; any other marker counts as absent. It is one of the two proofs
that a stage completed, the other being the stage's own check against the
tracker.

**Retained attempt**:
A started attempt whose session exited, or is gone, without the stage having
completed. It keeps its session and the taken label, and no run retries,
relaunches or removes it. Every run lists it until a person discards it.
_Avoid_: failed attempt

**Pending cleanup**:
A completed attempt whose session could not be removed. The taken label stays
on the task, the stage does not run again for it, and every later reconcile
retries the removal and then removes the label.

**Run lock**:
The lock in the state directory that a run holds while it reads or writes
attempts, so that only one run at a time uses a state directory. A run that
finds it held by a live process is not evaluable. It has nothing to do with the
taken label.
_Avoid_: taken label

### Labels

**Scope label**:
`work` or `personal`: whose work a task is. It is a property, kept for the
whole life of the task.

**Autonomy label**:
`AFK` or `HITL`: how a human takes part in a task. It is a property, kept for
the whole life of the task, and provisional while the task is in its grill.
_Avoid_: participation mode

**Stage label**:
Where a task is in the process: `grill-me`, `proposal`, `implement`, `verify`,
`code-review`, `qa`, `external-review`, `wrap-up` or `ready-to-merge`. Every
task has exactly one, and each transition replaces it.
A task whose autonomy is decided starts at `proposal`, a task in `grill-me`
moves to `proposal` when the grill ends, a task in `proposal` moves to
`implement` when its proposal preparation ends, a task in `implement` moves to
`verify` when its implementation ends, and a task in `verify` moves to
`code-review` when its verification ends, and a task in `code-review` moves to
`external-review` when its code review ends. `external-review` means the task
waits for the review of the pull request's bots and reviewers; no stage runs
for it yet. `ready-to-merge` is a label with no stage: the task waits there for
a person to merge its pull request.

**Taken label**:
`taken`: marks a taken task for as long as an agent or a person advances it.
The runner adds it when it launches a managed session and removes it when the
attempt is finalised or discarded, or when no session was ever created; a
retained attempt keeps it. It is neither a property nor a stage.
_Avoid_: lock

**Triage label**:
`triage-me`: marks a task whose scope or autonomy could not be decided without
the human. While a task carries it, the task is not judged again and is never a
candidate. It is removed once the missing labels are on the task. Like the
taken label, it is neither a property nor a stage.
_Avoid_: undecided, needs-triage

**Stage prompt**:
The instructions the runner gives the agent session it opens for a task's
stage. The runner writes them to a prompt file in the attempt's directory, and
the session's initial instruction tells the agent to read that file. The
`grill-me` prompt asks for a grill that ends with the ticket updated and shown
to the human.

**Transition**:
A task leaving its stage: its stage label is replaced and, when the stage
decided it, its autonomy label is set. It follows the human's answer to a
question at the end of the stage, except when an `AFK` task leaves proposal
preparation, implementation, verification or code review, which needs no
answer. A script
applies it.

### Talking to the human

**Handoff**:
The part of a run report addressed to the agent that ran the command: what the
run asks that agent to do next. Its first and only kind today is questions for
the human.
_Avoid_: prompt, request

**Question**:
One item of a handoff: a decision put to the human, with its options, composed
entirely by the run.
_Avoid_: ask (as a noun)

**Left for the human**:
A label group a step could not decide and lists in its report for a human to
settle: an `asked` record, or a conflict between labels already on the task,
in the report data. Only some of these become questions.
_Avoid_: asked question, pending question

**Round**:
One asking of a handoff's questions, followed by at most one answer mode
invocation. A run has at most one round. It is not a review round.

**Answer**:
The human's choice for one question, made only of that question's options. It
applies to that invocation and is never remembered.

**Answer mode**:
An invocation that applies answers and runs no step.
_Avoid_: re-run

**Unattended run**:
A run with no human present to answer. The unattended way is the loop
(`/autonomous:loop`), whose iteration never carries a handoff. A run of
`/autonomous:run` can also be made unattended with `--no-handoff`.
