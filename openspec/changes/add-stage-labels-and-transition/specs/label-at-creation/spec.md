## MODIFIED Requirements

### Requirement: Helper reports the state of each group

The plugin SHALL provide a helper, run with `bun`, whose `prepare` mode takes the tracker (`linear`, `beads` or `github`), the repository for GitHub, and the labels the task will carry at creation, whether named by the user or inherited from a parent task. It SHALL print the criteria text, then one entry per group of the contract: present, derived from evidence (the labels and the evidence that gives them), in conflict, or to be judged. The stage SHALL be reported as derived `proposal` when the autonomy is present or derived, and as following the autonomy judgement when the autonomy is to be judged; a task that will carry `grill-me` needs no autonomy judgement. Evidence SHALL come from the contract's aliases and structural rules in the user configuration. A GitHub structural rule SHALL apply only to the repositories listed in the configuration. For any other repository, the helper SHALL derive no structural evidence and SHALL say that the contract labels may not exist there.

#### Scenario: Linear with a structural rule

- **WHEN** the configuration makes every Linear task `personal` and a Linear task is about to be created with no labels
- **THEN** scope is reported as derived `personal` by that rule, autonomy as to be judged, and stage as following the autonomy

#### Scenario: Unconfigured GitHub repository

- **WHEN** a GitHub issue is about to be created in a repository missing from the configured list, whose rule makes GitHub `personal`
- **THEN** scope is reported as to be judged, and the output says the contract labels may not exist in that repository

#### Scenario: Labels named by the user

- **WHEN** the user asks for a task labelled `HITL`
- **THEN** autonomy is reported as present with `HITL`, and stage as derived `proposal`

#### Scenario: Labels inherited from a parent

- **WHEN** a Beads task is about to be created under a parent that carries `work` and `AFK`, and Beads will copy those labels to it
- **THEN** scope and autonomy are reported as present, and stage as derived `proposal`

#### Scenario: Grill named by the user

- **WHEN** the user asks for a task labelled `grill-me`
- **THEN** stage is reported as present with `grill-me`, and autonomy needs no judgement

#### Scenario: Both scopes named

- **WHEN** the labels the task will carry include `work` and `personal`
- **THEN** scope is reported in conflict

### Requirement: Helper decides what to apply and what to ask

The helper's `decide` mode SHALL take the same inputs plus the creating agent's judgement for each group to be judged, as labels and a confidence between 0 and 1. It SHALL print the labels to apply and, for every other group, the group to ask about with its labels and a reason. A group SHALL be applied when it is present and valid, when it is derived from evidence, or when it is judged at or above the threshold and valid under the contract. An applied `AFK` or `HITL` SHALL bring `proposal` with it when no stage label is named; an applied `grill-me` judgement SHALL apply `grill-me` only. A group SHALL be asked about when:

- it is judged below the threshold;
- it is invalid: two labels of one group, a label outside the group, or `grill-me` judged for a task that will carry a stage label;
- it is in conflict;
- it is to be judged but no judgement was given;
- its judgement disagrees with its evidence.

Each group SHALL be decided independently, except that the stage follows the autonomy.

#### Scenario: Confident entry

- **WHEN** autonomy is judged `AFK` at 0.97, the threshold is 0.95 and no stage label is named
- **THEN** `AFK` and `proposal` are in the labels to apply

#### Scenario: Entry below threshold

- **WHEN** autonomy is judged `AFK` at 0.8 and the threshold is 0.95
- **THEN** autonomy is asked about, with a reason naming the threshold and the confidence, and `proposal` is not applied

#### Scenario: Invalid judgement

- **WHEN** autonomy is judged `AFK` and `HITL` at 0.99
- **THEN** autonomy is asked about as invalid under the contract, and neither label is applied

#### Scenario: Grill judged

- **WHEN** autonomy is judged `grill-me` at 0.97 and no stage label is named
- **THEN** `grill-me` is applied, and no autonomy label and no `proposal`

#### Scenario: Judgement disagrees with evidence

- **WHEN** Linear is `personal` by structural rule and the agent judges scope `work` at 0.99
- **THEN** scope is asked about, with both the evidence and the judgement in the reason

#### Scenario: One group applied, one asked

- **WHEN** scope is derived by rule and autonomy is judged at 0.6
- **THEN** the scope label is applied and autonomy is asked about

### Requirement: Missing configuration degrades to asking

When the user configuration cannot be loaded, both helper modes SHALL still print the criteria text and a decision, and SHALL name the configuration path and the error. With no configuration, the helper SHALL derive no evidence, SHALL apply no judged label, and SHALL list as a group to ask about every scope or autonomy group that is not present and valid, and a stage group in conflict. A missing stage SHALL NOT be asked about on its own: it follows the autonomy.

#### Scenario: No configuration file

- **WHEN** no file exists at the configuration path and the user named `personal` for a new task
- **THEN** `personal` is applied, autonomy is asked about, the stage is not asked about, and the output names the missing path

### Requirement: Asking the user, or leaving groups to triage

When the helper returns groups to ask about and the session can ask the user, the skill SHALL ask before the create call. It SHALL ask one question per group, offering that group's labels and the helper's reason, and SHALL check the answer through the helper before using it. When the session cannot ask the user (print mode, a subagent, a scheduled loop), it SHALL create the task with the labels to apply only. Its reply SHALL name each group left out and why, so that the `label-triage` step labels it later.

#### Scenario: Interactive session

- **WHEN** autonomy is to be asked about in an interactive session
- **THEN** the user is asked for the autonomy before the task is created, and the answer is applied if valid

#### Scenario: Session that cannot ask

- **WHEN** autonomy is to be asked about in a session without an interactive user
- **THEN** the task is created with the scope label only, and the reply says that autonomy was left for triage and why

### Requirement: Labels are written in the create call

The labels to apply SHALL be set in the create call itself, through the label option of the tool the session uses (`bd create --labels`, `gh issue create --label`, `linear issue create --label`, or the labels field of a Linear MCP create), never by a separate write afterwards. The skill SHALL NOT create, rename or remove labels on a tracker. When a tracker rejects the creation because a label does not exist there, the skill SHALL create the task again without the rejected labels. The reply SHALL name the rejected labels and say that `/autonomous:run --bootstrap-labels` creates them, for a GitHub repository only once it is in the configuration.

#### Scenario: Beads task with both groups

- **WHEN** a Beads task is created with `work`, `AFK` and `proposal` to apply
- **THEN** a single `bd create` call carries the three labels

#### Scenario: Label missing on a GitHub repository

- **WHEN** `gh issue create --label personal` fails because the repository has no `personal` label
- **THEN** the issue is created without it, no label is created, and the reply points to `--bootstrap-labels`

#### Scenario: Several tasks at once

- **WHEN** the session creates three Beads tasks in one request
- **THEN** each task gets its own decision, and each `bd create` call carries that task's labels
