# An AFK task leaves proposal preparation without an answer

Until now every transition followed a human's answer to a question at the end
of the stage. Proposal preparation is the first stage an agent can finish
alone. We decided that the autonomy label decides whether its transition, from
`proposal` to `implement`, waits for a person. An `AFK` task moves on as soon
as its proposal is committed in its draft pull request, without a question. An
`HITL` task moves on only when the human answers `Approve`; `Later` leaves it
in `proposal` with its session open. This is a first reading of what autonomy
means for a stage, and later stages may refine it.

## Considered Options

- **Always ask the human, whatever the autonomy.** Rejected: `AFK` says an
  agent may advance the task without a human, and a question at the end of
  every stage would make every task `HITL` in practice.
- **Never ask, and let the human review the proposal in the pull request
  afterwards.** Rejected: `HITL` says a human intervenes during or at the end
  of each stage, and a task would reach `implement` before anyone approved its
  proposal.

## Consequences

- A transition is no longer always a human's decision. The answer still
  decides the transition out of the grill, and out of proposal preparation for
  an `HITL` task.
- The `AFK` agent asks nothing during the stage either. Where the definition
  leaves a gap, it chooses and records the assumption in the proposal and in
  its logbook entry, so the human can review it in the pull request.
- The draft pull request is where an `AFK` proposal is reviewed, after the
  task has already moved to `implement`.
