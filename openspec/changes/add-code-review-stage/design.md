## Context

See proposal.md, "Why". The current state that shapes the approach:

- **The verification stage** (`src/stages/verify/`) already does most of what this stage needs. The shared helpers of `src/stages/openspec-stage.ts` provide the OpenSpec checks, the change check, the orchestration, commit, closing, blocked and constraints sections, and the `AFK` retry of a refused transition. `loadPluginSkill` reads a skill from the running plugin. The transition table (`src/transition/mode.ts`), its guards (`guards.ts`), the receipt (`receipt.ts`) and persist mode (`src/persist/persist.ts`) each have one row per stage.
- **The review team** (DOT-163, the change `add-review-team-skill` below this one in the stack) gives the report: `review-team` writes `report.json` (`autonomous.review-report.v1`) with findings (`autonomous.finding.v1`), doubts and a walkthrough guide into a directory the caller names.
- **ADR 0008**: a finding's state lives in its pull request thread. The repository's `main` requires every review thread resolved before a merge. The comment format was settled in the grill and previewed against GitHub's own markdown renderer:
    - a Conventional Comments label and decoration;
    - a title, a statement of one to three sentences and a status line;
    - a folded trace;
    - hidden markers.

  The preview also showed two rendering facts. A follow-up's id such as `DOT-150` is not autolinked, because the repository has no Linear autolink. `#qa` renders as plain text.
- **GitHub's API** creates a review with line comments only on lines inside the pull request's diff. File comments use `subject_type: "file"`. Threads are resolved through GraphQL (`resolveReviewThread`), whose `reviewThreads` connection is paginated.
- **Plannotator** imports an authored guide for a pull request with `plannotator guide import --guide --patch --pr <url>`. It sends a guide for review through the Inbox (`submit_guide` with `review: true`) and returns the verdict as an Inbox reply. `plannotator review <pr-url>` blocks until the person decides and prints the feedback with Conventional Comments labels and the blocking decoration.

## Goals / Non-Goals

**Goals:**

- Register the stage with no special case in reconcile or launch, as verification was.
- Render and post every finding thread in code, so that the format, the markers, the anchoring, idempotency and the public-content rule cannot drift with a model.
- Keep the adversarial review skill free of any fact about this stage: the human's round is written for any caller.

**Non-Goals:**

- Marking the pull request ready, or handling the bots' findings (DOT-157).
- Reading the human's comments from tuicr (DOT-160).
- Checking in code whether the orchestrator's triage, refutation or fixes were right: the fix checks do that.

## Decisions

### D1. The stage is verification's shape with a different report

`src/stages/code-review/stage.ts` and `prompt.ts` are built on the shared helpers:

| Part | Value |
| --- | --- |
| id | `code-review` |
| emoji | 🧐 (session title `auto 🧐 <name> (<task id>)`) |
| agent arguments for `claude` | `--model opus --effort high` |
| prerequisites | `openspecChecks` with no workflow, `changeCheck`, and `loadPluginSkill` for `review-team` and `adversarial-review` |
| completion | the `transitionRow("code-review")` check |

The prompt passes the review team's directory as `<attempt dir>/review`. The record of findings stays `findings.md` in the attempt's directory.

*Alternative:* invoking `review-team` as an installed skill by name. Rejected for the reason verification gave for the adversarial review: the prompt must carry the skill of the runner's own version.

### D2. Publish mode renders and posts the threads

The orchestrator does not write comment markdown. It writes `threads.json` (`autonomous.threads.v1`) in the attempt's directory:

- the review's index fields;
- one entry per thread: `id`, `kind` (`finding` or `doubt`), `label`, `blocking`, `title`, `statement`, the status (`fixed` with a commit, `deferred` with a follow-up URL or proposed, `passed-on` with a stage, `blocked`, `open-doubt`), the trace fields (reporters, severity, reproduction), the location and `for` when passed on;
- the earlier threads to answer and resolve, by marker id, with the reply.

`/autonomous:run --apply --publish <attempt-id>` validates the file, then:

1. Reads the markers already on the pull request, through every page of `reviewThreads` and of the issue comments.
2. Renders each new thread from a fixed template.
3. Anchors each thread: a line comment when its lines are in the pull request's diff, a file comment when only its file is, else an entry in the review's body.
4. Posts one review (COMMENT) holding them.
5. Resolves the threads whose state is resolved, and replies to and resolves the earlier threads named.
6. Reads it all back.

Before posting, it refuses content that names the home directory or an absolute path, as log mode does.

*Alternatives:* the orchestrator calling `gh api` itself, rejected: the format, the markers and the anchoring would vary between runs, and a retry could duplicate threads. Publishing from `collect` in the review team was rejected too, because the review team never publishes (DOT-163).

### D3. Markers and ids

