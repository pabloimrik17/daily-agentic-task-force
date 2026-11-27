# label-triage Specification

## Purpose

Finds the tasks in Linear, Beads and GitHub that lack a label group of the label contract, derives the missing labels by rule or by a confidence-gated judgement, writes the ones it is allowed to, and reports the rest for a human to decide.

## Requirements

### Requirement: Read the open tasks of every enabled source

The step SHALL read, through each tracker's own CLI, every task that is not closed: Linear across all teams excluding completed, canceled and duplicate states; Beads from the configured directory with status open or in progress; GitHub issues in state open from each configured repository. Each CLI's output SHALL be validated strictly before use. A CLI that is missing, not authenticated, exits non-zero, exceeds 120 s or prints output that fails validation SHALL make the step `not-evaluable`, with a reason naming the source and the command; the step SHALL NOT evaluate the remaining sources partially.

#### Scenario: CLI missing

- **WHEN** `bd` cannot be executed
- **THEN** the outcome is `not-evaluable` and the reason names Beads and `bd`

#### Scenario: Unauthenticated Linear CLI

- **WHEN** `linear` reports missing credentials
- **THEN** the outcome is `not-evaluable` and the reason names Linear and `linear auth login`

#### Scenario: All sources readable

- **WHEN** the three CLIs return valid output
- **THEN** every open task of every enabled source is considered

### Requirement: Detect missing groups and conflicts per task

For every task read, the step SHALL determine, per group of the label contract, whether the group is present, missing or in conflict, and SHALL report counts per source and per group. Alias labels and structural rules count as evidence, not as presence.

#### Scenario: Legacy label only

- **WHEN** a Beads task carries `nazaries` and nothing else
- **THEN** it is reported as missing the scope, autonomy and stage groups, with `nazaries` as evidence for `work`

#### Scenario: Complete task

- **WHEN** a task carries `personal`, `HITL` and `proposal`
- **THEN** it is not listed as untagged

#### Scenario: Grill without autonomy

- **WHEN** a task carries `personal` and `grill-me`
- **THEN** it is not listed as untagged

### Requirement: Derive labels by rule first, then by judgement

For a missing group, the step SHALL first apply the contract's evidence: a structural rule or an alias yields the corresponding label with confidence 1 and tier `code`. When the scope or autonomy group has no evidence, the step SHALL obtain a judgement from an LLM run in print mode with a JSON schema, given the task's title, description, existing labels and source, and returning per group the labels, a confidence between 0 and 1 and a one-sentence reason, at tier `llm`. The stage group SHALL never be judged. A group whose evidence conflicts SHALL NOT be judged and SHALL be listed for the human with the conflicting evidence. Judgements SHALL be requested in batches of the configured size, for at most the configured number of tasks per run, taking tasks with `work` evidence first and then the most recently updated; tasks beyond the cap SHALL be reported as a count. A judgement whose output is missing, invalid or that names a label outside the contract SHALL be discarded for that task and reported; the outcome of the step is not affected. The model and effort used SHALL be reported.

#### Scenario: Scope by structural rule

- **WHEN** a Linear task lacks a scope label and the configuration makes Linear `personal`
- **THEN** `personal` is derived with confidence 1 and reason naming the rule

#### Scenario: Entry by judgement

- **WHEN** a task lacks an autonomy label and a stage label, and no evidence decides its autonomy
- **THEN** the LLM is asked and its autonomy decision, confidence and reason are recorded for that task

#### Scenario: Conflicting evidence

- **WHEN** a task's alias evidence and a structural rule point to different scopes
- **THEN** the scope group is listed for the human with both pieces of evidence and no judgement is requested for it

#### Scenario: Cap reached

- **WHEN** 60 tasks need a judgement and the cap is 25
- **THEN** 25 are judged in the configured order and 35 are reported as remaining

#### Scenario: Judgement unavailable

- **WHEN** the LLM call fails or returns output that does not match the schema
- **THEN** the affected tasks are reported as not judged and the outcome is unchanged

### Requirement: Confidence threshold per group

A derived group SHALL be eligible for writing only when its confidence is at or above the configured threshold (0.95 in the shipped example) and its labels are valid under the contract: exactly one scope label, exactly one autonomy decision that the task's stage allows, no label outside the vocabulary. Each group is evaluated independently. A group below the threshold or invalid SHALL be listed for the human with the labels seen, the confidence and the reason. Every `AFK` derived by judgement SHALL be shown with its confidence.

