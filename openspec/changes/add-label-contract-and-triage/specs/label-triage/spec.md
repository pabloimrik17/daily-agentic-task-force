# Spec Delta

## Purpose

Finds the tasks in Linear, Beads and GitHub that lack a label group of the label contract, derives the missing labels by rule or by a confidence-gated judgement, writes the ones it is allowed to, and reports the rest for a human to decide.

## ADDED Requirements

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

A derived group SHALL be eligible for writing only when its confidence is at or above the configured threshold (0.95 unless configured) and its labels are valid under the contract: exactly one scope label, no `AFK` together with `HITL`, no label outside the vocabulary. Each group is evaluated independently. A group below the threshold or invalid SHALL be listed for the human with the labels seen, the confidence and the reason. Every `AFK` derived by judgement SHALL be shown with its confidence.

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
