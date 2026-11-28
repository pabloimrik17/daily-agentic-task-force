# Spec Delta

## ADDED Requirements

### Requirement: Repository prerequisites of a stage

A stage MAY declare repository prerequisites: checks that read only the repository, never the task or its tracker. `select` SHALL use them to exclude tasks, and they SHALL also hold as part of the stage's prerequisites that `launch` checks. A stage that declares none SHALL have none checked.

#### Scenario: OpenSpec stages

- **WHEN** the repository of a task in `proposal`, `implement`, `verify` or `code-review` has no OpenSpec root
- **THEN** the stage's repository prerequisites fail with a reason naming the repository and the missing OpenSpec root

#### Scenario: Stage with no repository prerequisites

- **WHEN** the `test` or the `grill-me` stage is asked for its repository prerequisites
- **THEN** they hold without any check

#### Scenario: Supplied task in a repository that fails them

- **WHEN** a task is supplied with `--task` for `proposal` and its repository has no OpenSpec root
- **THEN** `launch` waits with the same reason, and nothing is written

### Requirement: Prerequisites that cannot be read

A stage's prerequisites SHALL tell a check that cannot read what it needs (a file that cannot be read or parsed, a command that cannot run, a tracker, pull request or git read that fails) apart from a check that read and found the prerequisite missing. `launch` SHALL wait with the reason in both cases.

#### Scenario: Plugin registry cannot be read

- **WHEN** the plugin registry under the home of a `grill-me` task's session cannot be read
- **THEN** the prerequisites fail as unreadable with the read error, and `launch` waits with that reason

#### Scenario: Skill missing from a readable registry

- **WHEN** the plugin registry is read and the plugin that holds a required skill is not installed
- **THEN** the prerequisites fail, not as unreadable

#### Scenario: OpenSpec CLI cannot run

- **WHEN** `openspec --version` cannot run for a task in `proposal`
- **THEN** the prerequisites fail as unreadable

### Requirement: Launch never tries another task

When a precondition of `launch` fails, the step SHALL wait with that reason and SHALL NOT choose, read or launch any other task. Every precondition of `launch` SHALL stay in force whatever `select` checked.

#### Scenario: Attempt opened between select and launch

- **WHEN** `select` chose a task and an attempt of that task is open when `launch` reads the records
- **THEN** `launch` waits with the attempt's reason, and the run launches nothing
