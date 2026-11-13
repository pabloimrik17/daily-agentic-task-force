## Why

A stage leaves its work in two places today: the task's tracker (the definition and the stage summary, for the next agent) and a pushed branch that has no pull request. Nothing tells a person what each agent did, and the glossary and ADR commits of a grill reach no pull request at all. This change gives every task a draft pull request and a logbook on it: one comment per attempt, short enough to catch up on the story without reading the work. It is the first of two changes; the second, `add-proposal-stage`, adds proposal preparation on top of it.

## What Changes

- **Pull-request mode.** `--apply --pull-request <attempt-id> [--title <title>]` runs no step. Code finds the open pull request of the attempt's workspace branch and reuses it. Otherwise it pushes the branch, adding an empty commit when the branch has none ahead of the base, and opens a **draft** pull request against the repository's default branch.
    - The agent passes the title in the repository's own conventions, and code appends ` (<task id>)`. A title is required to open a pull request, and a later stage may pass one to correct it.
    - The parent of a split with no commits ahead of the base gets no pull request.
- **The cover.** The pull request's description is written by code from the task: a link to the task, a link to the parent task for a subtask, and the Problem and Solution of the definition. A task with no definition gets the first paragraph of its description, cut to 500 characters; a task with no description gets the links only. The cover is rewritten on every run of the mode.
- **Log mode.** `--apply --log <attempt-id>` runs no step. The agent writes the body of its logbook entry to `logbook-entry.md` in the attempt's directory, and code checks it, publishes it as a comment on the pull request under a header it measures itself, reads it back and writes a receipt.
    - The body has four sections: What I did, Decisions, Assumptions and Next stage. A stage may add sections of its own.
    - A body that lacks a section, has an empty What I did, exceeds 300 words or names the machine's home directory is rejected, and nothing is published.
    - The header carries the stage, the attempt number, the autonomy, the agent arguments, the start, the end and the duration, the transition answer, and the commits of the attempt.
- **The attempt records what the header needs.** The attempt record gains the agent arguments it was launched with, and an applied transition answer leaves a record in the open attempt's directory.
- **Discard leaves an entry.** Discard mode publishes a short entry written by code when the task's branch has an open pull request. A failure to publish it is a note and never fails the discard.
- **The grill-me stage adopts both.** After its transition is applied, the grill runs pull-request mode and then log mode, and only then writes the result marker. Its prompt no longer forbids a pull request. A task the human closes, and a "Later" answer, open no pull request and publish no entry.
- **Reconcile reports a missing entry.** A completed attempt whose directory holds no logbook receipt is finalised as before and reported with a note.
- **Docs.** The README covers the two modes, the cover, the entry format and the grill's new closing order. The glossary gains Logbook, Logbook entry and Cover.
- **Release.** A `feat(autonomous):` minor, with no configuration change.

**Out of scope**:

- Proposal preparation, the `implement` label and its transition, and reading a task's relations as context (`add-proposal-stage`).
- Stacked pull requests for the subtasks of a split.
- Marking a pull request ready for review, merging it or closing it.
- Closing the parent of a split when its subtasks close.
- Telemetry beyond the header: tokens, cost and tool calls.

## Capabilities

### New Capabilities

- `stage-logbook`: the pull request of a task and the logbook on it. It covers how the pull request is found or opened, its cover, the logbook entry with its header, format checks, read-back and receipt, and the entry discard mode leaves.

### Modified Capabilities

- `autonomous-run`: pull-request mode and log mode are added, with their reports, exit codes and flag rules, and an applied transition answer leaves a record in the open attempt.
- `grill-me-stage`: the closing order gains the pull request and the logbook entry, a grill's pushes may now end in a pull request, and the parent of a split opens one only when the grill committed documentation.
- `stage-sessions`: the attempt record keeps the agent arguments of its launch, and reconcile notes a completed attempt without a logbook receipt.

## Impact

- **Code** (`plugins/autonomous/src/`):
    - the new modes: `pull-request/` and `logbook/`;
    - `args.ts` and `run.ts`;
    - the attempt record and its parser: `attempts/{record,state,launch}.ts`;
    - the transition answer: `transition/answer.ts`;
    - discard and reconcile: `attempts/{discard,reconcile}.ts`;
    - the grill-me prompt: `stages/grill-me/prompt.ts`;
    - the tests next to each of these.
- **Plugin files**: `README.md`, `GLOSSARY.md`, `commands/run.md`.
- **Runtime dependencies**: `gh`, authenticated, for every source and not only GitHub tasks, and a repository whose remote is on GitHub.
- **Repositories**: a stage now opens a draft pull request and comments on it. An empty commit is added when a branch has nothing to show yet.
- **Privacy**: the cover copies part of a task's definition into the pull request, and the logbook describes the work. In a public repository both are public, as the proposal a later stage commits will be.
- **Compatibility**: attempt records written before this change have no agent arguments; they still parse, and their entries omit that part of the header.
