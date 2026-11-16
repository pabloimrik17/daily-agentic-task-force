# Spec Delta

## MODIFIED Requirements

### Requirement: Proposal prerequisites

The stage's prerequisites SHALL hold only when the configured tool is `claude`, the task's repository holds an OpenSpec root and provides the propose workflow, as the skill `openspec-propose` or the command `/opsx:propose`, the `openspec` CLI can be run, and the `handoff` skill of the `mattpocock-skills` plugin is found as the grill-me stage finds its skills. Each failure SHALL give its own reason, naming what is missing. Nothing SHALL initialise OpenSpec in a repository.

#### Scenario: Codex configured

- **WHEN** `sessions.tool` is `codex`
- **THEN** the prerequisites fail with a reason naming the tool, and nothing else is checked

#### Scenario: Repository without OpenSpec

- **WHEN** the task's repository has no `openspec` directory
- **THEN** the prerequisites fail with a reason naming the repository and the missing OpenSpec root, and no file is created in the repository

#### Scenario: Repository on OpenSpec 2

- **WHEN** the task's repository has `.claude/skills/openspec-propose/` as a link to `.agents/skills/openspec-propose/` and no `.claude/commands/opsx/`
- **THEN** the propose workflow is found as the skill `openspec-propose`

#### Scenario: Neither form

- **WHEN** the task's repository has an OpenSpec root but neither the skill `openspec-propose` nor the command `/opsx:propose`
- **THEN** the prerequisites fail with a reason naming both forms and telling the human to update OpenSpec in that repository

#### Scenario: CLI missing

- **WHEN** the `openspec` command is not found
- **THEN** the prerequisites fail with a reason naming the command

#### Scenario: Everything present

- **WHEN** the tool is `claude`, the repository has an OpenSpec root, the CLI runs and the skill is found
- **THEN** the prerequisites hold

### Requirement: The proposal prompt

The prompt SHALL hold the shared frame, a Context section rendered from what the run read, the body of the `handoff` skill, and the stage's instructions. The instructions SHALL tell the agent to prepare the proposal by running the propose workflow with the task and its context, named as the repository provides it: the skill `openspec-propose` when it exists, the command `/opsx:propose` otherwise, to let OpenSpec name the change, to write exactly one proposal without splitting the task, and to edit no project code. When the workspace branch already has an open pull request, the prompt SHALL name it.

#### Scenario: Context in the prompt

- **WHEN** a proposal prompt is written for a task whose context holds two comments and a blocker
- **THEN** the prompt's Context section holds both comments in order and the blocker's id, title, state and URL

#### Scenario: Empty context

- **WHEN** the task has no comment and no relation
- **THEN** the Context section says so, and no empty list is rendered

#### Scenario: Large proposal

- **WHEN** a proposal prompt is written
- **THEN** it tells the agent to say when the proposal is too large for one task, and still to write one proposal and create no subtask

#### Scenario: Pull request already open

- **WHEN** the workspace branch has an open pull request when the prompt is written
- **THEN** the prompt names that pull request and tells the agent to continue it

#### Scenario: Skill named

- **WHEN** a proposal prompt is written for a repository that has both the skill `openspec-propose` and the command `/opsx:propose`
- **THEN** every mention of the workflow in the prompt names the skill, and none names `/opsx:propose`

#### Scenario: Command named

- **WHEN** a proposal prompt is written for a repository that has only the command `/opsx:propose`
- **THEN** every mention of the workflow in the prompt names `/opsx:propose`
