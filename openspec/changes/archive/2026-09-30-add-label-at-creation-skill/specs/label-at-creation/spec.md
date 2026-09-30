# Spec Delta

## Purpose

Applies the label contract when a task is created in Linear, Beads or GitHub. The creating session sets one label from each group at creation time, with the same meaning and threshold the triage step uses, and asks the user for what it is not sure about, without ever blocking creation.

## ADDED Requirements

### Requirement: When the skill applies

The `autonomous` plugin SHALL provide a skill that a session loads when it is about to create an issue or task in Linear, Beads or GitHub, whatever tool it uses for the write (the tracker's CLI or an MCP server). The skill SHALL NOT apply to other tracker operations: reading, editing or relabelling an existing task, commenting, closing, or opening a pull request.

#### Scenario: Beads task requested

- **WHEN** the user asks the session to create a Beads task
- **THEN** the skill is loaded before the task is created

#### Scenario: Pull request requested

- **WHEN** the user asks the session to open a pull request for the current branch
- **THEN** the skill is not loaded

#### Scenario: Comment on an existing issue

- **WHEN** the user asks the session to comment on an existing Linear issue
- **THEN** the skill is not loaded

### Requirement: Creation is never blocked or altered

The skill SHALL only add labels to a creation the session performs anyway. It SHALL NOT decide whether a task is created or in which tracker, SHALL NOT change the task's title, description, parent or any field other than its labels, and SHALL NOT prevent or postpone the creation beyond asking the user about labels.

#### Scenario: Nothing is certain and nobody can answer

- **WHEN** no group reaches the threshold and the session cannot ask the user
- **THEN** the task is still created, with the fields the session intended and no contract label it was not confident about

### Requirement: One source for meaning and threshold

The skill SHALL judge labels against the criteria text that the `label-triage` judgement prompt embeds, received verbatim from the helper, and SHALL NOT restate the meanings of the labels in its own words. The confidence threshold SHALL be the `judgement.threshold` of the user configuration, applied by the helper, never a value written in the skill.

#### Scenario: Criteria edited

- **WHEN** the criteria file changes
- **THEN** the triage judgement prompt and the text the skill receives both carry the new wording, without editing the skill

#### Scenario: Threshold changed

- **WHEN** the configuration's `judgement.threshold` is changed from 0.95 to 0.9
- **THEN** a judgement at 0.92 is applied at creation, as it would be by the triage step

### Requirement: Helper reports the state of each group

The plugin SHALL provide a helper, run with `bun`, whose `prepare` mode takes the tracker (`linear`, `beads` or `github`), the repository for GitHub, and the labels the task will carry at creation, whether named by the user or inherited from a parent task. It SHALL print the criteria text, then one entry per group: present, derived from evidence (the labels and the evidence that gives them), in conflict, or to be judged. Evidence SHALL come from the contract's aliases and structural rules in the user configuration. A GitHub structural rule SHALL apply only to the repositories listed in the configuration. For any other repository, the helper SHALL derive no structural evidence and SHALL say that the contract labels may not exist there.

#### Scenario: Linear with a structural rule

- **WHEN** the configuration makes every Linear task `personal` and a Linear task is about to be created with no labels
- **THEN** scope is reported as derived `personal` by that rule, and entry as to be judged

#### Scenario: Unconfigured GitHub repository

- **WHEN** a GitHub issue is about to be created in a repository missing from the configured list, whose rule makes GitHub `personal`
- **THEN** scope is reported as to be judged, and the output says the contract labels may not exist in that repository

#### Scenario: Labels named by the user

- **WHEN** the user asks for a task labelled `HITL`
- **THEN** entry is reported as present with `HITL`

#### Scenario: Labels inherited from a parent

- **WHEN** a Beads task is about to be created under a parent that carries `work` and `AFK`, and Beads will copy those labels to it
- **THEN** both groups are reported as present

#### Scenario: Both scopes named

- **WHEN** the labels the task will carry include `work` and `personal`
- **THEN** scope is reported in conflict

### Requirement: Helper decides what to apply and what to ask

The helper's `decide` mode SHALL take the same inputs plus the creating agent's judgement for each group, as labels and a confidence between 0 and 1. It SHALL print the labels to apply and, for every other group, the group to ask about with its labels and a reason. A group SHALL be applied when it is present and valid, when it is derived from evidence, or when it is judged at or above the threshold and valid under the contract. A group SHALL be asked about when:

- it is judged below the threshold;
- it is invalid: two scope labels, `AFK` with `HITL`, or a label outside the group;
- it is in conflict;
- it is to be judged but no judgement was given;
- its judgement disagrees with its evidence.

Each group SHALL be decided independently.

#### Scenario: Confident entry

- **WHEN** entry is judged `AFK` at 0.97 and the threshold is 0.95
- **THEN** `AFK` is in the labels to apply

#### Scenario: Entry below threshold

- **WHEN** entry is judged `AFK` at 0.8 and the threshold is 0.95
- **THEN** entry is asked about, with a reason naming the threshold and the confidence

#### Scenario: Invalid judgement

- **WHEN** entry is judged `AFK` and `HITL` at 0.99
- **THEN** entry is asked about as invalid under the contract, and neither label is applied

#### Scenario: Judgement disagrees with evidence

- **WHEN** Linear is `personal` by structural rule and the agent judges scope `work` at 0.99
- **THEN** scope is asked about, with both the evidence and the judgement in the reason

#### Scenario: One group applied, one asked

- **WHEN** scope is derived by rule and entry is judged at 0.6
- **THEN** the scope label is applied and entry is asked about

### Requirement: Missing configuration degrades to asking

When the user configuration cannot be loaded, both helper modes SHALL still print the criteria text and a decision, and SHALL name the configuration path and the error. With no configuration, the helper SHALL derive no evidence, SHALL apply no judged label, and SHALL list every group that is not present and valid as a group to ask about.

#### Scenario: No configuration file

- **WHEN** no file exists at the configuration path and the user named `personal` for a new task
- **THEN** `personal` is applied, entry is asked about, and the output names the missing path

### Requirement: Judgement by the creating agent

For every group the helper reports as to be judged, the creating agent SHALL judge it from the whole conversation together with the task's intended title and description. It SHALL answer with labels from that group only and a confidence that is its honest probability of being right. Labels the user names explicitly SHALL be passed to the helper as labels the task will carry, in the contract's spelling, and SHALL NOT be judged again. A near-miss such as `Grill Me` SHALL be written as `grill-me`.

#### Scenario: Near-miss spelling from the user

- **WHEN** the user asks for a Linear issue tagged `Grill Me`
- **THEN** the issue is created with `grill-me` and without `Grill Me`

### Requirement: Asking the user, or leaving groups to triage

When the helper returns groups to ask about and the session can ask the user, the skill SHALL ask before the create call. It SHALL ask one question per group, offering that group's labels and the helper's reason, and SHALL check the answer through the helper before using it. When the session cannot ask the user (print mode, a subagent, a scheduled loop), it SHALL create the task with the labels to apply only. Its reply SHALL name each group left out and why, so that the `label-triage` step labels it later.

#### Scenario: Interactive session

- **WHEN** entry is to be asked about in an interactive session
- **THEN** the user is asked for the entry label before the task is created, and the answer is applied if valid

#### Scenario: Session that cannot ask

- **WHEN** entry is to be asked about in a session without an interactive user
- **THEN** the task is created with the scope label only, and the reply says that entry was left for triage and why

### Requirement: Labels are written in the create call

The labels to apply SHALL be set in the create call itself, through the label option of the tool the session uses (`bd create --labels`, `gh issue create --label`, `linear issue create --label`, or the labels field of a Linear MCP create), never by a separate write afterwards. The skill SHALL NOT create, rename or remove labels on a tracker. When a tracker rejects the creation because a label does not exist there, the skill SHALL create the task again without the rejected labels. The reply SHALL name the rejected labels and say that `/autonomous:run --bootstrap-labels` creates them, for a GitHub repository only once it is in the configuration.

#### Scenario: Beads task with both groups

- **WHEN** a Beads task is created with `work` and `AFK` to apply
- **THEN** a single `bd create` call carries both labels

#### Scenario: Label missing on a GitHub repository

- **WHEN** `gh issue create --label personal` fails because the repository has no `personal` label
- **THEN** the issue is created without it, no label is created, and the reply points to `--bootstrap-labels`

#### Scenario: Several tasks at once

- **WHEN** the session creates three Beads tasks in one request
- **THEN** each task gets its own decision, and each `bd create` call carries that task's labels
