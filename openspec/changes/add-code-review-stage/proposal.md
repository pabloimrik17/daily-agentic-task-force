## Why

A task that leaves verification carries `code-review` and stops there: selection treats it as an unsupported stage, so nobody judges the quality of the code before the review bots and the human reviewers see the pull request. They then find what a review on this machine could have found and fixed, and the human cannot tell what was already checked. This change registers the code review stage (DOT-164), the second review stage: it judges the code the implementation changed through the review team (DOT-163) and the adversarial review, and publishes what survives as finding threads on the pull request (ADR 0008). The review team's calibration has run and its defaults are set, which is what the stage waited for.

## What Changes

- **A new stage label, `external-review`** (colour `#8b5e3c`): the task has passed every review stage that exists and waits for external review. It enters the contract and the bootstrap before the stage that consumes it exists, as `code-review` did. Selection treats it as an unsupported stage. `qa` is not added.
- **The code review stage is registered** (id and label `code-review`, emoji 🧐), for the `claude` tool only, with `--model opus --effort high`. Selection supports `code-review`, so selected and supplied units launch, and a `code-review` candidate is preferred over every other stage's.
- **Prerequisites** are verification's without the verify and update workflows, plus the bodies of the review team and adversarial review skills read from the running plugin, and the finding threads already on the pull request. Plannotator, Codex and CodeRabbit are optional: a missing one is skipped with its reason, never a reason to wait.
- **One review round of the adversarial review**: the pull request's diff as subject; the definition and the proposal as references, read by the finding triage and the refutation, never given to the reviewers; the review team, at the tier it measures, as the report's procedure; `CRITICAL` as the floor; QA as the only later review; `findings.json` in the attempt's directory as the record; a human follows it for `HITL`. The findings verification passed on to code review enter the triage as findings of the reviewer `verification`.
- **Boundaries.** The stage never changes the proposal or the definition: a finding whose fix would, including one located in the change's own artifacts, is deferred for `AFK` and asked for `HITL`. It does not resolve a conflict with the base branch. A doubt is settled against the definition and the proposal first; then `HITL` asks the human and `AFK` publishes it as an open `question (blocking)` thread.
- **Publish mode**, `/autonomous:run --apply --publish <attempt-id>`: code, not the agent, reads `findings.json` and publishes each surviving finding as a finding thread, in Conventional Comments with a folded trace and hidden markers, one review per review round that opens threads; it answers, resolves and unresolves existing threads; it writes `published.json` with the digest of the record it published.
- **No thread twice.** Within an attempt, code guarantees it. Across attempts, the finding triage links each finding to the thread it continues, from the threads the prompt lists, and code turns a new finding that matches an existing thread exactly into a reply in that thread.
- **The walkthrough.** Publish mode brings the review team's draft up to the final diff, with the files the fixes added in a trailing section and each published finding as a note, and saves it in Plannotator for the pull request. The logbook entry carries a short rendering, and an `HITL` human receives it in the Inbox to review.
- **The human round** (`HITL` only): after the stage's own round is published and before the approval question, the human reviews on GitHub or in Plannotator; each comment becomes a finding of the reviewer `human`, with a severity from its mark; the refutation only advises; fixes go through the fix check and the round ends with publish mode. Rounds repeat while the human sends feedback.
- **The adversarial review skill** lets its caller add rounds whose report is a human's, and name reporters whose findings the refutation only advises on.
- **The closing order**: the checks and pushes; publish mode; for `HITL`, the walkthrough in the Inbox and the human rounds; the stage summary and persist mode; the transition; the logbook entry with a `### Code review` section; the result marker. Commits, follow-up tasks, the blocked `AFK` path and a re-attempt work as in verification. The pull request stays a draft.
- **The transition out of `code-review`** to `external-review`: applied with no answer for `AFK`, on the human's approval for `HITL`, and refused on verification's guards and while the open attempt has no publish receipt matching its record. ADR 0004 is widened; ADR 0007's consequence now names `external-review`.
- **Persist mode serves this stage**, posting only the stage summary.
- **Completion check.** The stage is complete when the task carries `external-review` and no `code-review`, or is closed.
- **Docs.** The README covers the stage, publish mode, finding threads and the walkthrough; the glossary already gains Reviewer, Review round, Human round and Orchestrator on this branch.
- **Release.** A `feat(autonomous):` minor, with no configuration change. `--bootstrap-labels` must run once per tracker to create `external-review`.

