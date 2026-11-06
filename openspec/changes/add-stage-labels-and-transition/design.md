## Context

See proposal.md, "Why". The current state that shapes the approach:

- **The contract.** `label-contract/contract.ts` declares `SCOPE_LABELS` and `ENTRY_LABELS` once, and every other list derives from them. `detect.ts` gives each group one of three states: `present`, `missing` (with evidence) or `conflict`. Triage, selection (`select/candidates.ts`) and the creation helper (`label-at-creation/check.ts`) all read those states.
- **Triage.** It records one `Derivation` per group: source, task, group, labels, confidence, reason, tier. `write.ts` adds each derivation's labels and reads them back, and a failure stops the source. Answers (`label-triage/answer.ts`) are turned into `human`-tier derivations and go through the same write. The LLM judgement schema builds one answer object per group from `GROUPS`.
- **Answer mode.** `answer-mode.ts` routes each answer by the text of its id before the first `:` to a `Step` that has an `answer` handler. It does not take the run lock.
- **Trackers.** They already list, read, add and remove labels (removal arrived with DOT-109 for `taken`), list labels and create labels. They cannot recolour. `TrackerLabel` has no id, and Linear needs one to update a label.
- **Bootstrap.** It creates missing labels and reports a differing colour as `present` with the note `colour differs`.
- **Selection.** `select/stage.ts` derives the next stage from whether `grill-me` is present. `candidate()` falls back to `grill-me` as the "autonomy".

## Goals / Non-Goals

**Goals:**

- One declaration of the three groups, from which triage, selection, the helper, the judgement schema and the report all derive, as `entry` is derived today.
- Keep the stage decision in code. The LLM, and the human, decide only the autonomy, or that a grill decides it, and the stage follows by rule.
- Answer the transition through answer mode with the same report and exit codes. The command (`commands/run.md`) needs no new logic, because it already relays any handoff and passes the answers back.

**Non-Goals:**

- A general stage machine. There is exactly one transition (`grill-me` → `proposal`). It is coded as such and does not read a table.
- Making the transition aware of attempts or receipts. Change 2 adds the receipt check.
- Migrating labels beyond what triage already does by rule. No script rewrites existing tasks.

## Decisions

### D1. Autonomy in grill-me is `deferred`, a fourth group state

`detect` gives the autonomy group the state `deferred` when the task has no autonomy label and its only stage label is `grill-me`. The autonomy is absent on purpose and is decided at a known later point: the transition at the end of the grill. Every consumer treats `deferred` as complete: triage counts, the classification exclusion in selection, and the helper. They need no special case.

The rejected names say only half of this. `exempt` and `not-needed` suggest the autonomy is never needed. `undecided` also describes a task in `proposal` without autonomy, which is `missing`. `pending` clashes with the glossary's *Pending cleanup*.

*Alternative:* report it as `missing` and filter it out in each consumer. Rejected: there are three consumers to keep in sync, and a forgotten filter would ask the human about a grill task's autonomy.

### D2. The autonomy decision has options that depend on the stage

A single function gives a group's options for a detection:

- scope: `work`, `personal`;
- autonomy: `AFK`, `HITL`, plus `grill-me` when the stage group is missing.

The judgement schema's autonomy enum is `AFK`, `HITL`, `grill-me`. Validity (`decide`, the helper and answers) checks the decision against the options for that task, so a `grill-me` judged for a task in `proposal` is invalid and asked. The question composer uses the same function, so the question and the validation can never disagree.

*Alternative:* a separate stage judgement. Rejected: for a task with neither label, autonomy and stage form one human decision ("AFK, HITL, or decide it in a grill"), and two judgements could contradict each other.

### D3. A decision is recorded in the group of the label it writes

The decision is made, thresholded and asked in the autonomy group, but its records are written by label group:

