## Context

See proposal.md, "Why". The current state that shapes the approach:

- **The contract.** `label-contract/contract.ts` declares the stage labels once (`grill-me` … `code-review`); colours, meanings, detection, triage, the label-at-creation text and the bootstrap derive from that list. `STAGE_ORDER` follows it.
- **Selection.** `select/stage.ts` holds `SUPPORTED_STAGES = ["grill-me", "proposal", "implement", "verify"]`; `splitByStage` keeps the most advanced supported stage.
- **The verification stage** (`stages/verify/`) already does almost everything this stage needs, through the shared pieces of `stages/openspec-stage.ts`: `openspecChecks` (which accepts an empty workflow map), `changeCheck`, the orchestration, commits, closing, summary, blocked and constraints sections, `afkTransition`/`hitlTransition`, and the plugin skill loader `stages/plugin-skill.ts`.
- **The review team** (`src/review-team/`, `skills/review-team/`) plans, runs and collects a report into a directory the caller names, with the walkthrough's draft guide (`walkthrough.json`) validated by `review-team/guide.ts` against a patch. Its skill's commands name `${CLAUDE_PLUGIN_ROOT}`, which only a skill invocation resolves.
- **The transition** (`transition/mode.ts`) keys its rows by the stage they leave; `receipt.ts` names what each stage persists; `guards.ts` checks the work left in the workspace for `implement` and `verify`.
- **GitHub.** `pull-request/github.ts` runs `gh` and `git` through `Exec`; it reads and writes pull requests and plain comments, and has no GraphQL call yet. Review threads, file-level comments, replies and resolutions exist only in GitHub's GraphQL API.
- **Modes.** Persist, pull-request and log modes each take an attempt id, run no step, take no run lock, write a receipt in the attempt's directory and print a versioned report; `args.ts` and `run.ts` dispatch them.

## Goals / Non-Goals

**Goals:**

- Register the stage with no special case in reconcile or launch, as verification was.
- Put everything code can decide in code (code → Jev → LLM): what is published, its format, its anchors, its state, idempotency and the walkthrough's update. The agent decides only what needs judgement: the triage, the links between findings and threads, and the severity of a human comment.
- Share verification's prompt pieces instead of copying them.
- Guarantee in code that a task leaves `code-review` only with its work pushed and its record published.

**Non-Goals:**

- Publishing for verification (DOT-161): publish mode accepts only `code-review` attempts, but its record and format carry nothing specific to code review, so verification can adopt them later.
- Reading or answering threads that belong to bots or to the human outside a human round.
- Checking in code what the teammates did: the fix checks and the repository's checks do that.

## Decisions

### D1. `external-review` is one more entry in the contract's stage list

Adding `external-review` to `STAGE_LABELS`, `COLOURS` and `MEANINGS` covers detection, triage, label-at-creation's text and the bootstrap. `STAGE_IDS` and `SUPPORTED_STAGES` gain `code-review`, not `external-review`, so a task in `external-review` is never a candidate. The colour `#8b5e3c`, a brown, is the hue left far from every other: blues, violets, reds, oranges, yellows, cyans, magentas, limes, greens and the grey are taken.

### D2. The stage lives in `stages/code-review/` and reuses verification's pieces

`stages/code-review/stage.ts` holds the contract (id `code-review`, emoji 🧐, `--model opus --effort high`, prerequisites, completion) and `prompt.ts` the prompt. The prerequisites are `openspecChecks({ stage: "code-review", workflows: {}, pullRequest: "required" })`, `changeCheck`, the two skill bodies and the threads read at launch. Sections verification also needs come from `stages/openspec-stage.ts`; anything that both prompts would phrase the same way and that still lives in `stages/verify/prompt.ts` moves there, with verification's text unchanged and guarded by its tests.

*Alternative:* derive the code review stage from the verification stage by parameters. Rejected: the two prompts share pieces but not their structure (the review team, publishing, the human round), and a parametrised verification prompt would hide that.

### D3. The skill loader resolves the plugin root

`loadPluginSkill` gains an option that replaces `${CLAUDE_PLUGIN_ROOT}` in the body with the plugin's own directory, the one it already reads from. The review team's commands then run the runner's code, as the adversarial review's body is the runner's (verification's design D3). The prompt is local to the attempt's directory, so the absolute path in it breaks no public-repository rule.

*Alternative:* tell the agent to invoke `/autonomous:review-team`. Rejected: it would run the installed copy, not the run's version, and a run from a branch (the end-to-end checks) would review with the wrong code.

### D4. The prompt supplies the adversarial review's parameters and the review team's options

Right before the two skill bodies, the prompt's own section supplies: the subject (the pull request's diff from its merge base), the references (the definition and the proposal, for the triage and the refutation only), the report's procedure (the review team, planned with `--dir <attempt>/review`, no `--tier`), the floor `CRITICAL`, QA as the only later review, the record `findings.json`, whether a human follows, and for `HITL` the human rounds with `human` as the reporter the refutation only advises on. The review team's own step 5, the summary in the chat, is replaced by the triage.

### D5. The adversarial review skill gains two optional parameters

