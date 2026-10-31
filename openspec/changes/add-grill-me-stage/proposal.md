## Why

Selection already picks `grill-me` work units, but launch waits on them with "stage grill-me has no implementation". A task that needs refining therefore never reaches the human through the loop. Linear DOT-110 delivers the first executable stage in two changes. Change 1 (`add-stage-labels-and-transition`) added the stage labels, `proposal` and `--transition`. This change registers the grill-me stage on top of it: a managed session that grills the human, persists the confirmed definition and a stage summary in the task's own tracker, and ends with the transition.

## What Changes

- **The grill-me stage is registered** (id `grill-me`, emoji 🔥), for the `claude` tool only, with `--model opus --effort high`. Selected and supplied `grill-me` units launch instead of waiting.
- **Stage prerequisites.**
    - The stage contract gains a prerequisite check that launch runs after it finds the stage registered and before any write. A failed prerequisite makes launch `wait` with the reason.
    - For grill-me, the check covers three things: the configured tool is `claude`; the `mattpocock-skills` plugin is installed for Claude Code; and its `grill-with-docs` and `handoff` skills can be found.
- **The stage prompt inlines the skills.**
    - At launch, code reads the installed `SKILL.md` of `grill-with-docs` and of `handoff` and inlines their bodies, without frontmatter, into the prompt file. An agent cannot invoke either skill, and this way the stage follows whatever each skill says in its installed version.
    - The `handoff` output is redirected to the attempt directory.
    - The stage's own instructions follow, with the closing order:
        1. grill until the human confirms the definition and whether to split;
        2. commit and push only the glossary and ADR files the grill changed;
        3. write `definition.md` and `stage-summary.md`, and create any subtasks;
        4. run the persistence;
        5. show the ticket;
        6. run the transition;
        7. write the result marker.
    - The prompt forbids proposal preparation in the same session.
    - For a GitHub task, the prompt forbids absolute paths and other machine details in the stage summary.
- **Persist mode.**
    - `--apply --persist <attempt-id>` runs no step. It writes the definition at the top of the task's description, above `---` and `## Original description` followed by the original text; a new grill replaces only the part above the separator.
    - It posts the stage summary as a comment whose first line is `autonomous · grill-me · <attempt-id> · definition saved`.
    - It reads both back and writes a receipt in the attempt directory.
    - Its report is `autonomous.persist.v1`.
- **The transition waits for the receipt.** `--transition`, and an answer to its question, refuse with exit code 3 when the task has an open grill-me attempt without a receipt. A transition with no open attempt works as before.
- **Completion check.** The grill-me stage is complete when the task has `proposal`, no `grill-me` and an autonomy label, or when the task is closed. Reconcile then removes the session as for any stage.
- **GitHub children.** The GitHub reader reads sub-issues as children, so a split GitHub parent is excluded as split like a Linear or Beads parent. GitHub blockers remain unread (DOT-121).
- **Docs.** The plugin README covers the grill-me stage, its prerequisites, persist mode and the verification.
- **Verification.** The stage is run end to end for five cases, recorded as evidence:
    - an AFK outcome;
    - a HITL outcome;
    - a confirmed split;
    - an interruption before persistence;
    - a grill that ends with the task closed.

    One real task covers the AFK or HITL case. Throwaway Beads tasks in a sandbox repository cover the rest.
- **Release.** A `feat(autonomous):` minor, with no configuration change.

**Out of scope**:

- The proposal stage and later stages; `proposal` stays unsupported in selection.
- Advising model and effort per task (DOT-119), excluding tasks without an inferable repository (DOT-120) and reading GitHub blockers (DOT-121).
- A `cancelled` outcome in the result marker.
- Supporting `codex` for grill-me.

## Capabilities

### New Capabilities

- `grill-me-stage`: the grill-me stage as a stage implementation. It covers its identity and agent arguments, its prerequisites, the prompt it gives the session, the persistence of the definition and the stage summary with the receipt, and its completion check.

### Modified Capabilities

- `stage-sessions`: the stage contract gains prerequisites, and the launch step checks them before writing anything.
- `autonomous-run`:
    - persist mode is added, with its report, exit codes and flag rules;
    - the transition waits for the persistence receipt of an open grill-me attempt;
    - the flags that cannot combine with `--persist` are listed.
- `work-selection`: GitHub children are read from sub-issues, and the report's GitHub note covers only dependencies. This builds on the selection report as change 1 leaves it.

## Impact

- **Code** (`plugins/autonomous/src/`):
    - the stage contract and registry: `stages/{stage,registry}.ts`;
    - the new stage: `stages/grill-me/` (stage, prompt, prerequisites, skill lookup);
    - the launch preconditions: `attempts/launch.ts`;
    - the new persist mode: `persist/`;
    - the transition: `transition/`;
    - trackers: `label-triage/trackers/{tracker,linear,github,beads}.ts`, which gain description update, comments and closed-state reading;
    - the GitHub reader: `select/readers/github.ts`;
    - `args.ts` and `run.ts`;
    - the tests next to each of these.
- **Plugin files**: `README.md`.
- **Runtime dependencies**: Claude Code with the `mattpocock-skills` plugin installed (read from `~/.claude/plugins/installed_plugins.json`), and `gh` 2.100 or later for sub-issues.
- **Trackers**: a grill writes the description and one comment of its own task, may create subtasks through `labelling-new-tasks`, and transitions labels as change 1 defines. Each subtask created in Linear counts against the free plan's issue limit.
- **Repositories**: a grill commits and pushes only the glossary and ADR files it changed, on the task's workspace branch.
- **Ordering**: change 1 must be archived before this one, because this change's `work-selection` delta copies the selection report requirement as change 1 leaves it.
