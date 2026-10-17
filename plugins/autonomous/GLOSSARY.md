# autonomous

The autonomous loop: it reads the work the user defined in Linear, Beads and
GitHub, checks it against the label contract, and will eventually delegate it
to agents.

The split of today's `entry` group (`AFK`, `HITL`, `grill-me`) into autonomy
and stage labels, stage prompts and transitions are agreed but not implemented
yet (DOT-110, [ADR 0001](docs/adr/0001-properties-persist-stages-replace.md)).

## Language

### Progress

**Stage**:
One stage of advancing a task, performed by a fresh agent in a single session,
such as the grill or proposal preparation.
_Avoid_: step

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

### Labels

**Autonomy label**:
`AFK` or `HITL`: how a human takes part in a task. It is a property, kept for
the whole life of the task.
_Avoid_: participation mode

**Stage label**:
Where a task is in the process: `grill-me` or `proposal`. Every task has
exactly one, and each transition replaces it. A task whose autonomy is decided
starts at `proposal`, and a task in `grill-me` moves to `proposal` when the
grill ends.

**Taken label**:
`taken`: marks a taken task for as long as an agent or a person advances it,
and is removed when they stop. It is neither a property nor a stage.
_Avoid_: lock

**Stage prompt**:
The instructions the runner gives the agent session it opens for a task's
stage. The `grill-me` prompt asks for a grill that ends with the ticket updated
and shown to the human.

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
