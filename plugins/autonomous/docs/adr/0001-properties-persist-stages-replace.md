# Label properties persist, stages replace

The original entry group mixed two kinds of label: `AFK` and `HITL` say how a
human takes part in a task, while `grill-me` says where the task is in the
process. We decided that a task's properties persist and its stage is
replaced. Scope (`work` or `personal`) and autonomy (`AFK` or `HITL`) are kept
for the whole life of a task. The stage label (`grill-me`, `proposal`, later
lifecycle labels) is exactly one at a time, and each transition replaces it.
Autonomy may be absent only while the task is in `grill-me`, because the grill
is where it is decided. Tasks carrying `HITL` and `grill-me` stay valid: their
autonomy was decided ahead of the grill.

## Considered Options

- **Keep every label and read the current state through precedence rules**
  (`grill-me` beats `HITL`, "in review" beats "proposal written"). Rejected:
  the rules grow with every stage label, the current stage becomes ambiguous,
  and it already failed for `grill-me`, which blocks the task for as long as it
  stays, so it has to be removed to move on.
- **Replace every label, keeping only what is relevant now.** Rejected: an
  autonomy decided before the grill would be lost or need another place.

## Consequences

- The loop's "never remove a label" rule gains one exception. A transition
  applied from a human's answer may remove the stage it leaves and the autonomy
  the answer replaces. Triage and answers to triage questions stay additive.
- The history of stages lives in each tracker's own activity log, not in
  labels.
- `proposal` enters the contract before any stage runs, revisiting "lifecycle
  labels wait for the step that uses them" (DOT-101), because the grill needs
  a stage to end in.
- Colours follow the same split. Properties keep their colours, and stages
  follow a progression: warm while a human is needed before starting, moving
  towards green as the task nears completion.
- Implemented in DOT-110, not in the change that introduced this ADR (DOT-104).