Every comment ends with one hidden marker: `<!-- autonomous:finding v1 id=<id> stage=code-review severity=<s> outcome=<o> [for=<stage>] [commit=<sha>] [follow-up=<url>] -->`, or `autonomous:doubt`, `autonomous:resolution` or `autonomous:review` with the fields of its kind. Ids are scoped to the task: `cr-<attempt n>-<n>`. A retry of the same publish finds the same ids and adds nothing. A re-attempt reads the earlier threads (the prompt says so) and reuses an earlier id when the finding triage judges a finding to be the same one; that judgement is the triage's, not code's.

### D4. The human round, on two surfaces

The human round runs only for `HITL`, after publishing.

- **GitHub:** the human comments on the pull request and tells the session they are done. The orchestrator reads the review comments that carry no `autonomous:` marker, made since the stage's review. Our comments are posted with the same account, so the marker is what tells them apart.
- **Plannotator:** the orchestrator runs `plannotator review <pr-url>`, which blocks until the human decides and returns their comments with Conventional Comments labels and the blocking decoration.

Either way, each comment becomes a finding of the reviewer `human`, in a new round of the adversarial review (D5). Comments from Plannotator are published through publish mode as threads reported by `human`. Comments from GitHub get a reply and are resolved. The round repeats until the human approves at the transition question.

### D5. The adversarial review's human round is generic

The skill gains two rules, with no word about code review:

- A caller whose human follows the review may allow one more round whose report is the human's comments.
- In it, the refutation is advisory: counter-evidence is shown and the human decides. A kept finding survives without a reproduction. A blocking comment takes the floor severity, and any other the severity just below it.

This keeps "nobody judges their own work" and the severity rule intact, and gives the human the last word on their own comments.

### D6. The walkthrough at the close

After the fixes, the orchestrator updates the review team's guide (`review/walkthrough.json`) to the final diff and adds a v4 note for each published finding at its lines, with its outcome. It validates the guide with `plannotator guide export` against the final patch. Publish mode imports it for the pull request with `plannotator guide import --pr`. A failure is reported, never fatal (spec, autonomous-run "Publish mode imports the walkthrough"). For `HITL`, the prompt sends it through `plannotator inbox call submit_guide` with `review: true`. The logbook entry carries a markdown rendering of the guide's intent and section titles, which code produces from the JSON.

### D7. The rows of every per-stage table

- **Transitions:** a `code-review` row in `TRANSITIONS` (`to: "external-review"`, `asks: "approval"`), with the `READY` text "the code review is ready".
- **Receipt:** `code-review: "stage summary"`.
- **Persist mode:** `code-review: SUMMARY_ONLY`.
- **Guards:** `code-review` added to the guarded stages, with the same three guards as `verify`.
- **Selection:** `code-review` in `SUPPORTED_STAGES`.
- **Stages:** `STAGE_IDS` gains `code-review`.

### D8. `external-review` is one more entry in the contract

`STAGE_LABELS` gains `external-review`, with colour `#a16207` (distinct from every contract label and from `triage-me`'s `#f2c94c`) and its meaning. Detection, triage, the label-at-creation text and the bootstrap derive from that list, as they did for `code-review`.

### D9. ADR 0007 and the glossary

- **ADR 0007:** its consequence "Until code review and QA exist, a task stops at `code-review`" becomes "a task stops at `external-review`, its pull request still a draft". Its decision is unchanged: the external review stage is QA's successor and marks the pull request ready (DOT-157).
- **Glossary:** **Code review** drops "It does not exist yet", and **Stage label** and **Transition** gain the fifth transition.

## Risks / Trade-offs

- **Threads posted under the user's account.** A person could take one for a human's comment. → Every thread carries the marker and the trace, and the review's body names the attempt.
- **The line a finding names has moved after a fix.** → Anchoring uses the final diff, and the orchestrator passes the fix's location for a fixed finding.
- **The repository requires every thread resolved before a merge.** An open thread that nobody acts on, for instance one passed on to QA while QA does not exist, holds the merge back. → This is intended (ADR 0008): the logbook entry and the stage summary list the open threads, so a person sees why.
- **Pagination.** A pull request with many comments hides markers beyond the first page. → Publish mode reads every page. A test covers more than 30 threads, the mockup's own example.
- **DOT-163 is not merged when this proposal is written.** Its tier table may change after calibration. → This change references the review team's report schema and its directory parameter, not its tiers. `openspec-update-change` reconciles the change if DOT-163 lands with a different shape.
- **The human round on GitHub needs the human to say "done".** → The prompt asks for it explicitly. Plannotator's review blocks until a decision, so it needs nothing more.

## Migration Plan

A minor release with no configuration change.

1. Run `/autonomous:run --bootstrap-labels` once per tracker, before the first transition out of `code-review`, to create `external-review`.
2. Stop the loop before installing: a task already in `code-review` becomes a candidate at once, ahead of every other stage.
3. To roll back, first relabel by hand every task in `external-review`, and move any `code-review` attempt directories out of the state directory, as the verification stage's upgrade notes describe. Then revert the release.
