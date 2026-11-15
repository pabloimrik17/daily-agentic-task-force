# Spec Delta

## MODIFIED Requirements

### Requirement: The grill-me closing order

The prompt SHALL tell the agent to end the stage in this order:

1. confirm the definition and any split with the human;
2. commit and push documentation;
3. write `definition.md` and `stage-summary.md`, and create subtasks;
4. run persist mode;
5. show the ticket's URL, or its id when the ticket has no URL;
6. run the transition;
7. run pull-request mode, with a title in the repository's conventions;
8. write `logbook-entry.md` and run log mode, unless pull-request mode reported that the task needs no pull request;
9. write the result marker.

It SHALL forbid preparing a proposal in the same session.

#### Scenario: Commands named

- **WHEN** a grill-me prompt is written for attempt `linear:DOT-121:grill-me:1`
- **THEN** it names `/autonomous:run --apply --persist linear:DOT-121:grill-me:1` for step 4, `/autonomous:run --apply --transition linear:DOT-121` for step 6, `/autonomous:run --apply --pull-request linear:DOT-121:grill-me:1 --title` for step 7 and `/autonomous:run --apply --log linear:DOT-121:grill-me:1` for step 8, and says to write the marker only after the entry is published

#### Scenario: Answer left for later

- **WHEN** the human answers "Later" to the transition question
- **THEN** the prompt's order leaves the pull request unopened, the entry unpublished, the result marker unwritten and the session open

#### Scenario: Entry rejected

- **WHEN** log mode rejects the body
- **THEN** the prompt's instructions have the agent correct `logbook-entry.md` and run log mode again before writing the marker

#### Scenario: Entry body described

- **WHEN** a grill-me prompt is written
- **THEN** it gives the path of `logbook-entry.md`, the four required sections, the limit of 300 words, and says that each decision is marked as the agent's or the human's and that Next stage links the task's stage summary without repeating it

### Requirement: A closed task ends the grill

When the human decides to close the task instead of defining it, the prompt SHALL tell the agent to skip persist mode, the transition, pull-request mode and log mode, write the result marker with a summary saying the task was closed, and stop.

#### Scenario: Task closed in the grill

- **WHEN** a grill-me prompt is written
- **THEN** it tells the agent, when the human closes the task, to skip persist mode, the transition, the pull request and the logbook entry, and write the result marker

### Requirement: A grill's commits and pushes

The prompt SHALL let the agent commit and push only the glossary and ADR files the grill changed, on the workspace branch. The agent's own commits and pushes SHALL use no force push and no skipped hooks, and happen only when such files changed. The agent SHALL open no pull request itself: the pull request is opened only by pull-request mode. A failed push, the agent's or the mode's, SHALL be reported to the human, who decides whether the stage continues.

#### Scenario: No documentation changed

- **WHEN** the grill changed no glossary or ADR file
- **THEN** the prompt's instructions lead to no commit and no push by the agent, and pull-request mode alone pushes the branch

#### Scenario: Push rejected by a hook

- **WHEN** the pre-push hook rejects the push
- **THEN** the agent tells the human, and continues only as the human decides

### Requirement: A split creates subtasks

When the human confirms a split, the prompt SHALL have the agent create each subtask through the `labelling-new-tasks` skill as a native subtask of the task in the same tracker. Each subtask carries its own definition in its description and its own autonomy. The parent SHALL keep the overall definition and go through its own transition and pull-request mode, which opens a pull request for it only when the grill committed documentation.

#### Scenario: Beads split

- **WHEN** the human confirms splitting a Beads task in two
- **THEN** the prompt's instructions create two Beads subtasks with the task as parent, each labelled through `labelling-new-tasks`, and the parent is still persisted and transitioned

#### Scenario: Split without documentation changes

- **WHEN** the human confirms a split and the grill changed no glossary or ADR file
- **THEN** pull-request mode reports that the parent needs no pull request, and the agent writes the result marker without a logbook entry
