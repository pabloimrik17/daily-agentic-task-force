## Context

See proposal.md, "Why". This change builds on change 1 (`add-stage-labels-and-transition`): the stage labels, `proposal`, and the `src/transition/` module with transition mode and its answer handler. The current state:

- **Stage contract.** `src/stages/stage.ts` declares `id`, `emoji`, `agentArgs(tool)`, a synchronous `prompt(input)` and `completed(task)`. `renderPrompt` writes the shared frame: attempt, task, instructions and result marker.
- **Launch.** `attempts/launch.ts` checks its preconditions in the order of DOT-109's design D9: stage registered, no `taken`, no open attempt, repository inferred. Only then does it write.
- **Reconcile.** It reads the tracker and calls `completed()` only after a valid result marker.
- **Trackers.** They list, read, add, remove, list labels, create labels and, from change 1, recolour. `TrackerTask.status` is each tracker's own name; for Linear that is the state name, while the state type, which says completed or canceled, is parsed only to filter listings. `linear issue view --json` prints the state without its type, so Linear's `readTask` reads `state.type` with one read-only `linear api` GraphQL query (D6). No tracker updates a description or handles comments.
- **The GitHub reader** sets `children` to null. gh 2.100 exposes `subIssues { nodes, totalCount }` in `gh issue view --json`.
- **Claude Code** records installed plugins in `~/.claude/plugins/installed_plugins.json` (version 2): `plugins["<name>@<marketplace>"]` is a list of `{ scope, installPath, version, … }`. `mattpocock-skills` 1.3.2 is installed at user scope. Its skills live under `skills/<category>/<name>/SKILL.md`, and the categories have changed between versions (`in-progress`, `engineering`, `productivity`). `grill-with-docs` and `handoff` both carry `disable-model-invocation: true`.

## Goals / Non-Goals

**Goals:**

- Register the stage without special cases in reconcile or launch. Prerequisites become part of the stage contract, so launch stays generic.
- Put every write that must be exact in code: the description splice, the comment, the read-back and the receipt. The agent only writes two files and runs two commands.
- Enforce the order "persist, then transition" in code (DOT-110, decision A+), so that the labels alone prove the stage completed.

**Non-Goals:**

- Driving or watching the grill conversation from the runner. The session is the agent's, and the runner only reconciles it.
- Reading comments outside persist mode, or making reconcile read comments.
- A generic skill-inlining framework. One lookup function serves the two skills this stage needs.

## Decisions

### D1. Prerequisites are an asynchronous stage method whose result feeds the prompt

The stage contract gains `prerequisites(env): Promise<{ ok: true; context } | { ok: false; reason }>`, and `prompt(input)` receives that `context`. `launch` calls `prerequisites` right after the registry check and before the `taken`, open-attempt and repository checks. A failure is `wait` with the reason, and nothing is written. The test stage returns `ok` with an empty context. `env` carries the configured tool and the home directory, and tests inject both.

The context is how the skill bodies, read once at launch, reach the synchronous `prompt`. A stage therefore never touches the filesystem from `prompt`.

*Alternative:* launch reads a list of named checks. Rejected: launch would need to know about skills and tools.

*Alternative:* an asynchronous `prompt` that fails. Rejected: launch writes the record, `taken` and the prompt in sequence, so a prompt failure would come after `taken` was added.

### D2. Skills are found through Claude Code's plugin registry, by name

The lookup reads `installed_plugins.json` and takes the entries whose key starts with `mattpocock-skills@`, preferring scope `user`. It then searches `skills/` under `installPath`, at most two levels deep, for a directory named after the skill that holds a `SKILL.md`. The YAML frontmatter, between the leading `---` lines, is stripped.

A missing registry, a missing plugin entry or a missing skill each give a distinct reason. The prompt file keeps exactly the text the agent received, so an attempt can be audited even after the plugin updates.

*Alternative:* a fixed path. Rejected: the version and category directories changed during the DOT-110 grill (1.3.1 → 1.3.2).

*Alternative:* `claude plugin list`. Rejected: it adds a subprocess and a timeout for the same data, and the registry file is what Claude Code itself maintains.

### D3. The prompt is the shared frame plus four sections

The stage's instructions, inside `renderPrompt`, contain four sections:

1. **Grill.** The `grill-with-docs` body, with one line saying that every skill it names is invoked from the `mattpocock-skills` plugin.
2. **Closing.** The seven steps in order, with the absolute paths of `definition.md` and `stage-summary.md` in the attempt directory, the exact persist and transition commands, the template of the definition (Problem, Solution, Acceptance criteria, Non-goals, Decisions, Proposed autonomy as a reason, Artifacts), the rule that the task's autonomy label, set by the transition, is the decision, so the agent does not persist again when the human answers another autonomy, and the rule that the marker comes only after an applied transition, except when the human closes the task: then the agent skips persist and the transition and writes the marker, so that reconcile finalises the closed task.
3. **Stage summary.** The `handoff` body, overridden to write `stage-summary.md`.
4. **Constraints.** No proposal in this session. Commit and push only changed glossary and ADR files, with no PR, no force push and no `--no-verify`, and a failed push goes to the human. A split goes through `labelling-new-tasks` with the tracker's parent option. For a GitHub task, one more line forbids absolute paths and machine details in the definition and in the stage summary.