- `AFK` or `HITL` gives an autonomy derivation.
- For a task without a stage label, a stage derivation follows: `proposal`, tier `code`, confidence 1, reason `follows autonomy AFK`.
- A `grill-me` decision becomes a stage derivation `grill-me` with the decision's tier, confidence and reason, and gives no autonomy derivation.
- A task that already carries an autonomy label and lacks a stage gets the stage derivation from `deriveByRule` (reason `autonomy AFK is present`).

The writes for a task are ordered scope, autonomy, stage. A write cut short therefore leaves at worst an autonomy without a stage, which the next run completes by rule.

The question id stays `label-triage:<source>:<task>:autonomy`. The answer handler builds the same pair of derivations at tier `human`.

*Alternative:* one derivation whose labels span two groups. Rejected: the report and `isValidGroup` assume a derivation's labels belong to its group, and a record like "autonomy → grill-me" would mislead whoever reads the report.

### D4. The pre-write label check lives in the write path

`applyDerivations` looks up a source's labels once per invocation, through `listLabels()`, the first time that source has something to write, and only for trackers with `createsLabels`. Beads is never checked.

- **Linear:** a label is available when any scope has it.
- **GitHub:** it must be in the task's repository, the `owner/name` part of the task id.
- **A missing label:** its derivation becomes `proposed`, with the detail `<label> is missing on <source>; run --bootstrap-labels`. The step's reasons collect the missing labels, and the source keeps writing.
- **A failing `listLabels`:** it counts as a write error for that source, as a failing `addLabel` would.

The lookup also runs without `--apply`, read-only, so the dry run reports each label a tracker lacks with the same detail and previews what `--apply` would skip: the dry run is the preview of the first `--apply`, which can hold dozens of `proposal` writes. A failing `listLabels` there writes nothing and fails nothing: the source's derivations stay `proposed`, and one reason, `labels on <source> could not be listed: <error>`, joins the label notes the step's reasons collect.

Answers go through the same path. In answer mode, a derivation skipped for a missing label is mapped to `failed` with that detail, without stopping the source.

A derivation skipped this way was never attempted, so it does not put the task in the set that selection excludes as "labelled this run".

*Alternative:* check only `proposal`. Rejected: the check costs the same single call, and it also covers a newly configured GitHub repository that lacks any contract label.

*Alternative:* create the missing label. Rejected by DOT-110: the loop never creates labels implicitly.

### D5. Transition is a mode, not a step

A new module `src/transition/` holds three parts:

- the argument parser (`<source>:<task>`);
- the reader and question composer behind `--transition`, which returns an `autonomous.transition.v1` report;
- an answer handler for ids `transition:<source>:<task>`.

`answer-mode.ts` stops depending on `Step`. It routes to `AnswerHandler { id, answer }` entries, and `run.ts` passes the steps that answer plus the transition handler. The id's task part is everything after the second `:`. No tracker id contains a colon: Beads ids, Linear identifiers and GitHub `owner/name#n`.

Like answer mode, transition mode takes no run lock: it writes labels, not attempts. `args.ts` adds `--transition` as a valued flag. It requires `--apply`, may be combined with `--json` only, and is excluded with every other mode.

*Alternative:* a pipeline step. Rejected: the step would run on every run, and transition mode needs none of quota, triage or selection.

*Alternative:* reuse the triage question id with a `stage` group. Rejected: the transition removes labels, and triage answers must stay additive. Keeping the handlers separate keeps that rule visible in the code.

### D6. Transition writes in three phases, and a retry is idempotent

Given the answered autonomy `A` and the task read again (`before`):

1. Check that the tracker has `proposal` and `A`. This is the D4 lookup, done before any write.
2. Add `A` if absent and `proposal` if absent, then read back.
3. Remove `grill-me` and every autonomy label other than `A`, then read back.
4. Verify the final set equals `before` plus the added labels minus the removed ones.

A failure in step 2 leaves `grill-me` in place. A failure in step 3 can leave `grill-me` together with `proposal`, which the contract reports as a stage conflict. Both outcomes are reported as `failed` with the label sets. Answering the transition again completes it, because the task still carries `grill-me`, so steps 2 and 3 only do what is left.