"What the caller supplies" adds human rounds and reporters whose findings the refutation only advises on. "The phases" keeps one round unless the caller adds human rounds. "The refutation" lets a named reporter decide whether their finding survives, and a fix of a finding with no reproduction is checked against its statement. Verification supplies neither, so its behaviour is unchanged.

*Alternative:* state the human round's exceptions in the stage prompt only. Rejected: the inlined skill says that a finding with no reproduction does not survive, and a prompt that contradicts the skill it inlines leaves the agent to choose.

### D6. Publishing is a mode: `/autonomous:run --apply --publish <attempt-id>`

A new module `src/publish/` reads and validates `findings.json`, reads the pull request's threads, decides what to post, posts it, reads it back and writes `published.json`. `args.ts` and `run.ts` add the flag as they added `--log`. It takes no run lock, as persist and log modes, because it touches no attempt record.

*Alternative:* the agent posts with `gh api`, following the prompt. Rejected in the grill: the format, the anchors and the idempotency could not be tested, and a format change means migrating threads on open pull requests (ADR 0008).

### D7. The record is `findings.json`, schema `autonomous.findings.v1`

One entry per finding or doubt of every round: `id` (unique in the attempt), `round`, `kind` (`finding` or `doubt`), `reporters` (reviewer and its reported ids: a review team reviewer, `verification` or `human`), `title`, `statement`, `location` (the review team's `Location` shape), `severity` and `label` (findings), `destination` (`fix`, `pass-on`, `defer`, `dismiss`, or `settled` / `ask` / `publish` for a doubt) and `reason`, `refutation` (`survived`, `refuted`, `not-refuted` for a pass-on or a dismissal) with its `reproduction`, and `publication`: `fixed` with its commit, `deferred` with a follow-up URL or a proposed title, `passed-on` with its stage, `blocked` with its reason, `asked` for a doubt the human answered, or `none`. `thread` names the thread it continues. The validator lives in `src/publish/record.ts`, with the repository's `validate.ts` helpers, and reuses the review team's `Location` check so a path outside the repository is refused.

*Alternative:* keep verification's `findings.md` and parse it. Rejected: prose cannot be validated, and publish mode must refuse a record it cannot trust before it posts anything.

### D8. Threads go through GitHub's GraphQL API

The port gains `threads(number)` (every review thread with its id, path, line, side, subject type, resolution and comments with their bodies and ids), `review(number, body, threads)`, `reply(thread, body)`, `resolve(thread)` and `unresolve(thread)`. `review` creates a pending review (`addPullRequestReview`), adds each thread (`addPullRequestReviewThread`, with `subjectType: FILE` for a file-level anchor) and submits it with the event `COMMENT` (`submitPullRequestReview`). Each call is one `gh api graphql` through the port's `Exec`, so tests run on fakes as for the other modes. The posts run one at a time.

### D9. Anchoring: line, file, the change's proposal, review body

Publish mode computes the final diff (`git diff <merge-base>...HEAD` in the workspace, with fixed prefixes, as the walkthrough's patch) and anchors a finding to its line when one hunk holds it on that side, else to its file at file level when the diff changes it, else to `openspec/changes/<change>/proposal.md` at file level, which every pull request of an OpenSpec stage adds, else in the review's body. The third step keeps a whole-change finding in a thread, which can be open and so block the merge (ADR 0008); a finding in the body cannot.

### D10. Markers and identity

Each first comment ends with `<!-- autonomous:finding v1 attempt=<id> finding=<id> [for=<stage>] -->` (or `doubt`); each state reply with `<!-- autonomous:resolution v1 attempt=<id> finding=<id> state=<state> -->`; each review body with `<!-- autonomous:review v1 attempt=<id> round=<n> -->`. Within an attempt, publish mode skips a finding whose marker for the attempt is already on the pull request, and a reply whose state is already the thread's last; a run cut short is completed by the next run, with no second review. Across attempts, the triage links findings to threads (the prompt lists the threads read at launch, parsed from their markers), and publish mode turns an unlinked finding whose anchor and normalised title match a code review thread exactly into a reply in it, reporting the match.

What code guarantees: no thread twice within an attempt, and none for an exact match across attempts; a finding a later attempt words differently, at lines a fix moved, depends on the triage's link. Matching by meaning in code was rejected in the grill as fragile, and the triage is the phase that merges findings. The definition's acceptance criterion was narrowed to this on 2026-11-25, with the user's approval.

### D11. One review per round, with a three-line index

A run posts one review per round whose new threads it publishes, normally the round just ended, under a body of three lines: the stage and round, the counts by state, and the review team's tier with its skipped reviewers. Replies and resolutions open no review, since each belongs to an existing thread.

### D12. The comment format

```text
issue (blocking): The retry loop never stops when the token is revoked.

Status: fixed in abc1234
<details><summary>Trace</summary>

Reported by code-review, codex · CRITICAL · reproduction: test/retry.test.ts "stops on revoked token" · Claude Code 2.1.330, codex 0.171.0
</details>
<!-- autonomous:finding v1 attempt=linear:DOT-121:code-review:1 finding=f3 -->
```

Status lines: `fixed in <commit>`, `deferred to <URL>`, `deferred: follow-up proposed, "<title>"`, `passed on to QA #qa`, `blocked: <reason>`, `open question`. Labels: `issue` for a finding the review team labelled so, `suggestion` for one labelled so, `question` for a doubt; `(blocking)` for `CRITICAL` and for a doubt. English throughout; references are full URLs.

### D13. Publish receipt and the transition's check

`published.json` holds the attempt id, the pull request, the SHA-256 digest of the `findings.json` bytes it published, the walkthrough's digest when it saved one, and the time. `transition/receipt.ts` gains a second awaited receipt for `code-review`: the transition refuses an open attempt whose `published.json` is missing or names another digest, so a human round whose findings were not published cannot be approved. The persistence receipt and `guardsOnLeaving` (the three checks of `verify`) run as for verification.

### D14. The walkthrough is updated in code

Publish mode reads the review team's draft from `<attempt>/review/walkthrough.json`, places every file of the final diff the draft does not place in a trailing section "Code review fixes", adds one note per published finding whose line one hunk holds (label, statement, state, thread URL), and adds the others to their section's overview. It validates the result with `review-team/guide.ts` against the final patch, saves it with `plannotator guide import --guide <file> --patch <file> --pr <url>` when its digest differs from the last saved one, and writes `walkthrough.json`, `walkthrough.patch` and `walkthrough.md` (title, intent, section titles with their finding counts) in the attempt's directory. Any failure leaves no walkthrough, never a failed publish.

*Alternative:* a fresh walkthrough teammate rewrites the guide. Rejected in the grill: code does it deterministically and cheaply, and the draft's prose still describes the change.

### D15. The human round runs in the session, publish mode closes it

The agent reads the human's GitHub comments (no marker of a stage, posted after the last publish) and the Plannotator verdict the Inbox returns, turns each comment into a record entry of the reviewer `human` with its severity from its mark, links a GitHub comment's entry to its thread, and runs the round. Publish mode answers and resolves the linked threads and opens threads for Plannotator comments. The session sends the walkthrough with the Inbox's `submit_guide` with `review: true` when it has that tool; without it, or without a walkthrough, the round runs on GitHub only.

### D16. The logbook stays within its limit

The `### Code review` section names threads by state, fixed suggestions, refuted and dismissed findings by title, and pastes `walkthrough.md`. When that exceeds log mode's 300 words, the entry gives counts and the stage summary, which has no limit, lists them. Log mode is unchanged.

*Alternative:* leave folded blocks out of log mode's word count. Rejected for now: it widens a rule every stage relies on, for one stage whose full list already lives in the stage summary and in `findings.json`.

### D17. The transition table gains a row

`TRANSITIONS` gains `"code-review": { to: "external-review", asks: "approval" }`, and `READY` says "the code review is ready". `receipt.ts` gains `code-review: "stage summary"`. ADR 0004 is widened to the fourth transition without an answer, and ADR 0007's consequence that a task stops at `code-review` now names `external-review`.

### D18. Persist mode gains a plan for `code-review`

The plan is verification's: the stage summary only, no description change, header `autonomous · code-review · <attempt-id> · stage summary saved`.

## Risks / Trade-offs

- [The human keeps a pending review on the pull request with the same account, and GitHub allows one pending review per user] → Publish mode fails with a reason naming the pending review, before it posts anything; the agent asks the human to submit it, and the transition waits for the receipt.
- [Many threads trip GitHub's secondary rate limits] → Posts run one at a time; a failed post stops the run, and the next run continues from the markers without duplicates.
- [A reworded duplicate across attempts] → The triage sees every earlier thread at launch, the exact-match backstop catches the common case, and the residue is accepted (D10).
- [A review team run at tier `L` costs several dollars and up to 14 minutes] → Accepted: the calibration set the team for that, and a retained attempt never runs again by itself.
- [The review team misses prose defects until DOT-167] → Accepted in the grill; DOT-167 adds a reviewer with no change to the stage.
- [GitHub's GraphQL review API changes] → Every call goes through the port, whose tests pin the queries.
- [A walkthrough note cannot sit across hunks] → A finding with no single hunk goes to its section's overview instead (D14).

## Migration Plan

1. Release as a `feat(autonomous):` minor; no configuration change.
2. Before installing it, stop the loop (`/autonomous:loop-stop`). A task that already carries `code-review`, DOT-121 today, becomes a candidate once the stage exists, ahead of every other stage, and a running loop would launch it at once.
3. Run `/autonomous:run --bootstrap-labels` once per tracker, so `external-review` exists before the first transition out of `code-review`.
4. Accept the change with one real `HITL` run on DOT-121, launched by hand from this branch after the user's go-ahead.

Rollback: revert the release, but first relabel by hand every task already in `external-review`: an older version sees it as missing a stage and its label triage would derive `proposal`. An older release cannot read `code-review` attempt records either, so first finish or discard every `code-review` attempt and move each `attempts/<source>/<task>/code-review/` directory out of the state directory. Threads already published stay on their pull requests and need nothing.