#### Scenario: One group above, one below

- **WHEN** scope is derived by rule and autonomy by judgement at 0.8
- **THEN** scope is eligible and autonomy is listed for the human

#### Scenario: Invalid judgement

- **WHEN** the judgement returns both `AFK` and `HITL` at 0.99
- **THEN** the autonomy group is listed for the human as a conflict, not written

#### Scenario: Grill judged for a task in proposal

- **WHEN** a task carries `proposal` and no autonomy label, and the judgement returns `grill-me` at 0.99
- **THEN** the autonomy group is listed for the human as invalid, not written

### Requirement: Write only with --apply, additively, with read-back

Without `--apply`, the step SHALL report every eligible label as proposed and write nothing. With `--apply`, it SHALL add each eligible label that the task's tracker has through the tracker's CLI, never replacing the task's label set, never removing a label other than `triage-me` and never adding a comment; rule-derived labels have no per-run cap. After each write it SHALL read the task back and verify its labels are a superset of the previous labels plus the added ones; on a mismatch it SHALL report the previous and current sets, stop writing to that source for the rest of the run, and continue with the other sources. Labels written during a run SHALL NOT change that run's own findings; they take effect on the next run.

#### Scenario: Default is read-only

- **WHEN** the step runs without `--apply`
- **THEN** every eligible label is reported as proposed and no CLI write is issued

#### Scenario: Additive write

- **WHEN** `--apply` is given and a Beads task with `nazaries` is eligible for `work`
- **THEN** `work` is added and `nazaries` remains

#### Scenario: Read-back mismatch

- **WHEN** after adding `personal` to a Linear task the task no longer carries a label it had before
- **THEN** the write is reported as failed with both label sets and no further Linear write happens in that run

### Requirement: The step never blocks the run

When every enabled source was read, the outcome SHALL be `advance`, whatever was found or written. The step SHALL never return `wait`.

#### Scenario: Tasks left for the human

- **WHEN** ten tasks are listed for the human and nothing was written
- **THEN** the outcome is `advance`

### Requirement: Triage report

The text report SHALL show, per source, the counts of tasks read, complete, missing per group and in conflict; then one line per derived label in the form `source → task → labels → reason`, marked applied or proposed, with the tier and, for a judgement, its confidence; then the tasks listed for the human with the labels seen and the reason; then the judgement remainder and any write failure. The JSON data of the step SHALL carry the same information, including one record per derived group with source, task id, title, group, labels, confidence, reason, tier and status (`applied`, `proposed`, `asked`, `failed`), so an error rate can be computed later from reports alone.

#### Scenario: Applied line

- **WHEN** `work` was added to Beads task `X-12` by rule from `nazaries`
- **THEN** the report contains a line naming Beads, `X-12`, `work`, tier `code` and the alias, marked applied

#### Scenario: JSON record

- **WHEN** the run is invoked with `--json`
- **THEN** the step's data lists every derived group with its status, confidence and reason

### Requirement: Questions for the human

The step SHALL contribute one question for each group it lists for the human as asked (below the threshold, invalid under the contract, or with conflicting evidence), except the groups of tasks from a source whose writes stopped during the run. A group whose present labels are in conflict, a task not judged and a task beyond the cap SHALL NOT become a question. Questions SHALL be ordered by these keys:

1. tasks whose scope is `work` or has evidence for `work` come first;
2. then the most recently updated;
3. then by task id.

For the same task, the scope question comes before the autonomy question.

Each question SHALL:

- name the source, the task id and title, and the group;
- show what the run saw for the group: the task's labels, the labels this run has already written to the task, the group's labels, the tier, the confidence when the tier is a judgement, and the reason;
- include the first 300 characters of the task's description when the run read it;
- offer the group's options in the contract's order, each described by its meaning, plus one option labelled `Later` whose value is null: for scope, `work` and `personal`; for autonomy, `AFK` and `HITL`, and `grill-me` only when the task has no stage label;
- prefix the description of each option the judgement chose with its confidence and reason, without moving the option;
- accept a single choice;
- use the task id as its header when the id has at most 12 characters, and the group name otherwise;
- carry an id that names the step, the source, the task and the group.

#### Scenario: Judgement below the threshold

