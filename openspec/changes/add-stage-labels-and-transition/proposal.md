## Why

The label contract still keeps `AFK`, `HITL` and `grill-me` in one `entry` group. This mixes two kinds of label: autonomy is a property of the task, and the stage says where the task is. The ADR 0001 model (properties persist, stages replace) was agreed in the DOT-104 grill but never implemented, so nothing marks a task whose autonomy is decided as ready for proposal preparation, and nothing moves a task out of `grill-me` when its grill ends.

Linear DOT-110, a sub-issue of DOT-82, is delivered as two changes. This first change provides everything the grill-me stage, the second change, builds on: the stage labels, the `proposal` label that a grill ends in, and the scripted transition that a grill session runs at its end.

## What Changes

- **Three label groups.**
    - `entry` is replaced by `autonomy` (`AFK` | `HITL`) and `stage` (`grill-me` | `proposal`), in the contract, the criteria text, the judgement schema, detection, triage, the creation helper and the selection step.
    - Scope and autonomy are properties, kept for the life of a task. Every task has exactly one stage label.
    - Autonomy may be absent only while the stage is `grill-me`. Two stage labels are a conflict left for the human.
    - `HITL` with `grill-me` stays valid: the autonomy was decided ahead of the grill.
- **The `proposal` label.** It is the stage of every task whose autonomy is decided, and the stage a grill ends in. Its colour is `#bb87fc`, and it gets a meaning in the contract.
- **Triage derives the stage.**
    - A task with an autonomy label and no stage label gets `proposal` by rule (tier code, confidence 1).
    - For a task with neither, the autonomy decision, by rule, judgement or question, offers `AFK`, `HITL` or `grill-me` ("decide it in a grill"). `AFK` or `HITL` also writes `proposal`; `grill-me` writes only the stage.
    - The autonomy question offers `grill-me` only when the task has no stage label.
- **Triage never writes a label the tracker lacks.** Before writing, the triage step and its answers check that the tracker has each label. A missing one is not written, the task's other writes continue, and the report says to run `--bootstrap-labels`. Upgrading therefore needs no manual step to keep a run working, and the loop still never creates a label.
- **Bootstrap creates `proposal` and recolours.** It creates the new label like every other one and recolours every contract label whose colour differs from the contract, reporting each one it recoloured. Linear recolours through `linear api` (GraphQL `issueLabelUpdate`), because `linear-cli` 2.6.0 has no label update. GitHub recolours through `gh label edit --color`. Beads has no colours. Bootstrap never touches other labels, never renames and never deletes.
- **Selection reads the stage label.**
    - The next stage of a task is its stage label.
    - A task without one, or without autonomy outside `grill-me`, is excluded under classification.
    - The selected work unit's autonomy is `AFK`, `HITL` or none.
- **Transition mode.**
    - `--apply --transition <source>:<task>` runs no step. It reads the task and emits a handoff with one question, the autonomy, with the task's current value marked.
    - The answer goes through answer mode: it adds the chosen autonomy and `proposal`, then removes `grill-me` and every other autonomy label, and reads the task back. Labels are added before any is removed.
    - "Later" writes nothing. A task not in `grill-me` gets a report, no handoff, and exit code 3. The transition does not ask for scope.
    - This is the first exception to "the loop never removes a label". Triage and its answers stay additive.
- **Run report v2.** `autonomous.run.v2` carries the new group names in the triage and selection data. The transition has its own report, `autonomous.transition.v1`.
- **Glossary and docs.**
    - `plugins/autonomous/GLOSSARY.md` gains the terms agreed in the DOT-110 grill (Task, Grill, Definition, Non-goals, Stage summary, Split, Subtask, Scope label), and its note that the split is not implemented goes.
    - The plugin README and `commands/run.md` describe the three groups, `proposal`, recolouring and transition mode.
    - The helper's evals are updated and re-run.
- **Release.** A `feat(autonomous):` minor, with no breaking change. The configuration format is unchanged, and the label check above keeps an un-bootstrapped tracker from stopping a source.

**Out of scope**:

- The grill-me stage itself: its registration, stage prompt, persistence script, completion check and the receipt that gates the transition. That is change 2 of DOT-110.
- Reading GitHub sub-issues or blockers (change 2 and DOT-121).
- Any stage after `proposal`, and the rest of the stage vocabulary.
- Creating labels from the loop, and correcting labels other than through a transition.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `label-contract`:
    - The groups become scope, autonomy and stage.
    - `proposal` gets a meaning, a spelling and a colour.
    - The validity and completeness rules change.
    - A transition replaces the stage label: the first exception to the never-remove rule.
    - Bootstrap creates `proposal` and recolours differing contract labels.
- `label-triage`:
    - Stage is derived by rule from autonomy.
    - The autonomy decision offers `grill-me` when the task has no stage label.
    - Writes, both the step's and its answers', skip labels the tracker lacks.
    - Questions and answers use the new groups.
    - The label-removal requirement names the transition.
- `label-at-creation`: the helper reports and decides the three groups, deriving the stage from the autonomy, and its output lines change from `entry:` to `autonomy:` and `stage:`.
- `work-selection`:
    - The next stage comes from the stage label.
    - Classification uses the new completeness rule.
    - The selected unit's autonomy may be none.
- `autonomous-run`:
    - The run report becomes `autonomous.run.v2`.
    - Transition mode is added, with its report and exit codes.
    - Answer mode routes transition answers.
    - The flags that cannot combine with `--transition` are listed.

## Impact

- **Code** (`plugins/autonomous/src/`):
    - Label contract and bootstrap: `label-contract/{contract,detect,bootstrap}.ts`.
    - Triage: `label-triage/{criteria.md,judgement,rules,decide,write,questions,answer,render,step}.ts`.
    - Linear and GitHub trackers: `label-triage/trackers/{linear,github}.ts`, which gain recolouring.
    - Creation helper: `label-at-creation/{check,cli}.ts`.
    - Selection: `select/{stage,candidates,types,render}.ts`.
    - Run: `args.ts`, `run.ts`, `report.ts`, `answer-mode.ts`, and a new transition module.
    - The tests next to each of these.
- **Plugin files**:
    - `commands/run.md`, so the relay also covers the transition report.
    - `skills/labelling-new-tasks/SKILL.md`, whose spelling list gains `proposal`.
    - The eval graders that name the entry group.
    - `README.md` and `GLOSSARY.md`.
- **Trackers**: none until a user runs `--bootstrap-labels`, which creates `proposal` on Linear and on the configured GitHub repositories and recolours any differing contract label. After the upgrade, the first `--apply` run adds `proposal` to every open task that has an autonomy label and no stage label. The dry run of 2026-11-01 proposes 636 `proposal` writes: 613 on Beads, 22 on Linear and 1 on GitHub.
- **Dependencies**: none new. Recolouring needs `linear-cli` with `linear api` (2.6.0) and `gh` with `gh label edit`.
