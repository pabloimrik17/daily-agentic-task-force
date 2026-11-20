# An AFK task leaves proposal preparation and the implementation without an answer

Until now every transition followed a human's answer to a question at the end
of the stage. Proposal preparation is the first stage an agent can finish
alone, and the implementation the second. We decided that the autonomy label
decides whether their transitions, from `proposal` to `implement` and from
`implement` to `verify`, wait for a person. An `AFK` task moves on as soon as
the stage's work is committed in its draft pull request, without a question. An
`HITL` task moves on only when the human answers `Approve`; `Later` leaves it in
its stage with its session open. This is a first reading of what autonomy means
for a stage, and later stages may refine it.

## Considered Options

- **Always ask the human, whatever the autonomy.** Rejected: `AFK` says an
  agent may advance the task without a human, and a question at the end of
  every stage would make every task `HITL` in practice.
- **Never ask, and let the human review the work in the pull request
  afterwards.** Rejected: `HITL` says a human intervenes during or at the end
  of each stage, and a task would reach `implement` before anyone approved its
  proposal, or `verify` before anyone saw its implementation.

## Consequences

- A transition is no longer always a human's decision. The answer still
  decides the transition out of the grill, and out of proposal preparation and
  the implementation for an `HITL` task.
- The `AFK` agent asks nothing during the stage either. Where the definition or
  the proposal leaves a gap, it chooses and records the assumption in the
  change's design and in its logbook entry, so the human can review it in the
  pull request.
- The draft pull request is where an `AFK` proposal or implementation is
  reviewed, after the task has already moved on.
- With no human to stop it, leaving `implement` is guarded in code, not only by
  the prompt: transition mode and the transition answer refuse a task whose
  change has an unchecked task, whose workspace has uncommitted changes or
  whose branch has unpushed commits. The guards run for an `HITL` task too,
  before the human is asked to approve.
- An `AFK` implementation that holds a task needing a human, such as a real
  write to a tracker, cannot reach `verify` on its own: the agent leaves that
  task unchecked and ends blocked, and a human finishes it.