- **WHEN** a run with `--apply` judges `HITL` at 0.80 for the autonomy group of a Beads task with no stage label
- **THEN** its question offers `AFK`, `HITL`, `grill-me` and `Later` in that order, and the description of `HITL` begins with `judged 0.80 ·` and the judgement's reason

#### Scenario: Task already in proposal

- **WHEN** the autonomy group of a task carrying `proposal` is asked
- **THEN** its question offers `AFK`, `HITL` and `Later`, and no `grill-me`

#### Scenario: Scope with conflicting evidence

- **WHEN** a task's alias `nazaries` and the structural rule `personal` disagree on its scope
- **THEN** its question offers `work`, `personal` and `Later`, and shows both pieces of evidence

#### Scenario: Scope written in the same run

- **WHEN** a run with `--apply` writes `work` to a Beads task through its alias `nazaries` and leaves its autonomy group for the human
- **THEN** the autonomy question shows the task's labels as `nazaries` plus `work` written by this run

#### Scenario: Present labels in conflict

- **WHEN** a task carries both `work` and `personal`
- **THEN** it is listed for the human and no question is contributed for it

#### Scenario: Source whose writes stopped

- **WHEN** a read-back mismatch stops the writes to Linear during the run
- **THEN** no question is contributed for any Linear task

#### Scenario: Order

- **WHEN** one asked task has `work` evidence and was updated yesterday, and another is `personal` and was updated today
- **THEN** the question for the `work` task comes first

#### Scenario: Header

- **WHEN** questions are contributed for Linear task `DOT-104` and for Beads task `agentic-task-8v0`
- **THEN** their headers are `DOT-104` and the name of the asked group, respectively

### Requirement: Apply answers to triage questions

The step SHALL apply an answer to one of its questions only when three conditions hold:

- the answer names an enabled source;
- its labels are options of the question's group and are valid under the contract for the task's stage;
- the task, read again through its tracker, still has that group missing, and for a `grill-me` answer still has no stage label.

An answer of `AFK` or `HITL` to the autonomy question of a task without a stage label SHALL also write `proposal`; an answer of `grill-me` SHALL write only `grill-me`. An answer that names an unknown or disabled source, an unknown group, or labels that fail that check SHALL be `rejected`, with the reason. An answer whose task now has the group present or in conflict, or a stage label for a `grill-me` answer, SHALL be `skipped`, naming the labels found, and nothing SHALL be written for it. An answer whose task cannot be read SHALL be `failed`, with the command that failed.

An applied answer SHALL be written through the same additive write, read-back and per-source stop as the step's own writes, and a label the tracker lacks SHALL make the answer `failed`, naming the label and `--bootstrap-labels`, without stopping the source. A write error or a read-back mismatch SHALL make that answer `failed`, with the label sets, and SHALL stop further answers to that source in the same invocation. The answer SHALL take precedence over the evidence and the judgement the run had for that group. It SHALL NOT be remembered for later runs. Whether the task is still open SHALL NOT be checked.

#### Scenario: Answer applied

- **WHEN** the user answers `HITL` to the autonomy question of Beads task `X-12`, which still has no autonomy and no stage label
- **THEN** `HITL` and `proposal` are added, the task's other labels remain, the task is read back, and the answer is reported as `applied`

#### Scenario: Grill chosen

- **WHEN** the user answers `grill-me` to the autonomy question of a task that still has no stage label
- **THEN** only `grill-me` is added and the answer is reported as `applied`

#### Scenario: Grill chosen after a stage was set

- **WHEN** the user answers `grill-me` and the task now carries `proposal`
- **THEN** the answer is reported as `skipped`, naming `proposal`, and nothing is written

#### Scenario: Group labelled in the meantime

- **WHEN** the task already carries `AFK` when the answer is applied
- **THEN** the answer is reported as `skipped`, naming `AFK`, and nothing is written

#### Scenario: Label from another group

- **WHEN** the answer to an autonomy question is `work`
- **THEN** it is reported as `rejected` and nothing is written

#### Scenario: Answer against the evidence

- **WHEN** a scope question arose from alias `nazaries` conflicting with the structural rule `personal`, and the user answers `work`
- **THEN** `work` is added and `nazaries` remains

#### Scenario: Read-back mismatch

- **WHEN** after adding `HITL` to a Linear task the task no longer carries a label it had before
- **THEN** that answer is reported as `failed` with both label sets, and no further Linear answer is written in that invocation

