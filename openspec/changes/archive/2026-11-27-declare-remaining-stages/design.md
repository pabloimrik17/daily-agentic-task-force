## Context

The stage a task is in is known in two places: the stage label on the tracker, read through the label contract (`STAGE_LABELS`), and the stage of each attempt record in the local state, validated against `STAGE_IDS`. A third list, the registry (`STAGES`), holds the stages with an implementation, and a fourth, selection's supported stages, the ones a run may pick. A build that lacks a name in either of the first two cannot read what a build that has it wrote.

## Goals / Non-Goals

**Goals:** a released build starts and behaves sensibly beside a development build of any planned stage, on the same state directory and trackers.

**Non-Goals:** any behaviour for the new stages; robustness against stages nobody has planned.

## Decisions

### D1. Declare the stages instead of tolerating unknown ones

The stage labels and the stage ids are extended; the registry and selection's supported stages are not. An unknown label cannot be told from any label outside the contract, so the labels must be declared whatever is done about records, and declaring the ids fixes the records with the same mechanism.

Alternative considered: read a record of an unknown stage and ignore it. It covers stages with no name yet, but only the records, and an open attempt the build cannot interpret would not count towards the slots.

### D2. `ready-to-merge` is a label without a stage id

The label contract's stage group and the stage ids already differ (`test` is an id with no label). `ready-to-merge` is the reverse: the label where a task rests between the end of wrap-up and the merge a person does. No session ever runs for it, so no attempt record can name it, and keeping it out of `STAGE_IDS` keeps `Record<StageId, …>` tables free of an entry that could never be used.

It assumes wrap-up does not merge. If the design of wrap-up decides otherwise, the label is removed from the contract.

### D3. No transition rows

The transition table keeps its four rows. A row out of a stage with no implementation would move a task past work nobody did, with no persistence receipt and no guard to check. A person who needs it changes the label by hand.

### D4. Order and colours

`STAGE_ORDER` follows ADR 0007 (verification, code review, QA), then external review, wrap-up and `ready-to-merge`. "Most advanced stage first" only ranks candidates, and none of the new labels can be one. `external-review` keeps `#8b5e3c`, the colour the code review branch chose and created on the trackers, so the bootstrap recolours nothing; the other three are new and distinct from every contract colour.

### D5. Reconcile only observes an attempt of a stage with no implementation

A build cannot check a stage it has no implementation for, so the proofs of such an attempt never hold in it. Left to the usual rules, it would retain the attempt once the session ends, and a retained attempt is never finalised, so the build that runs the stage could not finish it. Reconcile observes such an attempt instead, whatever its session reports, and leaves retaining and finalising to the build that implements the stage.

Trade-off: an attempt its own build abandoned stays `started`, keeping `taken` and its slot, until the user discards it, as a retained one would.

## Risks / Trade-offs

- A declared label that its stage's design later renames or drops leaves a label to remove from the contract and the trackers → accepted: it is a small edit, and the names come from the glossary and ADR 0007 except `wrap-up` and `ready-to-merge`, defined in this task's grill.
- The code review branch conflicts on the two lists → resolved in its rebase; the lists agree on `code-review` and `external-review`.
- Until the bootstrap runs, a transition into a new label fails on a tracker that lacks it → no released build writes these labels, and `--bootstrap-labels` is run on the user's go-ahead after the release.
