# Tasks

## 1. Baseline

- [x] 1.1 Verify the starting point:
    - the branch is on `origin/main`: `git log --oneline origin/main..HEAD` shows no commits;
    - the only working-tree changes are `plugins/autonomous/GLOSSARY.md` and this change;
    - `bun run test`, `bun run typecheck` and `bun run lint:fallow` pass before any code change.

## 2. Contract and detection

- [x] 2.1 In `label-contract/contract.ts`:
    - replace `ENTRY_LABELS` with `AUTONOMY_LABELS` and `STAGE_LABELS`, so `GROUPS` is `scope`, `autonomy` and `stage`;
    - add `proposal` with colour `#bb87fc` and its meaning;
    - make `isValidGroup` require exactly one label per group;
    - add the per-detection options function (design D2).

    Verify with `contract.test.ts`:
    - `LABELS` holds the seven labels;
    - `COLOURS.proposal` is `#bb87fc`;
    - two stage labels and `AFK` with `HITL` are invalid;
    - the autonomy options include `grill-me` only when the stage is missing.
- [x] 2.2 In `label-contract/detect.ts`, detect the three groups, with `deferred` for autonomy when the only stage is `grill-me` (design D1). Verify with `detect.test.ts`, one test per scenario of the label-contract requirement "Three label groups", including "Missing entry group" and "Two stages".
- [x] 2.3 Rewrite `label-triage/criteria.md` for the three groups, the meaning of `proposal`, and `grill-me` as the autonomy decision for a task with no stage label. Verify with `bun run lint:markdown`, and with a test asserting that the text names every contract label except `taken` and never says "entry group".
- [x] 2.4 In `plugins/autonomous/GLOSSARY.md`, replace the intro note that the split of `entry` is not implemented; the grill terms are already there. In the README's label-contract section, document the three groups, `proposal`, its colour and meaning, and the `grill-me` exemption for autonomy. Verify with `bun run lint:markdown` and with `grep -n "entry group" plugins/autonomous/README.md plugins/autonomous/GLOSSARY.md` returning nothing.

## 3. Triage

- [x] 3.1 In `label-triage/judgement.ts`, build the schema's groups from `GROUPS` without `stage`, with the autonomy enum `AFK`, `HITL` and `grill-me`, and check each judged decision against the task's options. Verify with `judgement.test.ts`:
    - the schema has `scope` and `autonomy` and no `entry` or `stage`;
    - `grill-me` judged for a task carrying `proposal` is kept as an invalid decision for `decide` to ask about.
- [x] 3.2 In `rules.ts`, `decide.ts` and `step.ts`, derive the stage from the autonomy and record each decision in the group of the label it writes (design D3):
    - a present autonomy without a stage gives `proposal` by rule;
    - an eligible `AFK` or `HITL` brings a `proposal` derivation;
    - an eligible `grill-me` becomes a stage derivation;
    - writes are ordered scope, autonomy, stage.

    Verify with `rules.test.ts`, `decide.test.ts` and `step.test.ts`, one test per scenario of "The stage follows the autonomy", "The autonomy decision depends on the stage" and "Confidence threshold per group", including "Grill judged for a task in proposal".
- [x] 3.3 In `write.ts`, add the pre-write label check (design D4): one lazy `listLabels()` per source with something to write; Linear available in any scope; GitHub in the task's repository; Beads unchecked. A missing label gives `proposed` with the bootstrap hint and a step reason, and a failing `listLabels` stops the source. Verify with `write.test.ts`:
    - `proposal` missing on Linear leaves the other Linear writes applied;
    - a GitHub label present in another repository counts as missing;
    - Beads issues no `listLabels`;
    - a skipped derivation is not in the "labelled this run" set.
- [x] 3.4 In `questions.ts`, take the options from the options function, put scope before autonomy, and offer `grill-me` only without a stage label. Verify with `questions.test.ts`, one test per scenario of "Questions for the human", including "Task already in proposal".
- [x] 3.5 In `answer.ts`:
    - an `AFK` or `HITL` answer for a task without a stage gives the autonomy and `proposal` derivations;
    - a `grill-me` answer gives the stage derivation, or `skipped` once a stage exists;
    - a label the tracker lacks gives `failed` without stopping the source.

    Verify with `answer.test.ts`, one test per scenario of "Apply answers to triage questions".