### D7. The transition report reuses the run report's handoff rendering

The handoff and its text line (`handoff: <json>`) are rendered by the same functions `report.ts` uses, so `commands/run.md` reads the transition report exactly like a run report. The exit code is 0 when a handoff is emitted and 3 otherwise. A configuration that fails to load follows `modeConfig`, as answer mode and bootstrap do.

### D8. Recolouring is a tracker capability, and bootstrap gains a status

`Tracker.recolourLabel(label, colour)` is added, and `TrackerLabel` gains an optional `id`, which the Linear listing already prints.

- **Linear:** `linear api` with the mutation `issueLabelUpdate(id: $id, input: { color: $color })`, passing `--variable id=… --variable color=#…`. A response whose `success` is not true counts as a failure.
- **GitHub:** `gh label edit <name> --repo <owner/name> --color <hex without #>`.
- **Beads:** returns the not-applicable error and is never called.

Bootstrap recolours every same-name contract label whose colour differs, in each scope where it appears, and reports it with the new status `recoloured`. The bootstrap schema stays `autonomous.bootstrap.v1`, because the status is an added value and no field changes. The run report moves to v2 because it renames the group keys.

### D9. The run report becomes v2 by renaming keys only

`autonomous.run.v2` changes only names:

- the triage counts and records use `scope`, `autonomy` and `stage`;
- the selection data's `autonomy` becomes `AFK | HITL | null`, and the text shows `none`.

The command reads only `handoff`, so it is unaffected.

### D10. Helper lines follow the groups

`prepare` prints `scope:`, `autonomy:` and `stage:`.

- **Autonomy line:** it can also be `not needed (grill-me)`.
- **Stage line:** it can be `present`, `conflict`, `derived proposal (autonomy <label>)`, `derived grill-me (<evidence>)` or `follows autonomy`.
- **`--judged`:** it accepts `scope` and `autonomy`.
- **`decide`:** it prints `proposal` among the labels to apply when an `AFK` or `HITL` is applied and no stage is named.

The skill's spelling list gains `proposal`, and its wording says autonomy where it says entry. `criteria.md` is rewritten for the three groups and remains the single text that both the judgement prompt and the helper print.

## Risks / Trade-offs

- **[The first `--apply` run after the upgrade writes many labels]** The dry run of 2026-11-01 proposes 636 `proposal` writes: 613 on Beads, 22 on Linear and 1 on GitHub, because the Beads database has grown to 1140 open tasks. Rule writes are uncapped, as they are today for scope. → A run without `--apply` first lists every `proposal` it would write. Writes are additive and read back, and the stop on mismatch is per source.
- **[A transition cut short leaves `grill-me` with `proposal`]** → Reported as `failed` with both label sets. Selection excludes the task under classification, and answering the transition again finishes it (D6).
- **[`linear api` and its GraphQL shape are outside our control]** → A recolour failure is reported per label and never blocks creation. Tests use a fake exec, and the manual check runs the real mutation against one label.
- **[Some reader of `autonomous.run.v1` breaks]** → None is known: `commands/run.md` reads only `handoff`, and the schema string announces the change.
- **[The helper's output changes and the evals drift]** → The graders that name the entry group are updated, and the evals that run the helper are re-run with their results recorded.
- **[`proposal`'s colour is provisional]** → It is one constant. Recolouring in bootstrap means a later colour change also reaches existing labels.

## Migration Plan

1. Release as a `feat(autonomous):` minor. No configuration change.
2. After upgrading, run `/autonomous:run --bootstrap-labels`. It creates `proposal` and recolours differing contract labels.
3. Until then, triage reports `proposal` as missing on Linear and GitHub and keeps every other write. A transition answer fails with the same hint.
4. **Rollback:** reinstall the previous version. That version's contract ignores `proposal`, so the labels already written stay harmless, and selection ignores `proposal` tasks as before. A transition already applied is not undone automatically: re-add `grill-me` by hand if needed.