### Requirement: Trackers can remove a label

Each tracker SHALL be able to remove one named label from a task through its own CLI, leaving every other label in place, and SHALL read the task back to confirm the label is gone. Label triage and its answers SHALL use it only to remove `triage-me`. Only three things remove labels: the management of stage sessions, which removes `taken`; a transition, which removes the stage it leaves and the autonomy labels its answer replaces; and label triage, which removes `triage-me`.

#### Scenario: Remove taken on Beads

- **WHEN** `taken` is removed from a Beads task carrying `work`, `grill-me` and `taken`
- **THEN** the task carries `work` and `grill-me`

#### Scenario: Removal not confirmed

- **WHEN** the task read back still carries the label after the removal command succeeded
- **THEN** the removal is reported as failed with the labels found

#### Scenario: Triage never removes

- **WHEN** `label-triage` runs with `--apply` and no task it reads carries `triage-me`
- **THEN** no label removal command is issued

#### Scenario: Triage removes only the triage label

- **WHEN** `label-triage` runs with `--apply` and removes `triage-me` from a complete task
- **THEN** no label removal command is issued for any other label

### Requirement: The stage follows the autonomy

A missing stage SHALL be derived as `proposal`, with confidence 1 and tier `code`, when the task carries an autonomy label or one is eligible for writing in the same run. When the autonomy decision is `grill-me`, the stage SHALL be `grill-me` and no autonomy is written. A missing stage SHALL never be judged or asked on its own: while the autonomy is undecided, the stage stays missing.

#### Scenario: Stage by rule

- **WHEN** a task carries `work` and `AFK` and no stage label
- **THEN** `proposal` is derived with confidence 1, tier `code`, and a reason naming `AFK`

#### Scenario: Stage after a rule-derived autonomy

- **WHEN** a Beads task carrying `work` and the alias `human` for `HITL` has no autonomy and no stage label
- **THEN** `HITL` and `proposal` are both derived with confidence 1

#### Scenario: Grill decided by judgement

- **WHEN** a task with no autonomy and no stage label is judged `grill-me` at 0.97
- **THEN** `grill-me` is eligible and no autonomy label and no `proposal` are derived

#### Scenario: Autonomy left for the human

- **WHEN** a task with no autonomy and no stage label is judged `AFK` at 0.8
- **THEN** neither `AFK` nor `proposal` is written, and the autonomy group is listed for the human

### Requirement: The autonomy decision depends on the stage

For a task with no autonomy and no stage label, the autonomy decision SHALL choose among `AFK`, `HITL` and `grill-me`, where `grill-me` leaves the autonomy to a grill. For a task that carries any other stage label, it SHALL choose between `AFK` and `HITL` only. A task in `grill-me` without an autonomy label SHALL need no autonomy decision.

#### Scenario: Task with neither

- **WHEN** a task carries `personal` only
- **THEN** its autonomy decision may be `AFK`, `HITL` or `grill-me`

#### Scenario: Task in grill-me

- **WHEN** a task carries `personal` and `grill-me`
- **THEN** no autonomy decision is requested for it

#### Scenario: Task in implement

- **WHEN** a task carries `personal` and `implement`
- **THEN** its autonomy decision may be `AFK` or `HITL`, and never `grill-me`

#### Scenario: Task in verify

- **WHEN** a task carries `work` and `verify`
- **THEN** its autonomy decision may be `AFK` or `HITL`, and never `grill-me`

#### Scenario: Task in code-review

- **WHEN** a task carries `personal` and `code-review`
- **THEN** its autonomy decision may be `AFK` or `HITL`, and never `grill-me`

#### Scenario: Task in external-review

- **WHEN** a task carries `personal` and `external-review`
- **THEN** its autonomy decision may be `AFK` or `HITL`, and never `grill-me`

#### Scenario: Task in a stage with no implementation

- **WHEN** a task carries `personal` and `external-review`
- **THEN** its autonomy decision may be `AFK` or `HITL`, and never `grill-me`

### Requirement: Labels missing on a tracker are not written

Before writing, the step SHALL check that the task's tracker has each label to write: Linear at workspace level or in any team, GitHub in the task's repository. Beads is never checked. The check SHALL run with and without `--apply`, previewing what `--apply` would skip. A label the tracker lacks SHALL NOT be written. Its derivation SHALL be reported as proposed, naming the label and `--bootstrap-labels`. The task's other labels and the source's other writes SHALL continue.

