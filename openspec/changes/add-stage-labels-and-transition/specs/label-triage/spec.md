## MODIFIED Requirements

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

Without `--apply`, the step SHALL report every eligible label as proposed and write nothing. With `--apply`, it SHALL add each eligible label that the task's tracker has through the tracker's CLI, never replacing the task's label set, never removing a label and never adding a comment; rule-derived labels have no per-run cap. After each write it SHALL read the task back and verify its labels are a superset of the previous labels plus the added ones; on a mismatch it SHALL report the previous and current sets, stop writing to that source for the rest of the run, and continue with the other sources. Labels written during a run SHALL NOT change that run's own findings; they take effect on the next run.

#### Scenario: Default is read-only

- **WHEN** the step runs without `--apply`
- **THEN** every eligible label is reported as proposed and no CLI write is issued

#### Scenario: Additive write

- **WHEN** `--apply` is given and a Beads task with `nazaries` is eligible for `work`
- **THEN** `work` is added and `nazaries` remains

#### Scenario: Read-back mismatch

- **WHEN** after adding `personal` to a Linear task the task no longer carries a label it had before
- **THEN** the write is reported as failed with both label sets and no further Linear write happens in that run

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

Each tracker SHALL be able to remove one named label from a task through its own CLI, leaving every other label in place, and SHALL read the task back to confirm the label is gone. Label triage and its answers SHALL never use it. Only two things remove labels: the management of stage sessions, which removes `taken`, and a transition, which removes the stage it leaves and the autonomy labels its answer replaces.

#### Scenario: Remove taken on Beads

- **WHEN** `taken` is removed from a Beads task carrying `work`, `grill-me` and `taken`
- **THEN** the task carries `work` and `grill-me`

#### Scenario: Removal not confirmed

- **WHEN** the task read back still carries the label after the removal command succeeded
- **THEN** the removal is reported as failed with the labels found

#### Scenario: Triage never removes

- **WHEN** `label-triage` runs with `--apply`
- **THEN** no label removal command is issued

## ADDED Requirements

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

For a task with no autonomy and no stage label, the autonomy decision SHALL choose among `AFK`, `HITL` and `grill-me`, where `grill-me` leaves the autonomy to a grill. For a task whose stage is `proposal`, it SHALL choose between `AFK` and `HITL` only. A task in `grill-me` without an autonomy label SHALL need no autonomy decision.

#### Scenario: Task with neither

- **WHEN** a task carries `personal` only
- **THEN** its autonomy decision may be `AFK`, `HITL` or `grill-me`

#### Scenario: Task in grill-me

- **WHEN** a task carries `personal` and `grill-me`
- **THEN** no autonomy decision is requested for it

### Requirement: Labels missing on a tracker are not written

Before writing with `--apply`, the step SHALL check that the task's tracker has each label to write: Linear at workspace level or in any team, GitHub in the task's repository. Beads is never checked. A label the tracker lacks SHALL NOT be written. Its derivation SHALL be reported as proposed, naming the label and `--bootstrap-labels`. The task's other labels and the source's other writes SHALL continue.

#### Scenario: proposal not bootstrapped on Linear

- **WHEN** a run with `--apply` derives `proposal` for a Linear task and the Linear workspace has no `proposal` label
- **THEN** `proposal` is reported as proposed with a note to run `--bootstrap-labels`, and the other Linear writes of the run still happen

#### Scenario: Beads

- **WHEN** a run with `--apply` derives `proposal` for a Beads task
- **THEN** `proposal` is written without any check
