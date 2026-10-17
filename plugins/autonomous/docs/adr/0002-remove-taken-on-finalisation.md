# Remove taken when an attempt is finalised

The runner adds `taken` when it launches a managed session, so a second run or
another machine never selects the task while an agent advances it. We decided
that the runner also removes it, and only in three cases: when an attempt is
finalised (its stage completed and its session removed), when an attempt is
discarded, and when no session was ever created for it (the attempt is
aborted). This is the second exception to the loop's "never remove a label"
rule; the first is the transition of
[ADR 0001](0001-properties-persist-stages-replace.md).

## Considered Options

- **Never remove `taken`, as the loop never removes any other label.**
  Rejected: every task would be blocked forever after its first stage, because
  a task that carries `taken` is never a candidate.
- **Remove `taken` when the session exits.** Rejected: it loses the guarantee
  of the retained attempt. A session that exits without completing its stage
  must keep the task held until a person looks at it, and removing the label at
  exit would let the next run launch the same stage again over the failure.

## Consequences

- A retained attempt holds its task. It keeps `taken` until a person discards
  the attempt.
- A completed attempt whose session could not be removed keeps `taken` as a
  pending cleanup. Every later reconcile retries the removal, then removes the
  label.
- Triage and answers to triage questions stay additive. Only stage sessions
  remove labels, and the only label they remove is `taken`.
- A forgotten `taken` is removed by hand.
