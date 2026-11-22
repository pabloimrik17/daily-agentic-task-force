## Context

See proposal.md, "Why". The current state that shapes the approach:

- **The contract.** `label-contract/contract.ts` declares the stage labels once (`grill-me`, `proposal`, `implement`, `verify`); colours, meanings, detection, triage, the label-at-creation text and the bootstrap derive from that list.
- **Selection.** `select/stage.ts` holds `SUPPORTED_STAGES = ["grill-me", "proposal", "implement"]`; `STAGE_ORDER` follows the contract's list, so the most advanced supported stage wins.
- **The stage contract.** `stages/stage.ts` lists `STAGE_IDS = ["test", "grill-me", "proposal", "implement"]`. A stage's `prerequisites(env)` return a `context` of strings for its synchronous `prompt`.
- **The implementation stage** (`stages/implement/`) already does almost everything this stage needs: the shared OpenSpec checks (`openspecChecks` in `stages/openspec-stage.ts`), the change check through `findBranchChange`, the orchestration and commits sections, the `AFK` retry of a refused transition, the blocked path, the closing order, and the guards on leaving (`transition/guards.ts`).
- **Skills.** `stages/skills.ts` finds a skill in a plugin Claude Code installed, through `~/.claude/plugins/installed_plugins.json`, and the stages inline the `handoff` skill of `mattpocock-skills` that way. The autonomous plugin ships one skill, `labelling-new-tasks`.
- **OpenSpec workflows.** `stages/openspec-workflows.ts` maps `propose`, `apply` and `update` to their OpenSpec 2 skill and OpenSpec 1 command.
- **The transition** (`transition/mode.ts`) keys its rows by the stage they leave; `receipt.ts` names what each stage persists; persist mode (`persist/persist.ts`) has one plan per stage.

## Goals / Non-Goals

**Goals:**

- Register the stage with no special case in reconcile or launch, as the implementation was.
- Share the implementation stage's prompt pieces instead of copying them, so the two prompts cannot drift and the duplication gate stays clean.
- Write the adversarial review once, as a skill any review can follow, with no fact about the verification in it.
- Guarantee in code, not only in the prompt, that a task leaves `verify` only with its work committed and pushed.

**Non-Goals:**

- Checking in code what the teammates of the adversarial review did: the fix checks and the repository's checks do that, and the guards check only what git and OpenSpec can tell.
- Reading an earlier attempt's record of findings: a re-attempt starts a new round (see D10).
- Relating tasks on GitHub, which has no relation of that kind (see D9).

## Decisions

### D1. `code-review` is one more entry in the contract's stage list

Adding `code-review` to `STAGE_LABELS`, `COLOURS` (`#a3e635`) and `MEANINGS` covers detection, triage, label-at-creation's text and the bootstrap, which derive from them. `STAGE_IDS` gains `verify` but not `code-review`, and `SUPPORTED_STAGES` gains `verify`. `STAGE_ORDER` follows `STAGE_LABELS`, so `verify` becomes the most advanced supported stage with no further change. The colour is the one contract colour left far from every other: the greens, blues, purples, pinks, oranges and greys are taken.

### D2. The stage lives in `stages/verify/`, and the implementation's shared pieces move to `stages/openspec-stage.ts`

`stages/verify/stage.ts` holds the contract (id `verify`, emoji 🔍, `--model opus --effort high`, prerequisites, completion) and `stages/verify/prompt.ts` the prompt. What both stages say the same way moves out of `stages/implement/`: the change check, the orchestration section, the commit rules (parametrised by the unit committed: a unit of work, or a fixed finding), the `AFK` retry of a refused transition (parametrised by the stage left and the stage reached) and the deviation rule per autonomy. The implementation prompt keeps its exact text, except the two deliberate changes of D12; its tests guard that.

*Alternative:* copy the implementation's module and edit it. Rejected, as for the implementation stage (its design D2): two prompts that must say the same thing would drift, and the duplication gate would flag the copy.

### D3. The adversarial review is read from the running plugin's own directory

The skill ships at `plugins/autonomous/skills/adversarial-review/SKILL.md`. A small loader resolves that path from the module's own location (`import.meta.url`), strips the frontmatter and returns the body, which the prerequisites put in the stage context and the prompt inlines, as it inlines `handoff`. A file that cannot be read fails the prerequisites with a reason naming the path.

*Alternative:* find it with `loadSkills`, through the plugins Claude Code installed. Rejected: it would read the installed version, not the one the run belongs to. A run from a branch (the end-to-end checks of this change) would find no skill or an older one, and after an update the prompt could carry a skill of another version than the runner's. `handoff` comes from another plugin, so the installed copy is the right one there; this skill is the plugin's own.