The GitHub rule covers the definition too, because persist writes it into the issue description, and it keys on `task.source === "github"`, not on repository visibility. It is conservative and needs no API call.

### D4. Persist mode is idempotent, and reruns are safe

`src/persist/` handles `--apply --persist <attempt-id>`:

1. Parse the id, read the attempt record, and check the preconditions: open, stage `grill-me`, both files present and non-empty.
2. Read the task fresh.
3. Compose the new description with a pure splice. If the description starts with `## Definition` and contains `\n---\n\n## Original description\n`, the part above the separator is replaced; otherwise the definition, the separator, the heading and the old description are concatenated. A definition that does not start with `## Definition` gets that heading and a blank line prepended first, because the detection of an earlier grill keys on the heading.
4. Write the description through a file in the attempt directory, then read it back, waiting out read lag (D9), and compare the text. Before the comparison, every Markdown link or image `[text](dest)` becomes its text, whatever its destination. Two descriptions are the same text when their Unicode letters and digits (`/[\p{L}\p{N}]/gu`) are then equal, in order. Whitespace, Markdown punctuation and `<>` are ignored, and a null description counts as empty. There are three outcomes. Equal apart from trailing whitespace: nothing more. Same text but not the same bytes: write what the tracker returned to `description.read.md`, add one note to the report and go on. Different text: write `description.read.md` too, fail and write no receipt.
5. Read the comments. When none starts with this attempt's header line, post the comment from a file in the attempt directory. Then read the comments back, waiting out read lag (D9), and find the header.
6. Write the receipt `persisted.json` (`autonomous.persisted.v1`: attempt, task, time, header) atomically.

Because the splice replaces the definition and the comment is skipped once its header exists, a rerun after a partial failure converges without duplicating anything.

The read-back compares text, not bytes, because trackers re-serialise Markdown. The DOT-122 round trip (2026-11-03) showed Linear rewriting `- ` list markers to `* ` and wrapping external link destinations in `<>`. A byte comparison failed every Linear persist. That failure lands at the end of a grill, when the definition is already agreed, and recovering from it needs a release. A real failure, such as a lost or truncated write or an edit by another person, still changes the letters or digits, so the text comparison still catches it.

The comparison counts a link as its text, because a tracker can also add links of its own. Linear rewrites issue identifiers in a description into links some seconds after the save, so that `DOT-110` becomes `[DOT-110](https://linear.app/monolab/issue/DOT-110/<slug>)` (DOT-121, 2026-11-04). The letters of that destination would fail a comparison of letters and digits, and a read taken before the rewrite would pass while a later one failed. Replacing each link by its text makes the plain identifier, the linked one and a destination wrapped in `<>` equal, without naming a tracker. The destination itself is not compared.

Persist takes no run lock. It writes a new file in the attempt directory, never the record, and a periodic run holding the lock must not make a waiting human's session fail.

Each tracker gains three methods, all taking files:

| Method | Linear | GitHub | Beads |
| --- | --- | --- | --- |
| `updateDescription(id, file)` | `linear issue update --description-file` | `gh issue edit --body-file` | `bd update --body-file` |
| `addComment(id, file)` | `linear issue comment add --body-file` | `gh issue comment --body-file` | `bd comments add -f` |
| `readComments(id)` | `linear issue comment list --json` | `gh issue view --json comments` | `bd comments --json` |

### D5. The transition finds the attempt in the state directory

Transition mode and the transition answer list the attempt records, read-only and without the lock. They look for an open record of that task at stage `grill-me`. When one exists and its directory has no `persisted.json`, transition mode reports it with exit code 3, and the answer is `rejected` naming the attempt. With no open record, nothing changes from change 1. Checking at both points also covers an answer passed by hand without the question.

### D6. Closure is a tracker field

`TrackerTask` gains `closed: boolean`, filled by `readTask` and `listTasks`:

- Beads: status `closed`;
- GitHub: state `CLOSED`;
- Linear: state type `completed` or `canceled`, or state name `duplicate`, reusing `isExcluded`. `linear issue view --json` has no state type, so Linear's `readTask` reads it with one read-only `linear api` GraphQL query after the view (`query($id: String!) { issue(id: $id) { state { type } } }`, `--variable id=<id>`); a failed or malformed query fails `readTask`. `listTasks` already has the type from `issue query`.

The grill-me `completed(task)` is `task.closed`, or the task carries `proposal`, no `grill-me`, and `AFK` or `HITL`. Nothing else reads `closed` in this change.

### D7. GitHub children are read in `detail`, as for Linear