#### Scenario: proposal not bootstrapped on Linear

- **WHEN** a run with `--apply` derives `proposal` for a Linear task and the Linear workspace has no `proposal` label
- **THEN** `proposal` is reported as proposed with a note to run `--bootstrap-labels`, and the other Linear writes of the run still happen

#### Scenario: Dry run reports a missing label

- **WHEN** a run without `--apply` derives `proposal` for a Linear task and Linear lacks `proposal`
- **THEN** the derivation is reported as proposed with the detail naming `--bootstrap-labels`, and nothing is written

#### Scenario: Beads

- **WHEN** a run with `--apply` derives `proposal` for a Beads task
- **THEN** `proposal` is written without any check

### Requirement: A failing label listing without --apply is a reason

When the step cannot list a tracker's labels in a run without `--apply`, it SHALL report one reason naming the source and the error, leave that tracker's derivations proposed and report no failure.

#### Scenario: Dry run with a failing listing

- **WHEN** a run without `--apply` cannot list the labels of Linear
- **THEN** the Linear derivations are reported as proposed without a note, a reason says the Linear labels could not be listed, and nothing fails

### Requirement: Mark the tasks left for the human

A task SHALL be marked when it carries `triage-me`. With `--apply`, the step SHALL add `triage-me` to every unmarked task for which this run lists a scope or autonomy group for the human as asked. It SHALL add it after the task's other writes, through the same additive write, read-back and per-source stop. Without `--apply` it SHALL report the mark as proposed and write nothing.

#### Scenario: Doubt in a run with apply

- **WHEN** a run with `--apply` judges `HITL` at 0.80 for the autonomy group of an unmarked Beads task
- **THEN** `triage-me` is added to the task, its other labels remain, and the group is listed for the human

#### Scenario: Doubt in an iteration of the loop

- **WHEN** an iteration of a loop started with `--apply` leaves the scope group of a GitHub task for the human
- **THEN** `triage-me` is added to the task and the iteration carries no handoff

#### Scenario: Run without apply

- **WHEN** a run without `--apply` leaves the autonomy group of a task for the human
- **THEN** the mark is reported as proposed and no write is issued

#### Scenario: One group written, one in doubt

- **WHEN** a run with `--apply` writes `work` by rule to a task and judges its autonomy at 0.70
- **THEN** the task gains `work` and `triage-me`

### Requirement: Doubts that are not marked

The step SHALL NOT mark a task only because its present labels conflict, because it was not judged, or because it is beyond the judgement cap. It SHALL NOT mark a task of a source whose writes stopped during the run. When the tracker lacks `triage-me`, the mark SHALL NOT be written and SHALL be reported as proposed, naming the label and `--bootstrap-labels`; the task's other writes SHALL continue.

#### Scenario: Present labels in conflict

- **WHEN** a task carries both `AFK` and `HITL` and no other group is in doubt
- **THEN** `triage-me` is not added

#### Scenario: Judgement unavailable

- **WHEN** the LLM call fails for a task that lacks an autonomy label
- **THEN** `triage-me` is not added and a later run judges the task

#### Scenario: Label not bootstrapped

- **WHEN** a run with `--apply` leaves a doubt on a Linear task and Linear has no `triage-me` label
- **THEN** the mark is reported as proposed with a note to run `--bootstrap-labels`, and the run's other Linear writes still happen

### Requirement: A marked task is not judged

The step SHALL NOT request a judgement for a marked task, and a marked task SHALL NOT count against the cap of judged tasks. Rules and aliases SHALL still be applied to a marked task, and what they derive SHALL be eligible and written as for any other task.

#### Scenario: Second run

- **WHEN** a run finds a task that carries `personal` and `triage-me` and no autonomy or stage label
- **THEN** no judgement is requested for it

#### Scenario: Cap

- **WHEN** 30 unmarked tasks and 10 marked tasks need an autonomy decision and the cap is 25
- **THEN** 25 unmarked tasks are judged, 5 are reported as remaining, and no marked task is judged or counted

#### Scenario: Rule on a marked task

- **WHEN** a marked task that lacked an autonomy and a stage label now carries `AFK`, added by a person
- **THEN** `proposal` is derived by rule with confidence 1 and is eligible for writing

