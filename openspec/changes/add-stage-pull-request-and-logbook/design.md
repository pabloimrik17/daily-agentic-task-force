## Context

See proposal.md, "Why". The current state that shapes the approach:

- **Modes.** `--persist` and `--transition` are the model: a mode runs no step, takes no run lock, reads the attempt's record, does exact writes in code, reads them back and reports with its own schema. `run.ts` dispatches on the parsed flag, and `args.ts` holds the flag rules as a table.
- **The attempt.** `attempts/record.ts` holds the task, the stage, the attempt number, the state history and the workspace (repository path, branch, worktree path). It does not hold the agent arguments: `launch.ts` asks the stage for them when it creates the session and forgets them. The parser is strict and rejects unknown keys.
- **The transition.** `transition/answer.ts` applies an answer through answer mode and reads the labels back. Nothing local records that an answer was applied, or which.
- **Git and GitHub.** Only `workspace/worktrunk.ts` runs `git`, through an injected `Exec`. `gh` is used by the GitHub tracker for issues, never for pull requests. Trackers write comments from a file (`addComment(id, file)`) and read comment bodies back.
- **The grill-me prompt** (`stages/grill-me/prompt.ts`) lists a closing of seven steps and a constraint that says "Open no pull request".
- **Reconcile** finalises an attempt on two proofs, the result marker and the stage's tracker check, and reports a `detail` joined from notes.

## Goals / Non-Goals

**Goals:**

- Keep every exact write in code: the push, the pull request, its cover, the entry's header, the comment and its read-back. The agent writes one file and passes one title.
- Make both modes safe to repeat, like persist mode, so an agent that runs one twice changes nothing.
- Keep the two modes independent of the stage, so `add-proposal-stage` uses them without touching them.

**Non-Goals:**

- A pull-request abstraction over several hosts. The one implementation is GitHub through `gh`.
- Blocking a stage's completion on the logbook in code (see D8).
- Reading the pull request from reconcile, launch or selection.

## Decisions

### D1. Two modes, `--pull-request` and `--log`, shaped like persist mode

Each mode lives in its own directory (`src/pull-request/`, `src/logbook/`) with a `run…` function that takes the attempt id, injected dependencies and the start time, and returns a report. `run.ts` dispatches to them as it does to persist mode. Both check their preconditions before any write: the attempt exists and is open (`holdsTask`), and its source is enabled.

They are two modes and not one because their moments differ. The grill runs them back to back, but proposal preparation opens the pull request before the human reviews it and logs only after the transition.

*Alternative:* log mode opens the pull request when it is missing. Rejected: it would need the title, and a stage that wants the pull request early would have no way to ask for it.

### D2. The pull request is driven through a small port over `git` and `gh`

A `PullRequests` port, with one `gh`-backed implementation and fakes in tests, offers:

- `defaultBranch()`: `gh repo view --json defaultBranchRef`;
- `find(branch)`: `gh pr list --head <branch> --state open --json number,url,title`;
- `ahead(base)`: `git rev-list --count origin/<base>..HEAD` after `git fetch origin <base>`;
- `commitsSince(base, since)`: the short ids of the commits on `HEAD` that `origin/<base>` lacks, made since `since`; the logbook header uses it (D6);
- `emptyCommit(message)`, `push(branch)`;
- `open(...)` with `--draft --base <default> --title … --body-file …`, and `edit(number, …)` for the title and the body;
- `comment(number, file)` and `comments(number)`.

A factory makes the port for one directory, and every command runs there with the shared `Exec`, so errors name the command and calls are bounded like every other CLI. The directory is the attempt's worktree. Discard uses the repository instead, because the worktree may be gone by then. The push is a plain `git push -u origin <branch>`: hooks run, and nothing is forced.

Only an open pull request counts. A branch whose earlier pull request was merged or closed gets a new one.

### D3. The parent of a split is recognised by its children

Pull-request mode reads the task through the work reader of its source and calls `detail`, which fills `children`. A task with at least one open child and zero commits ahead of the default branch gets no pull request: the mode reports `pullRequest: null` with the reason and exits 0. Every other task gets the empty commit, with the message `chore: open the pull request of <task id>`.

`children` lists open children only, which is enough here: the mode runs at the end of the grill that just created them.

### D4. The cover is a pure function of the task

`cover(task, parent)` returns the description. It reuses `DEFINITION_HEADING` and the section splitting of `persist/splice.ts` to find `### Problem` and `### Solution` inside the definition. Without a definition it takes the first paragraph of the description, the text up to the first blank line, cut to 500 characters with an ellipsis. Links come from the tracker's URL for the task, and the id stands in when there is none.

The mode writes the cover on every run with `gh pr edit --body-file`. The description therefore belongs to code: a person's edit to it is overwritten by the next stage. The README says so.

