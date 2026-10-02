# Spec Delta

## ADDED Requirements

### Requirement: Questions for the human

The step SHALL contribute one question for each group it lists for the human as asked (below the threshold, invalid under the contract, or with conflicting evidence), except the groups of tasks from a source whose writes stopped during the run. A group whose present labels are in conflict, a task not judged and a task beyond the cap SHALL NOT become a question. Questions SHALL be ordered by these keys:

1. tasks whose scope is `work` or has evidence for `work` come first;
2. then the most recently updated;
3. then by task id.

For the same task, the scope question comes before the entry question.

Each question SHALL:

- name the source, the task id and title, and the group;
- show what the run saw for the group: the labels, the tier, the confidence and the reason;
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
