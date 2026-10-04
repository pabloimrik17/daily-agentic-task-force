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
- **THEN** it is reported as missing both groups, with `nazaries` as evidence for `work`

#### Scenario: Complete task

- **WHEN** a task carries `personal` and `HITL`
- **THEN** it is not listed as untagged

### Requirement: Derive labels by rule first, then by judgement

For a missing group, the step SHALL first apply the contract's evidence: a structural rule or an alias yields the corresponding label with confidence 1 and tier `code`. When a group has no evidence, the step SHALL obtain a judgement from an LLM run in print mode with a JSON schema, given the task's title, description, existing labels and source, and returning per group the labels, a confidence between 0 and 1 and a one-sentence reason, at tier `llm`. A group whose evidence conflicts SHALL NOT be judged and SHALL be listed for the human with the conflicting evidence. Judgements SHALL be requested in batches of the configured size, for at most the configured number of tasks per run, taking tasks with `work` evidence first and then the most recently updated; tasks beyond the cap SHALL be reported as a count. A judgement whose output is missing, invalid or that names a label outside the contract SHALL be discarded for that task and reported; the outcome of the step is not affected. The model and effort used SHALL be reported.

#### Scenario: Scope by structural rule

- **WHEN** a Linear task lacks a scope label and the configuration makes Linear `personal`
- **THEN** `personal` is derived with confidence 1 and reason naming the rule

#### Scenario: Entry by judgement

- **WHEN** a task lacks an entry label and no evidence decides it
- **THEN** the LLM is asked and its labels, confidence and reason are recorded for that task

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

A derived group SHALL be eligible for writing only when its confidence is at or above the configured threshold (0.95 in the shipped example) and its labels are valid under the contract: exactly one scope label, no `AFK` together with `HITL`, no label outside the vocabulary. Each group is evaluated independently. A group below the threshold or invalid SHALL be listed for the human with the labels seen, the confidence and the reason. Every `AFK` derived by judgement SHALL be shown with its confidence.

#### Scenario: One group above, one below

- **WHEN** scope is derived by rule and entry by judgement at 0.8
- **THEN** scope is eligible and entry is listed for the human

#### Scenario: Invalid judgement

- **WHEN** the judgement returns both `AFK` and `HITL` at 0.99
- **THEN** the entry group is listed for the human as a conflict, not written

### Requirement: Write only with --apply, additively, with read-back

Without `--apply`, the step SHALL report every eligible label as proposed and write nothing. With `--apply`, it SHALL add each eligible label through the tracker's CLI, never replacing the task's label set, never removing a label and never adding a comment; rule-derived labels have no per-run cap. After each write it SHALL read the task back and verify its labels are a superset of the previous labels plus the added ones; on a mismatch it SHALL report the previous and current sets, stop writing to that source for the rest of the run, and continue with the other sources. Labels written during a run SHALL NOT change that run's own findings; they take effect on the next run.

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

For the same task, the scope question comes before the entry question.

Each question SHALL:

- name the source, the task id and title, and the group;
- show what the run saw for the group: the task's labels, the labels this run has already written to the task, the group's labels, the tier, the confidence when the tier is a judgement, and the reason;
- include the first 300 characters of the task's description when the run read it;
- offer the group's contract labels in the contract's order, each described by its meaning, plus one option labelled `Later` whose value is null;
- prefix the description of each option the judgement chose with its confidence and reason, without moving the option;
- accept a single choice;
- use the task id as its header when the id has at most 12 characters, and the group name otherwise;
- carry an id that names the step, the source, the task and the group.

#### Scenario: Judgement below the threshold

- **WHEN** a run with `--apply` judges `HITL` at 0.80 for the entry group of a Beads task
- **THEN** its question offers `AFK`, `HITL`, `grill-me` and `Later` in that order, and the description of `HITL` begins with `judged 0.80 ·` and the judgement's reason

#### Scenario: Scope with conflicting evidence

- **WHEN** a task's alias `nazaries` and the structural rule `personal` disagree on its scope
- **THEN** its question offers `work`, `personal` and `Later`, and shows both pieces of evidence

#### Scenario: Scope written in the same run

- **WHEN** a run with `--apply` writes `work` to a Beads task through its alias `nazaries` and leaves its entry group for the human
- **THEN** the entry question shows the task's labels as `nazaries` plus `work` written by this run

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
- its labels all belong to the question's group and are valid under the contract;
- the task, read again through its tracker, still has that group missing.

An answer that names an unknown or disabled source, an unknown group, or labels that fail that check SHALL be `rejected`, with the reason. An answer whose task now has the group present or in conflict SHALL be `skipped`, naming the labels found, and nothing SHALL be written for it. An answer whose task cannot be read SHALL be `failed`, with the command that failed.

An applied answer SHALL be written through the same additive write, read-back and per-source stop as the step's own writes. A write error or a read-back mismatch SHALL make that answer `failed`, with the label sets, and SHALL stop further answers to that source in the same invocation. The answer SHALL take precedence over the evidence and the judgement the run had for that group. It SHALL NOT be remembered for later runs. Whether the task is still open SHALL NOT be checked.

#### Scenario: Answer applied

- **WHEN** the user answers `HITL` to the entry question of Beads task `X-12`, which still has no entry label
- **THEN** `HITL` is added, the task's other labels remain, the task is read back, and the answer is reported as `applied`

#### Scenario: Group labelled in the meantime

- **WHEN** the task already carries `AFK` when the answer is applied
- **THEN** the answer is reported as `skipped`, naming `AFK`, and nothing is written

#### Scenario: Label from another group

- **WHEN** the answer to an entry question is `work`
- **THEN** it is reported as `rejected` and nothing is written

#### Scenario: Answer against the evidence

- **WHEN** a scope question arose from alias `nazaries` conflicting with the structural rule `personal`, and the user answers `work`
- **THEN** `work` is added and `nazaries` remains

#### Scenario: Read-back mismatch

- **WHEN** after adding `HITL` to a Linear task the task no longer carries a label it had before
- **THEN** that answer is reported as `failed` with both label sets, and no further Linear answer is written in that invocation
