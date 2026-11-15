# Design

## Context

See proposal.md, "Why", for the gap.

**What gh 2.100 returns.** `gh issue list --json blockedBy,blocking` is accepted beside the fields label triage already reads. With `GH_DEBUG=api`, gh asks GraphQL for `blockedBy(first:50){nodes{id,number,title,url,state,repository{nameWithOwner}},totalCount}`, and the same for `blocking`. The JSON is one object per list:

```json
"blockedBy": { "nodes": [{ "number": 3, "state": "OPEN", "repository": { "nameWithOwner": "demo/one" }, "...": "..." }], "totalCount": 1 }
```

Unlike a `subIssues` node, which DOT-110 has to parse from `url`, each node names its repository. A node's `state` is `OPEN` or `CLOSED`; the close reason is not asked for and does not matter (proposal, "Only an open blocker blocks"). None of the configured repositories has a blocker today, so the test fixtures are hand-written from this shape. A read of this repository on 2026-11-15 returned `{"nodes":[],"totalCount":0}` for both fields.

**Where the reader is today.** `githubWorkReader.list()` calls `githubTracker.listTasks()`, the listing label triage uses, and maps each `TrackerTask` to a `WorkTask` with `blockedBy: null` and `blocks: []`. `selectCandidates` skips the `blocked` check when `blockedBy` is `null`, and only then calls `detail()`, which reads `subIssues` per surviving task. `step.ts` puts `"github: dependencies"` in `SelectData.notEvaluated` when GitHub is enabled, and `render.ts` prints one `not evaluated:` line per entry.

**How Linear does it.** `linearWorkReader` issues its own `linear issue query` and reuses the triage tracker's `listedTask` parser for the shared fields, adding `priority` and `blockedBy` from the same listing. Its 100-relation cap fails the read with a `ParseError`.

## Goals / Non-Goals

**Goals:**

- Fill `blockedBy` and `blocks` for every GitHub task at listing time, so the `blocked` check runs before `detail()` for all three sources.
- Make `WorkTask.blockedBy` a plain `string[]` now that every reader fills it.
- Keep label triage's GitHub listing, its fields and its cost, exactly as they are.

**Non-Goals:**

- Moving the sub-issue read out of `detail()`: `subIssues` is not asked for at listing time, so its per-candidate cost stays where DOT-110 put it.

## Decisions

### D1. The reader lists GitHub issues itself, reusing the tracker's pieces

The reader runs its own `gh issue list --repo <repo> --state open --limit <cap+1> --json <LIST_FIELDS>,blockedBy,blocking` per configured repository, in the same order as the tracker. It reuses from `src/label-triage/trackers/github.ts` the field list, the listing cap check and the per-issue parser, which the tracker exports for it; the reader adds only the parsing of the two new fields.

*Alternative*: add the fields to the tracker's `LIST_FIELDS`. Label triage would pay for two GraphQL connections it never reads, and a cut-short blocker list would fail triage for no reason. *Alternative*: give `listTasks()` an option for extra fields. It would widen the shared `Tracker` contract for one caller. Reusing the tracker's pieces in the reader is how the Linear reader already works.

### D2. Blockers are read at listing time, not in `detail()`

Read in the listing, the `blocked` exclusion keeps one order for every source, `blocks` is filled without an extra call, and a blocked task never costs a `detail()` call. The measured cost of the two extra fields on monolab was nil (0.76 s → 0.77 s). Reading them with DOT-110's `gh issue view --json subIssues` would move the `blocked` check after `detail()` for GitHub and add one call per surviving task. Settled in the DOT-121 grill.

### D3. `blocks` comes from GitHub's `blocking`, not from listed tasks

Linear derives `blocks` from the other listed tasks' `blockedBy`. GitHub gives `blocking` directly, so the reader uses it: OPEN nodes only, any repository. That keeps `blocks` consistent with the any-repository blocker rule: a task in a configured repository that blocks one outside it still reports it. The comparison shows `blocks` to the LLM, so an out-of-scope blocked task is real information about unblocking work.

### D4. A cut-short list throws a `ParseError` that names the task

For each listed issue and each of the two fields, when `totalCount` is higher than the number of nodes, the parser throws a `ParseError` whose message names the task (`<owner/name>#<number>`), the field, `totalCount` and the node count. `runJson` turns it into the read's error, so the step is `not-evaluable` exactly as for Linear's cap. Since the listing is `--state open`, every listed issue reaches selection, so no issue is exempt from the check, unlike Linear's closed issues.

*Alternative*: page the rest with `gh api graphql`. It would add a call path for a case no configured repository has today; failing names the task, and the person can fix or split the dependencies.

### D5. `notEvaluated` is removed, not left empty

With blockers and children both read for GitHub, nothing is left unevaluated. `SelectData.notEvaluated`, `GITHUB_NOT_EVALUATED` and the `not evaluated:` lines in `render.ts` go away. Keeping an empty field for a future source is speculation; a source that needs it later can bring it back with its own wording. The comment on `WorkTask.children` keeps its "null until detail reads them" note, which is still true.

## Risks / Trade-offs

- [A task with more than 50 blockers or blocked tasks fails every run] → The reason names the task, so the person can fix it; no configured repository is close to that today.
- [A blocker in a private repository the token cannot read counts in `totalCount` without a node, and fails the read] → Every configured repository belongs to the user today. When it happens, the reason names the task, which is better than treating it as blocking or ignoring it silently.
- [A consumer of `--json` that reads `notEvaluated` no longer finds it] → Nothing in the plugin reads it, and the README drops it. The release stays minor.
- [Older gh rejects the two fields] → The README already requires gh 2.100.0 or later; it gains the two fields beside `subIssues`. With an older gh the listing fails and the step is `not-evaluable`, as it does for `subIssues` today.

## Migration Plan

None: the configuration is unchanged and the reader needs no state. Rolling back restores the `null` blockers and the note.
