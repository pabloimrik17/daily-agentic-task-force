# Spec Delta

## ADDED Requirements

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

## MODIFIED Requirements

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
