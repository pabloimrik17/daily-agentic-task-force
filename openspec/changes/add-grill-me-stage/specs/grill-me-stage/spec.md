## Purpose

The grill-me stage: a managed session in which an agent refines a task with the human, persists the confirmed definition and a stage summary in the task's own tracker, and ends with the transition to `proposal`.

## ADDED Requirements

### Requirement: The grill-me stage

A stage `grill-me` with emoji 🔥 SHALL be registered. It SHALL run only with the `claude` session tool, with the agent arguments `--model opus --effort high`. A selected `grill-me` work unit, or one supplied with `--task … --stage grill-me`, SHALL be launched like any registered stage.

#### Scenario: Selected grill-me unit

- **WHEN** selection picks Linear `DOT-121` for its `grill-me` stage and every launch precondition holds
- **THEN** a managed session is created with `--model opus --effort high` and titled `auto 🔥 <name> (DOT-121)`

#### Scenario: Supplied grill-me unit

- **WHEN** the run is invoked with `--apply --task beads:<id> --stage grill-me`
- **THEN** the arguments are accepted and `launch` launches the grill-me stage for that task

### Requirement: Grill-me prerequisites

Before launch writes anything, the stage SHALL check three things. The configured session tool is `claude`. Claude Code's plugin registry lists the `mattpocock-skills` plugin. Its `grill-with-docs` and `handoff` skills are found by name under the plugin's install path, whatever their version or category directory. A failed check SHALL be a reason naming what is missing.

#### Scenario: Codex configured

- **WHEN** `sessions.tool` is `codex` and a grill-me unit is launched
- **THEN** `launch` waits with a reason saying that grill-me runs only with `claude`, and nothing is written

#### Scenario: Plugin not installed

- **WHEN** the plugin registry has no `mattpocock-skills` entry
- **THEN** `launch` waits with a reason naming the plugin

#### Scenario: Skill missing

- **WHEN** the installed plugin has `grill-with-docs` but no `handoff` skill
- **THEN** `launch` waits with a reason naming `handoff`

#### Scenario: New plugin version

- **WHEN** the plugin is updated and its skills move to another version directory
- **THEN** the skills are still found through the install path the registry gives

### Requirement: The grill-me prompt inlines the skills

The prompt file SHALL contain, after the shared frame, the bodies of the installed `grill-with-docs` and `handoff` skills without their frontmatter, read at launch. It SHALL tell the agent to write the handoff document to `stage-summary.md` in the attempt directory instead of the temporary directory.

#### Scenario: Skill bodies in the prompt

- **WHEN** a grill-me session is launched
- **THEN** its prompt file contains the body of each installed skill and none of their frontmatter

#### Scenario: Handoff redirected

- **WHEN** a grill-me prompt is written
- **THEN** it names the absolute path of `stage-summary.md` in the attempt directory as the place for the handoff document

### Requirement: The grill-me closing order

The prompt SHALL tell the agent to end the stage in this order:

1. confirm the definition and any split with the human;
2. commit and push documentation;
3. write `definition.md` and `stage-summary.md`, and create subtasks;
4. run persist mode;
5. show the ticket's URL;
6. run the transition;
7. write the result marker.

It SHALL forbid preparing a proposal in the same session.

#### Scenario: Commands named

- **WHEN** a grill-me prompt is written for attempt `linear:DOT-121:grill-me:1`
- **THEN** it names `/autonomous:run --apply --persist linear:DOT-121:grill-me:1` for step 4 and `/autonomous:run --apply --transition linear:DOT-121` for step 6, and says to write the marker only after the transition is applied

#### Scenario: Answer left for later

- **WHEN** the human answers "Later" to the transition question
- **THEN** the prompt's order leaves the result marker unwritten and the session open

### Requirement: A grill's commits and pushes

The prompt SHALL let the agent commit and push only the glossary and ADR files the grill changed, on the workspace branch. Commits and pushes SHALL use no pull request, no force push and no skipped hooks, and happen only when such files changed. A failed push SHALL be reported to the human, who decides whether the stage continues.

#### Scenario: No documentation changed

- **WHEN** the grill changed no glossary or ADR file
- **THEN** the prompt's instructions lead to no commit and no push

#### Scenario: Push rejected by a hook

- **WHEN** the pre-push hook rejects the push
- **THEN** the agent tells the human, and continues only as the human decides

### Requirement: A split creates subtasks

When the human confirms a split, the prompt SHALL have the agent create each subtask through the `labelling-new-tasks` skill as a native subtask of the task in the same tracker. Each subtask carries its own definition in its description and its own autonomy. The parent SHALL keep the overall definition and go through its own transition.

#### Scenario: Beads split

- **WHEN** the human confirms splitting a Beads task in two
- **THEN** the prompt's instructions create two Beads subtasks with the task as parent, each labelled through `labelling-new-tasks`, and the parent is still persisted and transitioned

### Requirement: Public GitHub summaries

For a GitHub task, the prompt SHALL forbid absolute paths and other details of the machine in the stage summary, because an issue in a public repository is public.

#### Scenario: GitHub task

- **WHEN** a grill-me prompt is written for a GitHub task
- **THEN** it forbids absolute paths and machine details in `stage-summary.md`

#### Scenario: Linear task

- **WHEN** a grill-me prompt is written for a Linear task
- **THEN** it carries no such restriction

### Requirement: Definition layout

Persist mode SHALL write the content of `definition.md` at the top of the task's description. A line `---`, the heading `## Original description` and the original description SHALL follow it. When the description already starts with a definition in that layout, only the part above the separator SHALL be replaced.

#### Scenario: First grill

- **WHEN** a task's description is `Fix the login` and the definition is persisted
- **THEN** the description is the definition, then `---`, then `## Original description`, then `Fix the login`

#### Scenario: Second grill

- **WHEN** a task already carries a definition above `## Original description` and a new definition is persisted
- **THEN** the old definition is replaced and the original description below the separator is unchanged

### Requirement: Stage summary comment

Persist mode SHALL post the content of `stage-summary.md` as a comment on the task. The first line SHALL be `autonomous · grill-me · <attempt-id> · definition saved`, followed by a blank line.

#### Scenario: Comment header

- **WHEN** attempt `beads:agentic-task-x1:grill-me:1` is persisted
- **THEN** the task has a new comment whose first line is `autonomous · grill-me · beads:agentic-task-x1:grill-me:1 · definition saved`

### Requirement: Persistence is read back and leaves a receipt

After writing, persist mode SHALL read the task's description and comments back. It SHALL write a receipt in the attempt directory only when the description matches what was written and the comment is found. A failed write or read-back SHALL leave no receipt.

#### Scenario: Persisted

- **WHEN** the description and the comment are written and read back as expected
- **THEN** the attempt directory holds a receipt and persist mode exits 0

#### Scenario: Comment write fails

- **WHEN** the description was written and posting the comment fails
- **THEN** no receipt is written and persist mode exits 3, naming the command that failed

### Requirement: Grill-me completion

The stage's completion check SHALL hold when the task carries `proposal`, no `grill-me` and an autonomy label. It SHALL also hold when the task is closed in its tracker: Beads `closed`, GitHub closed, or a Linear completed or canceled state.

#### Scenario: Transitioned

- **WHEN** the task carries `personal`, `AFK` and `proposal`
- **THEN** the check holds

#### Scenario: Transition not applied

- **WHEN** the task still carries `grill-me`
- **THEN** the check does not hold

#### Scenario: Task closed by the human

- **WHEN** the human closed the task in Linear as canceled
- **THEN** the check holds
