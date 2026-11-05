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
5. show the ticket's URL, or its id for a Beads task;
6. run the transition;
7. write the result marker.

It SHALL forbid preparing a proposal in the same session.

#### Scenario: Commands named

- **WHEN** a grill-me prompt is written for attempt `linear:DOT-121:grill-me:1`
- **THEN** it names `/autonomous:run --apply --persist linear:DOT-121:grill-me:1` for step 4 and `/autonomous:run --apply --transition linear:DOT-121` for step 6, and says to write the marker only after the transition is applied

#### Scenario: Answer left for later

- **WHEN** the human answers "Later" to the transition question
- **THEN** the prompt's order leaves the result marker unwritten and the session open

### Requirement: The definition proposes the autonomy

The definition template SHALL carry the autonomy in a section `### Proposed autonomy`, holding the autonomy the grill proposes and its reason. The prompt SHALL say that the task's autonomy label, set by the transition, is the decision, and that the agent does not persist again when the human answers another autonomy.

#### Scenario: Template section

- **WHEN** a grill-me prompt is written
- **THEN** its definition template has the section `### Proposed autonomy`, with the placeholder `<AFK or HITL, as the grill proposes it>: <the reason>`, and no section `### Autonomy`

#### Scenario: Human answers another autonomy

- **WHEN** the definition proposes `AFK` and the human answers `HITL` to the transition question
- **THEN** the persisted description keeps `AFK` as the proposed autonomy, the labels carry `HITL`, and persist mode is not run again

### Requirement: A closed task ends the grill

When the human decides to close the task instead of defining it, the prompt SHALL tell the agent to skip persist mode and the transition, write the result marker with a summary saying the task was closed, and stop.

#### Scenario: Task closed in the grill

- **WHEN** a grill-me prompt is written
- **THEN** it tells the agent, when the human closes the task, to skip persist mode and the transition and write the result marker

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

For a GitHub task, the prompt SHALL forbid absolute paths and other details of the machine in the definition and in the stage summary, because an issue in a public repository is public, and the definition becomes its description.

#### Scenario: GitHub task

- **WHEN** a grill-me prompt is written for a GitHub task
- **THEN** it forbids absolute paths and machine details in `definition.md` and in `stage-summary.md`

#### Scenario: Linear task

- **WHEN** a grill-me prompt is written for a Linear task
- **THEN** it carries no such restriction

### Requirement: Definition layout

Persist mode SHALL write the content of `definition.md` at the top of the task's description. A line `---`, the heading `## Original description` and the original description SHALL follow it. When the description already starts with a definition in that layout, only the part above the separator SHALL be replaced. When the content of `definition.md` does not start with the heading `## Definition`, persist mode SHALL prepend that heading and a blank line to it.

#### Scenario: First grill

- **WHEN** a task's description is `Fix the login` and the definition is persisted
- **THEN** the description is the definition, then `---`, then `## Original description`, then `Fix the login`

#### Scenario: Second grill

- **WHEN** a task already carries a definition above `## Original description` and a new definition is persisted
- **THEN** the old definition is replaced and the original description below the separator is unchanged

#### Scenario: Definition without the heading

- **WHEN** `definition.md` does not start with `## Definition`, is persisted, and a new definition is then persisted over the result
- **THEN** the description starts with `## Definition` and a blank line, and the second persist replaces only the part above the separator, leaving one `## Original description`

### Requirement: Stage summary comment

Persist mode SHALL post the content of `stage-summary.md` as a comment on the task. The first line SHALL be `autonomous · grill-me · <attempt-id> · definition saved`, followed by a blank line.

#### Scenario: Comment header

- **WHEN** attempt `beads:agentic-task-x1:grill-me:1` is persisted
- **THEN** the task has a new comment whose first line is `autonomous · grill-me · beads:agentic-task-x1:grill-me:1 · definition saved`

### Requirement: Persistence is read back and leaves a receipt

After writing, persist mode SHALL read the description and comments back, waiting out read lag as the autonomous-run spec defines. It SHALL write a receipt only when the comment is found and the description read back holds the same text as the one written: the same Unicode letters and digits, in order. Whitespace and Markdown syntax SHALL be ignored and a link SHALL count as its text, because trackers re-serialise Markdown. A failed write or read-back SHALL leave no receipt.

#### Scenario: Persisted

- **WHEN** the description and the comment are written and read back as expected, the description identical to the one written apart from trailing whitespace
- **THEN** the attempt directory holds a receipt and persist mode exits 0, no `description.read.md` is written and the report carries no note

#### Scenario: Tracker re-serialises the Markdown

- **WHEN** the tracker returns the description with its `-` list markers changed to `*` and its link destinations wrapped in `<>`, and the comment is found
- **THEN** the receipt is written, persist mode exits 0, `description.read.md` holds what the tracker returned, and the report carries the note `<source> <id>: the tracker re-serialised the description; its text matches what was written, and what it returned is at <path to description.read.md>`

#### Scenario: Tracker links an identifier

- **WHEN** the definition names `DOT-110` and the tracker returns it as `[DOT-110](https://linear.app/monolab/issue/DOT-110/a-slug)`, with the rest of the text unchanged
- **THEN** the texts match, the receipt is written, persist mode exits 0, `description.read.md` holds what the tracker returned, and the report carries the re-serialised note

#### Scenario: Description read lags

- **WHEN** the first read after the description write returns the description as it was before, and a later read returns the one written
- **THEN** persist mode reads again, compares the later read, writes the receipt, and writes neither `description.read.md` nor a note

#### Scenario: Text read back differs

- **WHEN** the tracker returns a description whose letters or digits differ from the one written, or returns no description, on all six reads
- **THEN** no receipt is written and no comment is posted, `description.read.md` holds what the tracker returned, persist mode exits 3, and the reason is `<source> <id>: the description read back differs from the one written (read 6 times over 30 s); what the tracker returned is at <path to description.read.md>`

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
