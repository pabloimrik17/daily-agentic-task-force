## Context

See proposal.md, "Why". The current state that shapes the approach:

- **The contract.** `label-contract/contract.ts` declares the stage labels once (`grill-me`, `proposal`, `implement`); the colours, the meanings, detection, triage and the bootstrap all derive from that list.
- **Selection.** `select/stage.ts` holds `SUPPORTED_STAGES = ["grill-me", "proposal"]`. Unsupported stages are excluded before `splitByStage` keeps the most advanced stage, in `STAGE_ORDER`.
- **The stage contract.** `stages/stage.ts` lists `STAGE_IDS = ["test", "grill-me", "proposal"]`; `prerequisites(env)` receives the tool, home, task, repository, workspace branch and readers (context, pull requests, `openspec`), and returns a `context` of strings for the synchronous `prompt`.
- **OpenSpec workflows.** `stages/openspec-workflows.ts` (#99), a shared check, tells whether a repository provides an OpenSpec workflow as an OpenSpec 2 skill or an OpenSpec 1 command, and proposal preparation names the propose workflow accordingly.
- **Proposal preparation** (`stages/proposal/`) already does most of what this stage needs: the claude-only and single-autonomy checks, the OpenSpec root and CLI checks, the `handoff` skill, the context read and rendered with attributed, quoted comments, the open pull request, the stage summary, the logbook entry, the blocked path and the public-repository rule.
- **The transition.** `transition/mode.ts` keys the transitions by the stage they leave (`grill-me → proposal` asks the autonomy, `proposal → implement` asks the approval); `proposalAutonomy` decides whether an answer is needed; `receipt.ts` looks for an open attempt of the stage being left without a receipt.
- **Persist mode** (`persist/persist.ts`) has one plan per stage: what it persists and the comment header.
- **The pull request port** (`pull-request/port.ts`) finds the open pull request of a branch and the repository's default branch, through `gh`.

## Goals / Non-Goals

**Goals:**

- Register the stage with no special case in reconcile or launch, as proposal preparation was.
- Share proposal preparation's prompt pieces instead of copying them, so the two prompts cannot drift and the duplication gate stays clean.
- Guarantee in code, not only in the prompt, that a task leaves `implement` only with its work finished.

**Non-Goals:**

- Measuring the orchestrator's context, or relaunching it (DOT-138).
- Checking what the teammates did, or the quality of the code: the repository's checks and the next stage do that.
- A per-task model or effort for the orchestrator (DOT-119).

## Decisions

### D1. `verify` is one more entry in the contract's stage list

Adding `verify` to `STAGE_LABELS`, `COLOURS` (`#d6409f`) and `MEANINGS` covers detection, triage, label-at-creation's text and the bootstrap, which derive from them. `STAGE_IDS` gains `implement` but not `verify`, and `SUPPORTED_STAGES` gains `implement`. `STAGE_ORDER` follows `STAGE_LABELS`, so `implement` becomes the most advanced supported stage with no further change.

### D2. The stage lives in `stages/implement/`, and the shared prompt pieces move out of `stages/proposal/`

`stages/implement/stage.ts` holds the contract (id `implement`, emoji 🛠️, `--model opus --effort high`, prerequisites, completion) and `stages/implement/prompt.ts` the prompt. The pieces both prompts use move to one shared module under `stages/`: the Context section, the stage summary section, the logbook entry paragraph (parametrised by the stage's own section, `Proposal` or `Implementation`), the blocked section and the constraints, together with the prerequisite checks that both stages run (claude only, one autonomy, OpenSpec root, CLI, `handoff` skill, task context, open pull request). Proposal preparation's prompt keeps its exact text; its tests guard that.

*Alternative:* copy proposal preparation's module and edit it. Rejected: two prompts that must say the same thing about comments, machine details and the stage summary would drift, and the duplication gate would flag the copy.

### D3. The change to implement is found with git, relative to the pull request's base

One function finds the change for both the prerequisites and the transition guards: the files the branch adds under `openspec/changes/`, compared with the merge base of `origin/<base>`, where `<base>` is the repository's default branch, grouped by their first directory below `openspec/changes/`, `archive/` excluded. Exactly one directory is the change; none or several is a failure that names them. At launch it runs in the repository on the workspace branch's ref; in the guards it runs in the workspace.

*Alternative:* the pull request's file list from `gh`. Rejected: `gh` caps the list, and by the time the guards run the pull request holds the whole implementation, so the change's files could fall past the cap. Git sees the same diff the pull request shows, without a cap.

### D4. The OpenSpec workflows are found by `stages/openspec-workflows.ts`

OpenSpec 2.0 removes the `/opsx:*` commands and keeps the skills; task repositories may still be on 1.x. The prerequisites reuse the workflow check that proposal preparation uses since #99, which already maps `apply` and `update`: the skill (`openspec-apply-change`, `openspec-update-change`) when it exists, the command (`/opsx:apply`, `/opsx:update`) otherwise. The names reach the prompt through the stage context, and a missing workflow's reason names both forms and says to update OpenSpec in that repository.

### D5. The prompt grants the effort level explicitly

The prompt describes the orchestration as intent (see the spec's "Orchestration is stated as intent"), with one deliberate exception: it says that the orchestrator may set any effort level for a teammate. Claude Code's agent tool lets a session name an exact effort level only when its instructions ask for it; otherwise it can move only one level from its own. Without that sentence, an `opus`/`high` orchestrator could never start a `low` teammate, which defeats the point of matching each block's cost.

### D6. The guards on leaving `implement` run in the task's workspace

A guard module, called by transition mode before it acts and by answer mode before it applies, checks the three conditions of "Leaving implement needs the work finished" and returns every reason that holds:

- **unchecked tasks**: `openspec list --json` in the workspace, the found change's `completedTasks` against `totalTasks`;
- **uncommitted changes**: `git status --porcelain` in the workspace is not empty;
- **unpushed commits**: after `git fetch`, `git rev-list --count origin/<branch>..HEAD` is not zero, and a branch with no remote branch counts as unpushed.

The workspace is the path recorded in the task's latest attempt record, which every stage of a task shares; a path that no longer exists, or a task with no attempt, is "no workspace to check". The guards run before the approval question is emitted, so an `HITL` human is never asked to approve unfinished work, and again when the answer arrives, since the workspace may have changed in between. They take injected `git` and `openspec` execs, so tests run on fakes.

*Alternative:* trust the prompt's gate. Rejected: the user's rule for this plugin is code before an LLM where code can decide, and an orchestrator near the end of a long session is exactly when a step gets skipped.

### D6a. An AFK orchestrator leaves the tasks that need a human unchecked

Proposals often end with end-to-end checks that need the user's go-ahead, such as real writes to a tracker. An `AFK` orchestrator has nobody to ask, and the guards of D6 refuse an unchecked task, so it could only end blocked, check the task without doing it, or do the write without the go-ahead. The prompt names the first as the only path: such a task is neither done nor checked, the rest is finished, and the blocked path names it in the stage summary. Keeping these checks out of an `AFK` proposal's `tasks.md`, so that the task can reach `verify` alone, belongs to proposal preparation and is left to a follow-up task.

*Alternative:* let the guards skip a section with a fixed name, such as "End-to-end verification". Rejected: the guards would have to parse `tasks.md` themselves, and a section name is a convention a proposal can miss.

### D7. The transition table gains a row, and the autonomy rule is shared

`TRANSITIONS` gains `implement: { to: "verify", asks: "approval" }`. `proposalAutonomy` becomes a function of the stage being left, so `implement` reuses it: `AFK` applies the transition directly, `HITL` asks. The approval question's text depends on the stage left ("the proposal is ready" or "the implementation is ready"), and its `Approve` value is the row's `to`. `receipt.ts` already reads the stage being left from the row, so it covers `implement` once the row exists.

### D8. Persist mode gains a plan for `implement`

The plan is proposal's: the stage summary only, no description change, header `autonomous · implement · <attempt-id> · stage summary saved`.

## Risks / Trade-offs

- [The orchestrator cannot see its own context, so the 30% target is a request, not a limit] → It is stated as the goal in the prompt; measuring it and handing over is DOT-138.
- [A long implementation consumes much more quota than a proposal, and the quota gate checks only before launch] → Accepted for v1. The slot limits still cap how many sessions run at once.
- [A task in `implement` whose prerequisites fail holds the loop, and `implement` is now preferred over every other stage] → Visible in the loop's notices as a `wait` with its reason; the fix is DOT-141. Tasks reach `implement` through proposal preparation, which leaves the pull request and the change the prerequisites need.
- [Teammates run inside the orchestrator's session, so their cost lands on the same account and slot] → Intended: a slot is a session, whatever runs inside it.
- [The guards see only the latest attempt's workspace] → Every stage of a task reuses one workspace, so the latest record names it; a released workspace is reported, never guessed.

## Migration Plan

1. Release as a `feat(autonomous):` minor; no configuration changes.
2. Before installing it, stop the loop (`/autonomous:loop-stop`). DOT-121 already carries `implement`: once the stage exists it becomes a candidate, ahead of every `proposal` task, and a running loop would launch it before the agreed manual run. Adding `taken` to DOT-121 instead also works, but `taken` also blocks the manual launch, so it must be removed right before it.
3. Run `/autonomous:run --bootstrap-labels` once per tracker, so `verify` exists before the first transition out of `implement`.
4. Accept the change with one real `HITL` run on DOT-121 (pull request #90), launched by hand after the user's go-ahead; restart the loop afterwards.

Rollback: revert the release, but first relabel by hand every task already in `verify`. An older version does not know `verify`, sees those tasks as missing a stage, and its label triage would derive `proposal` for them.