The GitHub reader's `detail` runs `gh issue view <n> --repo <r> --json subIssues` and keeps the nodes whose state is not `CLOSED` as children, with id `<owner/name>#<number>`. It uses the node's repository when it is given, and the task's repository otherwise; a recorded fixture fixes which. `list` keeps `children` null until `detail`, which runs only for tasks that pass the earlier exclusions, so the cost stays per candidate. The report's GitHub note drops "children".

### D8. The stage's identity

The id is `grill-me` and the emoji is 🔥. `agentArgs("claude")` is `--model opus --effort high`. `agentArgs("codex")` returns no flags, because the prerequisites never let a codex session start. DOT-119 replaces the fixed model later.

### D9. Read-backs wait out the tracker's read lag

Every read-back follows a tracker write, and Linear can serve a read that lags a write it has acknowledged. In the DOT-121 grill (2026-11-04) the transition added `AFK` and then `proposal`. Linear acknowledged both, and its history files `proposal` at 21:01:22. The read-back right after, and a read 8.4 s after the write, still lacked `proposal`, so the transition failed with a read-back mismatch before it removed anything. The `linear` CLI sends each label change as one `issueUpdate` with the ids to add or remove, does no read-modify-write and keeps no cache, so the lag is Linear's.

One shared helper, `readUntil(read, settled)` in `src/read-back.ts`, handles it. It reads once and returns at once when the read fails or `settled` holds for it. Otherwise it waits 1, 2, 4, 8 and 15 s, reading again after each wait, and returns the last read: six reads over 30 s. Each call site says what settled means:

| Read-back | Settled when |
| --- | --- |
| The transition's labels (`transition/answer.ts`) | The label set equals the expected set |
| `taken`, added or removed (`attempts/taken.ts`) | The labels do not contradict the write |
| Label triage's writes (`label-triage/write.ts`) | Every expected label is present |
| Persist's description | The text equals the text written, so a read of the old description is read again |
| Persist's comment | The first line of some comment is the header |

A mismatch after the last read keeps its message and gains `(read 6 times over 30 s)`, placed before any trailing hint, such as "answering again completes the transition" or the path of `description.read.md`. A failed read keeps its message. Some reads stay single because they are not read-backs: the read before the removal of `taken`, the listing that decides whether persist posts its comment, and the reads that only report the labels after a failed write.

*Why one helper:* five call sites carry the same risk, and the schedule must not drift between them. Tests drive the helper with fake timers, so no test sleeps.

*Why 30 s:* a guess. The lag was seen to last at least 8.4 s, and its true bound is unknown (the labels were present when read about 8 minutes later). 30 s is about 3.5 times the observed lag. Beyond it, each call site fails as it did before. The transition has removed nothing, or says that answering again completes it. Persist writes no receipt, and a rerun converges (D4). A `taken` add that is not confirmed creates no session and leaves the attempt `pending`. Label triage stops writing to that source, and nothing was ever removed. The cost is time on the mismatch path only: a read-back that settles at once never waits, and label triage stops a source at its first mismatch.

*Alternative:* one `issueUpdate` carrying the added and removed ids, which makes the move atomic. Rejected: its single read-back would still meet a stale read, and it needs a new tracker method in all three trackers.

*Alternative:* trust the label list in the write's response. Rejected: it changes `addLabel`'s contract in three trackers, it cannot be checked without a Linear write, and the `taken` design (stage-sessions D14) trusts only a read.

## Risks / Trade-offs

- **[The agent skips or reorders the closing steps]** → The transition refuses without a receipt. A marker written before the transition fails `completed()`, so reconcile keeps the session (`observe`, then `retain`) instead of removing it.
- **[The upstream skill text changes]** → The stage inlines what is installed, and the prompt file records it per attempt. A prerequisite failure is loud, while a content change is reviewed when the plugin updates.
- **[Claude Code changes `installed_plugins.json`]** → The lookup fails with a reason naming the file and the key it expected, so launch waits instead of running a session without the skills.
- **[A person edits the description while the grill runs]** → Persist reads the task right before writing, and the read-back catches a lost write. No receipt is written then, and the agent tells the human.
- **[A tracker's read lag outlasts 30 s]** → The read-back fails as a mismatch always did, now saying it read 6 times over 30 s. Nothing is lost: see D9 for what each call site leaves behind.
- **[`gh` older than 2.100]** → `detail` fails on `subIssues`, and selection reports the GitHub read as not evaluable. The README states the minimum version.
- **[Subtasks consume Linear's free-plan limit]** → The human confirms every split, and the prompt tells the agent to say how many Linear issues a split creates.
- **[The verification needs a sandbox repository]** → Creating it is part of the verification task, done only with the user's go-ahead.

## Migration Plan

1. Merge and release after change 1 (`feat(autonomous):` minor). Archive change 1 first, because this change's `work-selection` delta copies the selection report as change 1 leaves it.
2. No configuration change. Running grill-me requires Claude Code with `mattpocock-skills` installed; without it, launch waits with the reason.
3. **Rollback:** reinstall the previous version. Selection keeps choosing `grill-me` units, and launch goes back to waiting on "no implementation". Persisted definitions, comments and receipts stay as plain data.
