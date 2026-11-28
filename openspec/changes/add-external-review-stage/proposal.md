# Proposal

## Why

A task that passes the code review stops at `external-review` with its pull request still a draft, and a person marks it ready, waits for CodeRabbit, Greptile and Pullfrog, judges what they report, fixes it, answers their threads and resolves them by hand. That is the last manual stretch between the review stages and the merge, and it is the one where a work slot would be wasted most if a session did the waiting. DOT-157 adds the stage that does it, as decided in its grill and recorded in ADR 0009.

## What Changes

- **The transition that reaches `external-review` marks the pull request ready for review**, before it replaces the stage label, whichever stage it leaves. It refuses a pull request whose head commit has a failed check.
- **Review bots become a configured list** (`review.external`, optional, with shipped defaults: CodeRabbit, Greptile, Pullfrog). For the head commit of a pull request each one is classified from its check run as reported, reviewing or not reviewing; a bot that leaves no check run is not reviewing once its wait (30 minutes) runs out.
- **A task in `external-review` waits with no session.** Work selection excludes it while a review bot is reviewing or within its wait, while a check of the pull request has not ended, or while the answers of a round that pushed nothing are within their wait (10 minutes). The run's report shows the wait and each bot's state. A draft pull request found there is marked ready.
- **A new stage, `external-review`**, registered and supported. Each attempt runs one review round of the adversarial review whose report is deterministic: the review bots' open threads and review bodies, the failed checks (reviewer `ci`), the human reviewers' comments (reviewer `human`, advisory) and the open finding threads addressed to external review. It deduplicates against the code review's decisions (its finding threads and its stage summary), pushes all the fixes of the round in one push, and answers every thread it accounts for without resolving it.
- **Rounds are bounded.** A round that pushed fixes or answered a thread ends without a transition, and the loop launches the next one when the bots have reported again. At most three rounds push fixes (`review.external.rounds`); after that a round that still has a surviving finding blocks, announced, with no further push.
- **The quiet round ends the stage.** When no review bot brings a new finding or contests an answer and the checks pass, the round resolves the threads external review answered, dismisses a review bot's request for changes, asks the approval of an `HITL` task, and moves the task to `wrap-up`.
- **Publish mode works for external review attempts**: it holds threads open until the quiet round, and resolves and dismisses in it.
- **A round that ends without a transition completes its attempt** through a second result marker outcome, `round-ended`, so the attempt is finalised and its slot freed instead of being retained.
- Persist mode, the transition table, the approval question and the guards gain `external-review`; the sixth transition is `external-review → wrap-up`.
- Documentation: the README's stage sections, `commands/run.md`, the glossary (already updated in the grill: External review, Review bot, Quiet round, Review round, Stage label), ADR 0009 (written in the grill) and the amended consequence of ADR 0007.

Not in this change: the wrap-up stage, the open finding threads no stage owns (wrap-up's), QA, mentioning CodeRabbit or Greptile by default, chasing Greptile's confidence score, and invoking the `autofix`, `greploop` or `check-pr` skills.

## Capabilities

### New Capabilities

- `review-bots`: the configured review bots, how each is classified for a head commit, the wait of a task in `external-review`, and the deterministic report built from what the bots, the checks and the human reviewers left on a pull request.
- `external-review-stage`: the stage itself: its prerequisites, its prompt, the round it runs, how a round ends, the quiet round, the round limit and its completion.

### Modified Capabilities

- `autonomous-run`: transition mode, answers and the approval question gain the transition out of `external-review`; the transition into `external-review` marks the pull request ready and is guarded by the checks; leaving `external-review` is guarded; persist and publish modes accept `external-review` attempts.
- `label-contract`: a sixth transition and the autonomy rule for leaving `external-review`.
- `work-selection`: `external-review` is a supported stage, the most advanced one, and a task waiting for its review bots is excluded with that reason.
- `finding-threads`: an external review answers threads without resolving them, the quiet round resolves them and dismisses a review bot's request for changes, and the threads external review may touch.
- `stage-sessions`: a result marker may report `round-ended`, with its own proofs.
- `code-review-stage`: the stage still leaves the pull request a draft; the transition it ends with is what marks it ready.

## Impact

- **Code** (`plugins/autonomous/src`): new `review-bots/` (configuration, classification, wait, report) and `stages/external-review/`; changes in `pull-request/` (ready, check runs, reviews, dismissal, timeline), `transition/` (table, guards, apply), `select/` (stage support, the wait exclusion), `publish/` (hold, quiet round), `persist/`, `attempts/` (result marker, reconcile), `config.ts`, `config.defaults.json` and `config.example.json`.
- **Docs**: README, `commands/run.md`, `GLOSSARY.md`, `docs/adr/0007-…`, `docs/adr/0009-…`.
- **Runtime dependencies**: `gh` (REST check runs and reviews, GraphQL threads and timeline). No new package.
- **GitHub**: the runner now marks pull requests ready for review, replies in and resolves threads it did not open (review bots', human reviewers'), and dismisses a review bot's review, all with the user's `gh` account.
- **Trackers**: `wrap-up` must exist before the first quiet round (it is in the contract since DOT-171; bootstrap adds it where missing). Tasks already in `external-review` with a draft pull request are marked ready by the first run.
- **Quota**: every push of the stage starts a review of each bot; the single push per round and the round limit bound it.