- [x] 3.6 Key the step data and its text render by `scope`, `autonomy` and `stage` (`step.ts`, `render.ts`). Update the README's triage section: the stage rule, the autonomy decision with `grill-me`, the missing-label note and the bootstrap hint. Verify with `render.test.ts` and `step.test.ts` (no `entry` key in the data), and with `bun run lint:markdown`.

- [x] 3.7 Run the pre-write label check (design D4) without `--apply` too, so the dry run reports each label a tracker lacks with the bootstrap hint and previews what `--apply` would skip; a listing that fails without `--apply` adds a reason and stops nothing. Amend the label-triage spec ("Labels missing on a tracker are not written", with a dry-run scenario), design D4 and the README's triage section. Verify with `write.test.ts` and `step.test.ts`, and with `openspec validate add-stage-labels-and-transition --strict`. (Agreed with the user on 2026-11-01.)

## 4. Selection

- [x] 4.1 Make selection read the stage label:
    - `select/stage.ts` takes `nextStage` from the stage label;
    - `select/candidates.ts` uses the three groups and the `deferred` state for classification, and its `candidate()` gives autonomy `AFK`, `HITL` or null;
    - `select/types.ts` replaces `EntryLabel`, and `render.ts` prints `none`;
    - the README's selection section is updated.

    Verify with `stage.test.ts`, `candidates.test.ts`, `render.test.ts` and `step.test.ts`, one test per scenario of the work-selection deltas, including "Missing stage", "Grill without autonomy" and "Grill selected without autonomy".

## 5. Creation helper, skill and evals

- [x] 5.1 Make the helper report and decide the three groups (`label-at-creation/check.ts`, `cli.ts`) per design D10:
    - `prepare` prints `scope:`, `autonomy:` and `stage:`;
    - `--judged` accepts `scope|autonomy`;
    - `decide` applies `proposal` with an applied `AFK` or `HITL` and `grill-me` alone for a `grill-me` judgement.

    Verify with `check.test.ts` and `cli.test.ts`, one test per scenario of the label-at-creation deltas, including "Grill named by the user" and "Grill judged".
- [x] 5.2 Update the helper's users:
    - `skills/labelling-new-tasks/SKILL.md`: add `proposal` to the spelling list and say autonomy where it says entry;
    - the graders of `evals/beads-nothing-certain` and `evals/linear-unclear-entry` that name the entry group;
    - the README's helper section.

    Verify with `bun run lint:markdown`, `bun run lint:oxfmt`, and `grep -rn "entry" plugins/autonomous/skills plugins/autonomous/evals/*/graders` returning only the eval directory names.
- [x] 5.3 Re-run the evals that run the helper, with the command the README documents, the pinned model and a cost ceiling: beads-nothing-certain, beads-several-tasks, beads-work-afk, entry-conflict, github-missing-label, github-scope-conflict, grill-me-spelling, linear-rule and linear-unclear-entry. Record the scores and the cost in `openspec/changes/add-stage-labels-and-transition/evidence/eval-log.md`. Verify that every case passes its result grader as it did before the change, or that each failure is classified and fixed.

## 6. Bootstrap recolouring

- [x] 6.1 Add an optional `id` to `TrackerLabel` and add `recolourLabel` (design D8):
    - Linear: `linear api` with the `issueLabelUpdate` mutation and `--variable` arguments;
    - GitHub: `gh label edit --repo --color`;
    - Beads: not applicable;
    - the `removeLabel` comment in `tracker.ts` names the transition.

    Verify with `linear.test.ts` and `github.test.ts` against the exact arguments each issues: a Linear response with `success: false` is a failure, and the Linear listing fills `id`.
- [x] 6.2 In `label-contract/bootstrap.ts`, create `proposal`, recolour every same-name contract label whose colour differs in each scope where it appears, report the status `recoloured`, and count a failed recolour as failed. Update its render, and the README's bootstrap section. Verify with:
    - `bootstrap.test.ts`, one test per scenario of "Label bootstrap", including the team label and a label outside the contract left untouched;
    - `run.test.ts` for the exit codes of "Label bootstrap mode", including "Recolour only".

## 7. Transition mode

