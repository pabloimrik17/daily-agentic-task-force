# autonomous

The autonomous loop: it reads the work the user defined in Linear, Beads and
GitHub, checks it against the label contract, and launches one managed session per
attempt to advance a stage.

The split of today's `entry` group (`AFK`, `HITL`, `grill-me`) into autonomy
and stage labels, stage prompts and transitions are agreed but not implemented
yet (DOT-110, [ADR 0001](docs/adr/0001-properties-persist-stages-replace.md)).

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
occupies a runner slot. A tracker status such as "in progress" does not make a
task taken.
_Avoid_: claimed, locked

**Candidate**:
A work unit that every verifiable constraint permits now. Selection compares
candidates; it never chooses anything else.

**Subtask**:
A task whose tracker records another task as its parent. While any subtask is
open, its parent is never a candidate.

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

**Stage contract**:
What a stage declares: its id, its emoji, its prompt for a task, its agent
arguments and its completion check against the task's tracker. A stage can be
launched only when an implementation is registered for its id.

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
Where a task is in the process: `grill-me` or `proposal`. Every task has
exactly one, and each transition replaces it. A task whose autonomy is decided
starts at `proposal`, and a task in `grill-me` moves to `proposal` when the
grill ends.

**Taken label**:
`taken`: marks a taken task for as long as an agent or a person advances it.
The runner adds it when it launches a managed session and removes it when the
attempt is finalised or discarded, or when no session was ever created; a
retained attempt keeps it. It is neither a property nor a stage.
_Avoid_: lock

**Stage prompt**:
The instructions the runner gives the agent session it opens for a task's
stage. The runner writes them to a prompt file in the attempt's directory, and
the session's initial instruction tells the agent to read that file. The
`grill-me` prompt asks for a grill that ends with the ticket updated and shown
to the human.

**Transition**:
A task leaving its stage: its stage label is replaced and, when the stage
decided it, its autonomy label is set. It follows the human's answer to a
question at the end of the stage, and a script applies it.

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
invocation. A run has at most one round.

**Answer**:
The human's choice for one question, made only of that question's options. It
applies to that invocation and is never remembered.

**Answer mode**:
An invocation that applies answers and runs no step.
_Avoid_: re-run

**Unattended run**:
A run with no human present to answer, such as one driven by `/loop`. It
passes `--no-handoff`, so it carries no handoff.
