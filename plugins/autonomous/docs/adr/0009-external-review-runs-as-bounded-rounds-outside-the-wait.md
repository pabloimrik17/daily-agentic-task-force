# External review runs as bounded rounds, with the wait outside the session

External review handles what the review bots report in review rounds, one per
attempt, and no session is open while the bots work. The transition that
reaches `external-review` marks the pull request ready for review, whichever
stage it leaves, and the loop launches an attempt only once every review bot
has reported on the head commit, will not review it, or has let its wait run
out, and the pull request's checks have ended. A round pushes all of its fixes
in one push and answers every review bot's thread it accounts for, without
resolving any. Only a quiet round resolves those threads and ends with the
transition. At most three rounds push fixes: a task whose review bots still
bring findings that survive after the third stays in `external-review`,
blocked and announced. We chose this because a review bot takes from three
minutes to an hour to answer, each push spends one of its reviews, and its
next review is the only judgement the fixes of this stage ever get
([ADR 0007](0007-review-stages-run-on-the-draft-before-external-review.md)).

## Considered Options

- **The stage's session marks the pull request ready and waits for the bots.**
  Rejected: it would hold a work slot for up to an hour doing nothing.
- **The code review marks the pull request ready.** Rejected: the marking
  would move again when QA takes its place before external review. The
  transition into `external-review` does it for any stage it leaves.
- **One round that always ends with the transition.** Rejected: nothing would
  judge the fixes of that round, and what the bots say about them would reach
  wrap-up unhandled.
- **A push per fix, or rounds with no limit.** Rejected: every push starts a
  review of each bot, some of them on a monthly quota, and a bot that always
  finds something would never let the task leave.
- **Resolve a thread as soon as its finding is fixed or refuted.** Rejected:
  the bot must be able to contest the answer before the thread closes.
  CodeRabbit and Pullfrog resolve their own threads after a fixing push;
  Greptile never does, so the quiet round resolves what is left.
- **Send a task whose checks fail back to `code-review`.** Rejected: it would
  run a whole review team for a failed check, and it would be the first
  transition that goes back. A guard on the transition into `external-review`
  refuses a pull request whose checks have not passed, and a check that fails
  after a push of this stage is a finding of its next round.

## Consequences

- A task in `external-review` waits with no attempt between rounds, so the
  run's report, not a session, is where its wait shows.
- The number of a round is not the number of its attempt: a discarded attempt
  raises the second and not the first. Rounds are counted from the pushes of
  fixes external review has made on the pull request.
- A review bot that leaves no trace when its quota is spent, as Greptile does,
  is told apart only by its wait running out, so every round waits that long
  while it stays in the list of expected review bots.
- Until its quiet round, a pull request in external review shows open threads
  that are already answered. The answer, not the thread's state, says so.
