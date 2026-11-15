## Why

The `select` step's GitHub reader sets `blockedBy` to `null`, so a GitHub task is never excluded as blocked, while a blocked Linear or Beads task is. A blocked GitHub task can be chosen, and the report has to say that GitHub dependencies were not evaluated. gh 2.100 exposes `blockedBy` and `blocking` in `gh issue list --json`, so the reader can close the gap with no extra call. Linear DOT-121, under DOT-82, settled the rules in its grill.

## What Changes

- **GitHub blockers are read at listing time.** The GitHub reader asks `gh issue list` for `blockedBy` and `blocking` beside the fields it reads today. A task's open blockers are the `blockedBy` nodes whose state is `OPEN`. The tasks it blocks are the `blocking` nodes whose state is `OPEN`. Both use the id `<owner/name>#<number>`, from each node's `repository.nameWithOwner` and `number`.
- **Only an open blocker blocks, wherever it lives.** A closed blocker never blocks, whether it was closed as completed or as not planned. An open blocker in a repository outside `sources.github.repos` still blocks. This is the glossary's **Open blocker**, and it matches Linear, where a canceled blocker does not count and blockers are read across all teams.
- **A cut-short list fails the read.** gh asks for the first 50 nodes of each list. When `totalCount` is higher than the nodes returned, for either list, the read fails and the step is `not-evaluable`, with a reason that names the task. A blocker the token cannot see, which counts in `totalCount` without a node, fails the read the same way.
- **The order of checks does not change.** The `blocked` exclusion still runs before `detail()`, for every source, and reading blockers adds no `gh` call per task.
- **The "not evaluated" note is removed.** GitHub was its only user. The `notEvaluated` field of the step's data and the report's `not evaluated:` line go away. Nothing in the plugin reads that field.
- **Docs.** The plugin README describes the GitHub blocker read and drops the note. The glossary's **Open blocker** entry, written during the DOT-121 grill, ships with this change.
- **Release.** A `feat(autonomous):` minor release, with no `!` and no `BREAKING CHANGE` footer: an autonomous feature is never a major release. The configuration is unchanged.

**Out of scope**:

- GitHub priority and project.
- Blockers between trackers, such as a Linear task blocking a GitHub one.
- Changing how GitHub sub-issues are read. DOT-110 added that read, and it stays in `detail()`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `work-selection`: "Blockers, children and priority" covers GitHub blockers and the tasks a GitHub task blocks, and drops the note that GitHub dependencies were not evaluated. A new requirement, "GitHub reads that are cut short", makes a cut-short `blockedBy` or `blocking` list a failed read. "Selection report" drops the note.

## Impact

- `plugins/autonomous/src/select/readers/github.ts`: its own `gh issue list` per configured repository, with the fields label triage reads plus `blockedBy` and `blocking`.
- `plugins/autonomous/src/label-triage/trackers/github.ts`: exports the field list, the listing cap and the per-issue parser that the reader reuses. Label triage's own listing is unchanged.
- `plugins/autonomous/src/select/types.ts`: `WorkTask.blockedBy` is no longer nullable; `SelectData.notEvaluated` is removed.
- `plugins/autonomous/src/select/candidates.ts`, `step.ts` and `render.ts`: the `null` check and the note go away.
- Tests: `src/select/readers/github.test.ts` with hand-written fixtures for an open, a closed and a cross-repository blocker and a cut-short list; `src/select/step.test.ts`, `src/select/render.test.ts`, `src/run.test.ts`, `src/stages/grill-me/grill-me.test.ts` and `src/attempts/launch.test.ts` lose `notEvaluated`.
- `plugins/autonomous/README.md` and `plugins/autonomous/GLOSSARY.md`.
