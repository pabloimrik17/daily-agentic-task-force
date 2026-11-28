# Review stages run on the draft before external review

The review stages run in a fixed order after the implementation: verification,
then code review, then QA. The task's pull request stays a draft through all
of them, and only the last one marks it ready for review, which is when the
review bots (CodeRabbit, Pullfrog) and the human reviewers start. Verification
goes first because it is the cheapest check and the most basic one: reviewing
the quality of code that is incomplete or misaligned with its proposal is
wasted work, and the code review then judges the fixes verification makes. QA
goes last of the three because it runs the code as it will be delivered, after
the code review has changed it.

## Considered Options

- **QA before code review.** Rejected: the code review's changes would reach
  the pull request without anyone having run them as the end user would.
- **Mark the pull request ready after the implementation**, so the bots review
  while the review stages run. Rejected: the bots only review a pull request
  that is not a draft, and they would comment on code the review stages are
  still changing, so the same finding would arrive twice, from two circuits.

## Consequences

- External review sees only code that has passed every review stage, and its
  fixes are the only ones no review stage has judged.
- Until QA exists, a task leaves `code-review` straight for `external-review`.
  The transition that reaches `external-review` marks the pull request ready
  for review, and external review takes it from there
  ([ADR 0009](0009-external-review-runs-as-bounded-rounds-outside-the-wait.md)).
