# Findings live in pull request threads

A review stage publishes each finding that survives its refutation as a
finding thread on the task's pull request, and that thread is the only place
that holds the finding's state. An open thread means someone must act on it
before the merge; a resolved thread means it is accounted for, with a reply
saying how: fixed in a commit, deferred to a follow-up task, or done by the
later stage it was passed on to. A stage passes work it finds outside its own
scope on to a later stage the same way, through an open thread addressed to
that stage, which reads the threads addressed to it as findings and resolves
them. We chose the pull request because it is where the human, the review
bots and every later stage already look, and because the repository's rule
that every review thread be resolved before the merge turns pending work into
a merge block with no machinery of ours.

## Considered Options

- **Track findings in tuicr or Plannotator as well.** Rejected as trackers:
  neither knows a resolved state, tuicr has no severity or blocking flag and
  needs a session the TUI created, and Plannotator holds its annotations only
  while a review is open. Several trackers would drift apart. They stay views:
  the walkthrough shows each finding as a note, and tuicr may import the open
  threads.
- **Keep passed-on findings only under stage-summary headings**, as
  verification does today. Rejected as the lasting channel: a heading is
  read once by the next stage, carries no state, and cannot block the merge
  when the stage it names does not exist yet.
- **Publish every reported finding.** Rejected: an unrefuted finding is noise
  on the pull request and would reach external reviewers before anyone judged
  it.

## Consequences

- Fixed findings are published already resolved, so the pull request shows
  what was found and fixed at its place without asking anyone to close it.
- A finding passed on to a stage that does not exist yet keeps its thread
  open, and the merge waits for a person to resolve it.
- Each comment carries hidden markers (`autonomous:finding`, `doubt`,
  `resolution`, `review`, versioned) so that a re-attempt never publishes a
  thread twice and a later stage finds the threads addressed to it. Changing
  that format means migrating threads already on open pull requests.
- The comments are posted with the user's own account, so the markers and
  the folded trace, not the author, tell the agents' comments from the
  human's.