- [x] 7.1 Add `--transition <source>:<task>` to `args.ts`: it requires `--apply`, combines with `--json` only, and is excluded with `--no-handoff`, `--answer`, `--task`, `--stage`, `--discard` and `--bootstrap-labels`. Verify with `args.test.ts`: the valid form; a value without `:`; an unknown source; each excluded combination; the missing `--apply`.
- [x] 7.2 Make `answer-mode.ts` route to `AnswerHandler { id, answer }` entries instead of steps (design D5), with `run.ts` passing the answering steps plus the transition handler. Verify with `answer-mode.test.ts`: triage answers are unchanged; a `transition:` id reaches the transition handler; an unknown prefix is still `rejected`.
- [x] 7.3 Add `src/transition/` with the reader, the question composer (with the `current ·` marker) and the `autonomous.transition.v1` report, rendered with the run report's handoff functions (design D7). Verify with `transition.test.ts`, one test per scenario of "Transition mode", "Transition question" and "Transition report":
    - a task not in `grill-me` gets exit 3 and no handoff;
    - an unreadable task reports a null task;
    - the text report's last line is `handoff: ` followed by one line of JSON.
- [x] 7.4 Implement the transition answer (design D6):
    - validation, then the label check before any write;
    - phase one adds the labels and reads back, and phase two removes and reads back;
    - the final set is verified.

    Verify with `transition.test.ts`, one test per scenario of "Transition answers" and of the label-contract requirement "A transition replaces the stage", plus:
    - a removal failure leaves `grill-me` with `proposal` and reports `failed` with both sets;
    - answering again completes the transition;
    - no label outside the stage and the replaced autonomy is ever removed.
- [x] 7.5 Dispatch transition mode in `run.ts` without the run lock and with `modeConfig` for a configuration that fails to load. Update `commands/run.md`: the transition report's handoff is relayed exactly like a run report's, and nothing else in the command changes. Document transition mode, its report and its exit codes in the README. Verify with:
    - `run.test.ts`: no lock file is touched; `--json` prints one `autonomous.transition.v1` document; a missing configuration exits 3;
    - `bun run lint:markdown`.

## 8. Run report

- [x] 8.1 Move the run report to `autonomous.run.v2` (`report.ts`), and update the README's report section and the shipped report examples. While in the README, fix the note at line 110 that says `--stage` is not checked at parse time. Verify with:
    - `report.test.ts` and `run.test.ts`: the schema string is `autonomous.run.v2`, and the JSON has no `entry` key;
    - `grep -rn "autonomous.run.v1" plugins/autonomous` returning nothing outside the changelog.

## 9. Integration checks

- [x] 9.1 Run the full toolchain and the strict validation:
    - `bun run test`, `bun run typecheck`, `bun run lint:oxfmt`, `bun run lint:eslint`, `bun run lint:markdown`, `bun run lint:knip`, `bun run lint:fallow` (complexity budget) and `bun run lint:marketplace`;
    - `openspec validate add-stage-labels-and-transition --strict`.

    Verify that every command passes and that `bun.lock` is not modified.
- [x] 9.2 Manual check against the real trackers, recorded in `openspec/changes/add-stage-labels-and-transition/evidence/manual-check.md`. The tracker writes in the last three steps need the user's go-ahead first.
    0. Replace the Linear alias `Grill Me` with the literal `grill-me` on every open issue that carries it (add `grill-me`, remove `Grill Me`; the label definition stays), so no task with an autonomy label and the alias gets `proposal` by rule. Agreed with the user on 2026-11-01; recorded in the same evidence file.
    1. `/autonomous:run --json` without `--apply`. It lists `proposal` as proposed for tasks with an autonomy label and no stage label, and as missing on Linear and GitHub before the bootstrap.
    2. `/autonomous:run --bootstrap-labels`. It creates `proposal` and reports each recoloured label.
    3. Create a throwaway Beads task with `personal` and `grill-me` and run `/autonomous:run --apply --transition beads:<id>`. Answer `AFK` and check that the task carries `personal`, `AFK` and `proposal`.
    4. Run the transition again on the same task and check that it exits 3 with no handoff.
    5. Close the throwaway task.

## Workflow follow-up

- Commit as `feat(autonomous): …`, a minor with no `BREAKING CHANGE` footer, excluding `bun.lock`, and open the PR referencing DOT-110.
- Run `/opsx:verify`, then archive the change once the PR is reviewed.
- After the release, run `--bootstrap-labels` on this machine, then let a `--apply` run add `proposal` to the tasks that need it. Read the dry run's list of `proposal` writes first, and run that `--apply` from a shell: it writes several hundred labels and the command's timeout cannot hold it.
- Then start change 2 of DOT-110, the grill-me stage.