### Requirement: Questions of marked tasks

A missing scope or autonomy group of a marked task that no rule or alias decides SHALL be listed for the human as asked, with tier `marked`, no confidence and a reason that names `triage-me`. It SHALL become a question under the same rules, order and form as every other asked group. The question SHALL show the tier `marked` and no confidence, and no option SHALL carry a judgement prefix.

#### Scenario: Listed without a judgement

- **WHEN** a run finds a task that carries `personal` and `triage-me` and no autonomy or stage label
- **THEN** its autonomy group is listed for the human with tier `marked` and no confidence

#### Scenario: Question without a judgement

- **WHEN** a run with `--apply` finds a marked Beads task with no autonomy and no stage label
- **THEN** its question offers `AFK`, `HITL`, `grill-me` and `Later` in that order, shows the tier `marked`, and no option begins with `judged`

#### Scenario: Order among old and new doubts

- **WHEN** a marked task with `work` evidence and an unmarked `personal` task judged in this run are both asked
- **THEN** the question for the `work` task comes first

### Requirement: Remove the mark from a complete task

A task SHALL be complete when it has a scope label and either an autonomy label with a stage label or the stage `grill-me`, and no group in conflict, counting the labels this run wrote to it. With `--apply`, the step SHALL remove `triage-me` from a marked task that is complete, after the run's additive writes to that task succeeded. Without `--apply` it SHALL report the removal as proposed. A marked task that is not complete SHALL keep the label.

#### Scenario: Label added by the person

- **WHEN** a run with `--apply` finds a task that carries `personal`, `HITL`, `proposal` and `triage-me`
- **THEN** `triage-me` is removed and nothing else is removed

#### Scenario: Completed by a rule in the same run

- **WHEN** a run with `--apply` finds a task that carries `work`, `AFK` and `triage-me`, and writes `proposal` to it by rule
- **THEN** `triage-me` is removed in that run

#### Scenario: Still in doubt

- **WHEN** a marked task carries `work` and no autonomy or stage label
- **THEN** `triage-me` stays

### Requirement: A failed removal of the mark

The step SHALL remove `triage-me` through the tracker's label removal, with its read-back. A removal that is not confirmed SHALL be reported as failed with the labels found, SHALL leave the outcome of the step unchanged and SHALL NOT stop the source.

#### Scenario: Removal not confirmed

- **WHEN** the task read back still carries `triage-me` after the removal command succeeded
- **THEN** the removal is reported as failed with the labels found and the outcome is `advance`

### Requirement: An answer removes the mark

After an answer to a triage question is applied, the step SHALL remove `triage-me` from the task when the task carried it and, read back, is complete as "Remove the mark from a complete task" defines. The answer SHALL be reported as `applied` whether or not the removal succeeded; a removal that is not confirmed SHALL be named in the answer's detail. An answer of `Later`, and an answer that is `skipped`, `rejected` or `failed`, SHALL leave the label.

#### Scenario: Answer that completes the task

- **WHEN** the user answers `HITL` to the autonomy question of a task that carries `personal` and `triage-me`
- **THEN** `HITL` and `proposal` are added, `triage-me` is removed, and the answer is reported as `applied`

#### Scenario: Answer that leaves another doubt

- **WHEN** the user answers `work` to the scope question of a marked task that also lacks an autonomy label
- **THEN** `work` is added and `triage-me` stays

#### Scenario: Later

- **WHEN** the user chooses `Later` for the question of a marked task
- **THEN** nothing is written and `triage-me` stays

### Requirement: Marks in the triage report

The text report SHALL show, after the derived labels, one line per task marked or unmarked by this run, in the form `source → task → triage-me`, as `marked`, `unmarked`, or `proposed` for either, and the count of tasks that carried `triage-me` when the run read them. The JSON data of the step SHALL carry the same lists and count. A record of a group listed with tier `marked` SHALL have status `asked`.

#### Scenario: Newly marked

- **WHEN** a run with `--apply` adds `triage-me` to Linear task `DOT-130`
- **THEN** the report has a line naming Linear, `DOT-130` and `triage-me`, as marked

#### Scenario: Marks in JSON

- **WHEN** the run is invoked with `--json`
- **THEN** the step's data lists the tasks marked, the tasks unmarked and the count of marked tasks read