Neither the task's URL nor its parent is read today. The work task gains two optional fields, filled by `detail`: `url` (Linear's `url`; GitHub's, built from the repository and the number; none for Beads, where the id stands in) and `parent`, the parent's id and URL where the tracker reports one (Linear `parent`, Beads `parent`, GitHub's parent of a sub-issue). The cover omits a link it cannot build.

### D5. The attempt record gains `agentArgs`, and the answer leaves `transition.json`

- `AttemptRecord.agentArgs: string[] | null`. `launch.ts` stores what `stage.agentArgs(tool)` returns. The strict parser accepts a record without the key and reads it as `null`, so records already on disk stay valid and the schema id stays `autonomous.attempt.v1`.
- After a transition answer is applied and read back, `transition/answer.ts` looks for the task's open attempt (the same lookup as `awaitedReceipt`) and writes `transition.json` in its directory: `{ schema: "autonomous.transitioned.v1", answer: [...labels], at }`. A write failure is added to the answer's detail and does not change its status.

*Alternative:* recompute the agent arguments from the stage when the entry is published. Rejected: the header would report today's stage, not the attempt's launch.

### D6. The header is rendered from the record; an HTML marker makes the entry idempotent

The comment starts with `<!-- autonomous:logbook <attempt-id> -->`, which GitHub does not show, followed by a heading and one line of facts:

```markdown
<!-- autonomous:logbook linear:DOT-121:grill-me:1 -->
### 🔥 grill-me · attempt 1

`HITL` · `--model opus --effort high` · 2026-11-13 10:02 → 10:40 UTC (38 min) · answered `HITL` · 1 commit (`a1b2c3d`)
```

The agent's body follows unchanged. The values come from:

- stage and emoji: the registry entry for the record's stage;
- autonomy: the task's labels, read from its tracker when the mode runs;
- start: the record's first `started` entry in `history`; end: the mode's start time;
- answer: `transition.json`, omitted when absent;
- commits: `git log --since=<start> --format=%h origin/<base>..HEAD` in the worktree, without the empty commit that pull-request mode adds (D3), which is left out of the list.

Before publishing, the mode reads the comments and skips the publish when one already starts with the marker; it then writes the receipt if it is missing. The read-back after a publish uses `readUntil`, as persist mode does, to allow for read lag.

Commits by time is an approximation: a commit made in the worktree by hand during the attempt is counted too. The empty commit of pull-request mode is not counted. It needs no new field, and a wrong count is harmless.

### D7. The body is checked by a pure function

`checkBody(text, home)` returns every broken rule at once: a missing required heading (matched exactly as `### <name>` at the start of a line), an empty What I did, more than 300 words (whitespace-separated tokens of the whole file, headings included), and the home directory appearing in the text. Who took each decision is the agent's to write and is not checked. The limits are constants in one file, since the format is expected to change as it is used.

### D8. The logbook does not gate completion; the prompt orders it and reconcile notes it

The grill's prompt puts log mode before the result marker, and log mode writes `logbook.json` (`autonomous.logged.v1`) as its receipt. Reconcile does not require the receipt: when it finalises an attempt without one, it adds a note to the attempt's detail.

Two legitimate endings have no entry: the human closed the task, and the parent of a split has no pull request. A hard gate would need both exceptions in code, and a failed `gh` call would retain an attempt whose real work, the tracker's state, is done.

*Alternative:* a third proof in "Completion needs two proofs". Rejected for the reason above; the note keeps a skipped entry visible in every run report.

### D9. Discard publishes its entry last and never fails on it

After `discard` has removed the session and `taken` and marked the record, it looks for an open pull request of the record's branch and, when the attempt has no `logbook.json`, comments with the marker and one line: `### <emoji> <stage> · attempt <n> · discarded` and the time. Any failure becomes a note in the discard report. The comment uses the same marker, so a discarded attempt never has two entries.

### D10. The grill-me prompt changes in two places

The closing gains steps 7 and 8 (see the grill-me-stage delta) with the exact commands and the path of `logbook-entry.md`, and a short description of the body. The constraint "Open no pull request" becomes "Open no pull request yourself: pull-request mode opens it". The title is the agent's to choose from the repository's conventions; the prompt points it at the repository's contributor instructions and recent commit subjects.

## Risks / Trade-offs

- [The cover and the logbook publish task content in a public repository] → The README states it; log mode rejects the home directory; the prompt repeats the rule about machine details for every source, not only GitHub.
- [An empty commit stays in a branch that is merged without squashing] → Its message names the task. Repositories that squash never see it.
- [`gh` is now needed for Linear and Beads tasks] → Pull-request mode fails with the command named and exit 3, and the agent tells the human; nothing in launch or selection depends on it.
- [A person edits the pull request's description and loses it at the next stage] → Documented; the cover is short and regenerated from the tracker, which is where edits belong.
- [The entry is skipped and the stage still completes] → Reconcile's note (D8).
- [A transition applied by hand, with no open attempt, leaves no answer in the header] → The header omits the value; nothing fails.

## Migration Plan

No configuration change and no data migration. Records without `agentArgs` parse as before. Attempts that are open when the plugin updates keep their old prompt and simply publish no entry; reconcile notes it. Rollback is the previous plugin version, with one limit. Its `parseRecord` rejects unknown keys, so it cannot read the record of an attempt launched by this version, which stores `agentArgs`. Finish or discard each such attempt before rolling back. `transition.json` and `logbook.json` are ignored by it.

## Open Questions

- Whether the 300-word limit and the four sections hold up in use. Both are constants and are expected to be tuned after the first real entries.