*Alternative:* a prompt section in TypeScript, shared by the review stages. Rejected in the grill: it can be reused only inside autonomous, and the adversarial review is meant to be followed by hand and by other skills too (for instance DOT-125's bug flow). A plugin of its own was rejected as premature: one more release and dependency before a second consumer exists.

### D4. The skill is generic; the stage supplies its parameters

The skill describes the phases, the independence of who judges, the finding triage and its outcomes, the reproduction, the severity floor, the bound on a rejected fix and the record, in terms of what its caller supplies (spec adversarial-review, "What the caller supplies"). The verification prompt's own section supplies them, right before the skill's body: the implementation as subject; the proposal and the definition as references; the verify workflow as the report's procedure; `CRITICAL` as the floor; code review and QA as the later reviews, each with the heading it gets in the stage summary; `findings.md` in the attempt's directory as the record; and whether a human follows the review, from the task's autonomy. The skill's description claims only a request that names an adversarial review, so it never competes with the code review skills on a plain "review this".

### D5. The verify workflow joins the workflow map

`stages/openspec-workflows.ts` gains `verify: { skill: "openspec-verify-change", command: "verify" }`. The prerequisites ask for `verify` and `update` through `openspecChecks`, as the implementation asks for `apply` and `update`, so a missing workflow gets the same reason, naming both forms.

### D6. Leaving `verify` runs the guards of leaving `implement`

`guardsOnLeaving` runs the same three checks for `verify` as for `implement`: unchecked tasks of the change, uncommitted changes, unpushed commits. The verification checks no task box of its own, but an unchecked task left by hand is still unfinished work, and a fix left uncommitted or unpushed is exactly what the guards exist to catch.

### D7. The transition table gains a row

`TRANSITIONS` gains `verify: { to: "code-review", asks: "approval" }`, and the autonomy rule the implementation shares with proposal preparation covers it: `AFK` applies the transition directly, `HITL` asks. The approval question says "the verification is ready", and its `Approve` value is the row's `to`. `receipt.ts` gains `verify: "stage summary"`. ADR 0004 is widened to name the third transition without an answer.

### D8. Persist mode gains a plan for `verify`

The plan is the implementation's: the stage summary only, no description change, header `autonomous · verify · <attempt-id> · stage summary saved`.

### D9. Follow-up tasks are created only for HITL, through the plugin's labelling skill

An `AFK` session proposes follow-up tasks and creates none: no human vets them, and each created task counts against the workspace's issue limit on Linear's free plan. For `HITL`, once the human confirms a follow-up, the prompt tells the agent to create it in the task's own tracker following `labelling-new-tasks`, and to relate it to the task: `linear issue relation add <new> related <task>` on Linear, a `related` dependency on Beads, and a link to the task in the issue's body on GitHub, which has no such relation. Never as a subtask: an open subtask keeps its parent from being a candidate, which would stop the task at `code-review` once that stage exists.

### D10. A re-attempt starts a new round and keeps what the earlier one left

A new attempt does not read the earlier attempt's `findings.md`: the earlier attempt's stage summary, among the task's comments, says what it did, and its fixes are committed. The new round's report checks the code as it is. Uncommitted changes are an unfinished fix: they stay in the working tree, are never discarded, and are committed only once a fix check of the new round accepts them as the fix of a surviving finding. Changes no finding claims by the end of the round block an `AFK` attempt, named in the stage summary, and go to the human for `HITL`.

*Alternative:* pass the earlier attempts' directories to the prompt so the record carries over. Rejected for now: a round is cheap to restart compared with reconciling two records, and DOT-148, which repeats rounds, will decide how records chain.

### D11. The record of the findings stays in the attempt's directory

`findings.md` is written by the orchestrator in the attempt's directory, outside the repository and every tracker. The stage summary and the logbook entry's `### Verification` section are built from it, so it never reaches the pull request or the tracker as such, and holds no detail of the machine that the public-repository rule forbids.

### D12. The implementation prompt hands the review stages their work

Two deliberate changes to the implementation prompt:

- A boundary paragraph in the implementation section: verifying the change, reviewing the code's quality, running the delivery as its end user would and archiving belong to later stages; the orchestrator runs neither the verify nor the archive workflow, even when the apply workflow suggests it once every task is done. The repository's checks and the review of each teammate's block stay its own.
- The `HITL` review becomes a quick look: the orchestrator shows the human the implementation and its pull request, says that verification, code review and QA follow, and fixes only what the human clearly asks for.

## Risks / Trade-offs

- [A task repository's OpenSpec setup may not install the verify workflow] → The prerequisites name both forms and tell the human to update OpenSpec there; the task waits in `verify` with that reason, and nothing is initialised by the run.
- [An adversarial review can start many teammates] → The orchestrator chooses each teammate's model and effort, from the cheapest up, and a round runs once; DOT-148 decides how far to repeat it.
- [Code Pattern Consistency findings overlap the future code review] → Accepted in the grill: the verify workflow runs as it is. The deeper review of the code stays code review's.
- [The skill's body makes the prompt longer] → It replaces what the prompt would otherwise have to state itself, and the orchestrator delegates the reading of the subject to teammates.
- [A fix check is an LLM's judgement] → The guards still refuse uncommitted or unpushed work in code, and the repository's checks run after the fixes.

## Migration Plan

1. Release as a `feat(autonomous):` minor; no configuration change.
2. Before installing it, stop the loop (`/autonomous:loop-stop`). A task that already carries `verify` becomes a candidate once the stage exists, ahead of every other stage, and a running loop would launch it at once.
3. Run `/autonomous:run --bootstrap-labels` once per tracker, so `code-review` exists before the first transition out of `verify`.
4. Accept the change with one real `HITL` run on a task in `verify`, launched by hand from this branch after the user's go-ahead.

Rollback: revert the release, but first relabel by hand every task already in `code-review`: an older version does not know it, sees those tasks as missing a stage, and its label triage would derive `proposal` for them. An older release cannot read `verify` attempt records either (its `STAGE_IDS` lacks `verify`), so before reverting, finish or discard every `verify` attempt and move each `attempts/<source>/<task>/verify/` directory out of the state directory, as for the implementation stage.