**Out of scope**:

- The external review stage (DOT-157), including whether it, or a stage after it, takes the open threads no stage owns; QA and the `qa` label.
- Marking the pull request ready for review.
- Picture it (DOT-159), tuicr as a surface (DOT-160), verification publishing threads (DOT-161), the hybrid tier decision (DOT-158), the reviewer of prose that instructs an agent (DOT-167), repeating rounds until nothing worth fixing remains (DOT-148).
- Resolving a conflict between the branch and its base.

## Capabilities

### New Capabilities

- `code-review-stage`: the code review stage as a stage implementation: its identity and agent arguments, its prerequisites, the prompt (the adversarial review's parameters, its input from verification, its boundaries, doubts, the human round), its closing order per autonomy, its stage summary and logbook section, and its completion check.
- `finding-threads`: findings published on a task's pull request: the record a stage writes, publish mode's rules for what is published and in which state, the comment format and its markers, anchoring, reviews per round, replies and resolutions, idempotency within and across attempts, and the publish receipt.
- `walkthrough`: the walkthrough of a task's pull request: the review team's draft brought up to the final diff with each published finding as a note, saved in Plannotator for the pull request, and rendered for the logbook entry.

### Modified Capabilities

- `label-contract`: the stage group gains `external-review`, with its meaning, spelling, colour and bootstrap, and a fifth transition, from `code-review` to `external-review`, which an `AFK` task makes without a human's answer.
- `work-selection`: `code-review` becomes a supported stage and `external-review` an unsupported one, and `code-review` is the most advanced supported stage.
- `autonomous-run`: transition mode, the approval question and transition answers handle a task in `code-review`, with the guards on leaving it and the publish receipt; persist mode accepts a `code-review` attempt; publish mode is new.
- `label-triage`: a task in `external-review` without an autonomy label is decided between `AFK` and `HITL` only.
- `adversarial-review`: the caller may add human rounds and name the reporters whose findings the refutation only advises on.

## Impact

- **Code** (`plugins/autonomous/src/`):
    - the contract: `label-contract/contract.ts`;
    - the stage ids and the registry: `stages/{stage,registry}.ts`;
    - the new stage: `stages/code-review/` (stage, prompt, prerequisites);
    - the plugin skill loader, which resolves the plugin root in a skill's body: `stages/plugin-skill.ts`;
    - selection: `select/stage.ts`;
    - the transition, its guards and receipts: `transition/{table,mode,receipt,guards}.ts`;
    - persist mode: `persist/persist.ts`;
    - publish mode and the finding threads (new): `publish/`, with the GitHub reads and writes it needs in `pull-request/`;
    - the walkthrough's update, reusing `review-team/guide.ts`;
    - the arguments and the dispatcher: `args.ts`, `run.ts`;
    - the tests next to each of these.
- **Plugin files**: `skills/adversarial-review/SKILL.md`, `README.md`, `GLOSSARY.md` (partly edited), `docs/adr/0004-…`, `docs/adr/0007-…`, `commands/run.md`.
- **Runtime dependencies**: the `openspec` CLI, `git`, `gh` (GraphQL for review threads), and optionally `plannotator`, `codex` and `coderabbit`.
- **Trackers**: the stage posts one comment on its task and replaces `code-review` with `external-review`; for an `HITL` task it may create follow-up tasks the human confirmed. `external-review` must exist on Linear and GitHub before the first transition.
- **Repositories**: the stage commits and pushes its fixes on the task's workspace branch, and posts reviews, comments, replies and resolutions on its draft pull request with the user's `gh` account.
