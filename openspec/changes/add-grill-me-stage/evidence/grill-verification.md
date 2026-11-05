# Manual verification against the real trackers

Task 9 of `add-grill-me-stage`, run from this worktree (branch
`feature/DOT-110-grill-me-session`) with the user's configuration
(`~/.config/autonomous/config.json`, left unedited). Sessions run through
`AUTONOMOUS_CONFIG=$KIT/config.json`, a copy that adds `sessions.binary` and the
sandbox repository. Step 1 ran on 2026-11-03 at commit `8ffcadf`. The Linear
round trips behind the findings ran on 2026-11-03 and 2026-11-04. The writes
were authorised by the user in the Plannotator Inbox thread "DOT-110 change 2
apply".

Paths: `$WS` is the workspace root (`workspace.root`), `$STATE` the plugin state
directory, `$KIT` is `$STATE/grill-verification`, and `<scratchpad>` is the
orchestrator session's temporary folder.

## Setup

The user's configuration is managed by chezmoi. It has no `sessions` block and
does not list the sandbox repository. It was not edited: two local files stand in
for it, written on 2026-11-03.

| File               | Mode | Content                                                                                                                                                                                                |
| ------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `$KIT/config.json` | 600  | The user's configuration plus `sessions` `{"tool": "claude", "profile": null, "binary": "$KIT/bin/claude"}`, with `sources.github.repos` narrowed to `["pabloimrik17/grill-sandbox"]`.                 |
| `$KIT/bin/claude`  | 755  | A shell wrapper. It exports `AUTONOMOUS_CONFIG=$KIT/config.json`, then execs the user's `claude` shim with `--plugin-dir <worktree>/plugins/autonomous "$@"`. Both files go at cleanup (`rm -r $KIT`). |

- A `diff` of the two configurations with `sessions` and `sources.github.repos`
  removed prints nothing. `loadConfig` accepts the copy.
- The sandbox must be configured because launch lists GitHub tasks only from the
  configured repositories, the transition's label check knows only their labels,
  and `--bootstrap-labels` touches only them. Narrowing the list also keeps the
  bootstrap and every GitHub listing away from the user's own repositories.
- The wrapper exists so that the commands the grill session runs see the same
  configuration. aoe passes `sessions.binary` as `--cmd-override`, and the agent
  arguments arrive as `"$@"`.
- `--plugin-dir` is needed because the installed plugin is 2.1.0: it has no
  `--persist`, no `--transition` and no `grill-me` stage. A `--plugin-dir` plugin
  replaces a same-named installed marketplace plugin and loads in place (Claude
  Code documentation, plugin loading, "Name conflicts").
- `chezmoi status ~/.config/autonomous/config.json` printed nothing, exit 0, on
  2026-11-03 and again on 2026-11-04.
- Versions: `claude` 2.1.317 through the wrapper at setup (2.1.318 on
  2026-11-04), `aoe` 1.14.0, `wt` v0.77.0, `gh` 2.100.0, `bd` 1.3.0, `linear`
  2.6.0, `bun` 1.4.4. The plugin code is the worktree's, commit `8ffcadf` for
  step 1.
- The first grill session (DOT-121, 2026-11-04) was checked from outside, without
  typing into it: `ps -ww -o command=` on its process shows
  `claude --plugin-dir <worktree>/plugins/autonomous --model opus --effort high 'Read $STATE/attempts/linear/DOT-121/grill-me/1/prompt.md and follow it.'`,
  and `ps eww` shows `AUTONOMOUS_CONFIG=$KIT/config.json` in its environment. The
  plugin code is the worktree's at commit `8755bc8` from step 2 on.
- Dry run on DOT-121 with the copy, 2026-11-03 08:34 UTC, no `--apply`, exit 0:
  `launch` advanced with repository `$WS/dotfiles` (from the Linear project
  `Dotfiles`), branch `feature/DOT-121-read-github-blockers-in-the-selection-re`,
  group `Dotfiles`. The session name came from the fallback because the proposed
  name had five words. Only `run.lock` was written locally.

The session ran in auto permission mode. The classifier denied two teammate
writes: `gh repo create` (`[Public Data-Sharing Upload]`) and the Linear
`issue create` of the throwaway issue. The user ran both by hand with the `!`
prefix. The operator did not route around the repository denial. The repository
creation is recorded as done by the user (finding F3).

## Step 1 (9.1): the sandbox

Prepared on 2026-11-03 by an operator teammate with the user present. The label
bootstrap, the tasks, the issue and the dry runs ran between 08:47 and 08:52 UTC.
A read-only checker then re-read every item: 13 of 13 checks PASS.

| Item          | Value                                                                                                                                                                                                                                                                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository    | `pabloimrik17/grill-sandbox`, created by the user. `isPrivate` true, `visibility` PRIVATE, default branch `main`, issues enabled. Cloned at `$WS/grill-sandbox`: one commit (`2409e24 Initial commit`), `origin/HEAD` is `origin/main`, `git status --short` empty, `.git` is a directory.                                                                                |
| Beads pointer | Written by hand, because `workspace-links.py` fails its check (finding F4). `$WS/grill-sandbox/.beads/redirect` holds a comment line and `$WS/agentic-task/.beads`; `# Local shared Beads tracker` and `/.beads/redirect` were appended to `.git/info/exclude`.                                                                                                           |
| GitHub labels | `--bootstrap-labels` at 08:47:43 UTC, exit 0, `autonomous.bootstrap.v1`, outcome `advance`. In `pabloimrik17/grill-sandbox`: `work`, `personal`, `AFK`, `HITL`, `grill-me`, `proposal`, `taken` all `created`, colours as the contract. In Linear scope `workspace`: all seven `present`. Beads: not applicable. The new repository also had GitHub's ten default labels. |
| Beads tasks   | T1 to T4 below, created through `labelling-new-tasks`: `prepare`, then `decide`, which returned `apply: personal, grill-me`. `grill-sandbox` is not a contract label, so the helper leaves it alone and repository inference reads it. T1 was created at 08:48:24 UTC.                                                                                                    |
| GitHub issue  | `pabloimrik17/grill-sandbox#1`, "Sandbox: greeter reads a config file and writes a log", `OPEN`, labels `personal` and `grill-me`, 0 sub-issues, 0 comments. `decide` under the copy printed `apply: personal, grill-me`.                                                                                                                                                 |

Read back after the Beads pointer:

```text
$ bd where
$WS/agentic-task/.beads
  (via redirect from $WS/grill-sandbox/.beads)
  database: $WS/agentic-task/.beads/dolt
$ git check-ignore -v .beads/redirect
.git/info/exclude:9:/.beads/redirect
```

The four Beads tasks are open, type `task`, priority 4, labels `personal`,
`grill-me` and `grill-sandbox`, no parent, none with `taken`:

| Id                             | Case (tasks.md 9.3)       | Title                                                     |
| ------------------------------ | ------------------------- | --------------------------------------------------------- |
| `agentic-task-b49m`            | T1, case 1                | Sandbox: greeter prints its version                       |
| `agentic-task-ealq`            | T2, case 2 (split)        | Sandbox: greeter learns names, languages and a shout mode |
| `agentic-task-0p5i`            | T3, case 4 (killed)       | Sandbox: greeter logs every greeting                      |
| `agentic-task-leoz`            | T4, case 5 (closed)       | Sandbox: greeter emoji skins (maybe a duplicate)          |
| `pabloimrik17/grill-sandbox#1` | G1, case 3 (GitHub split) | Sandbox: greeter reads a config file and writes a log     |

### Dry runs

One per task, no `--apply`, 2026-11-03 08:49 to 08:51 UTC:

```bash
AUTONOMOUS_CONFIG=$KIT/config.json bun plugins/autonomous/src/run.ts \
  --account claude --task beads:agentic-task-b49m --stage grill-me --json
```

`--account claude` is needed because several Claude accounts are present. All
five runs exited 0 with outcome `advance`. In each, `reconcile` advanced
(`nothing to reconcile`), `quota-gate` advanced (session 30/100, weekly 78/100),
and `launch` advanced with:

| Field        | Value                                                            |
| ------------ | ---------------------------------------------------------------- |
| `repository` | `{"path": "$WS/grill-sandbox", "inferredFrom": "grill-sandbox"}` |
| `group`      | `Grill sandbox`                                                  |
| `workspace`  | `null`                                                           |
| `attempt`    | `null`                                                           |
| `title`      | `source` is `llm`, form `auto 🔥 <name> (<task id>)`             |

| Task                                  | Branch                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| `beads:agentic-task-b49m`             | `feature/agentic-task-b49m-sandbox-greeter-prints-its-version`                 |
| `beads:agentic-task-ealq`             | `feature/agentic-task-ealq-sandbox-greeter-learns-names-languages-a`           |
| `beads:agentic-task-0p5i`             | `feature/agentic-task-0p5i-sandbox-greeter-logs-every-greeting`                |
| `beads:agentic-task-leoz`             | `feature/agentic-task-leoz-sandbox-greeter-emoji-skins-maybe-a-dupl`           |
| `github:pabloimrik17/grill-sandbox#1` | `feature/pabloimrik17-grill-sandbox-1-sandbox-greeter-reads-a-config-file-and` |

The slug is cut at 40 characters, so three branch names end mid-phrase. The
`launch` reason for T1, with the workspace root written as `$WS`:

```text
would launch grill-me for beads:agentic-task-b49m in $WS/grill-sandbox on feature/agentic-task-b49m-sandbox-greeter-prints-its-version as "auto 🔥 Sandbox greeter version check (agentic-task-b49m)"
```

The other four read the same, with their own task, branch and title. Checks in
the same go, all reads:

- `bd show --json` of T1 to T4 is byte-identical before and after the dry runs,
  and none carries `taken`. The labels of G1 are unchanged and it has no comment.
- `git worktree list` in the sandbox shows only the main worktree. The branches
  are `main` and `origin/main`.
- `$STATE/attempts` does not exist and `$STATE/run.lock` is gone (released after
  each run).
- `chezmoi status` on the managed configuration is empty.

The 9.1 criterion holds: every dry run reports the sandbox repository
(`$WS/grill-sandbox`, inferred from `grill-sandbox`) and its branch.

## Step 2 (9.2): DOT-121

DOT-121, "Read GitHub blockers in the selection reader", is a Linear task in the
project `Dotfiles`. The user picked it and grilled in the session. Times are UTC.
The launch ran on 2026-11-04 and the attempt was finalised on 2026-11-05. The run
exposed three defects, fixed in `288214b` and `67ffd23` (findings F5 to F7), and
one that stays open (F8).

### Baseline (2026-11-04)

Read before the launch:

- Labels `personal` and `grill-me`. State Backlog, project `Dotfiles`, parent
  DOT-82, no children, no comments.
- The description has three sections: `## Idea`, `## Context` and
  `## To settle in a grill`.
- Dry run at 20:07:36, no `--apply`, same command as step 1 with
  `--task linear:DOT-121`. Exit 0, outcome `advance`. `launch` advanced with
  repository `$WS/dotfiles` (from the project `Dotfiles`), branch
  `feature/DOT-121-read-github-blockers-in-the-selection-re`, group `Dotfiles`, and
  the fallback session name.

### Launch (2026-11-04 20:10)

The user ran the `--apply` form of the dry run with the `!` prefix. Exit 0, outcome
`advance`:

- Attempt `linear:DOT-121:grill-me:1`, state `started`. Its history holds
  `pending`, `created` and `started`, all at 20:10:35.
- Repository `$WS/dotfiles`, inferred from the Linear project `Dotfiles`. The
  worktree
  `$WS/dotfiles-worktrees/feature-DOT-121-read-github-blockers-in-the-selection-re`
  was created.
- aoe session `864a753c360d416b` in the group `Dotfiles`, named
  `auto 🔥 Read github blockers in (DOT-121)` from the fallback.
- `taken` added and read back (`taken.added` is 20:10:35).
- The session process ran `--plugin-dir <worktree>/plugins/autonomous` with
  `--model opus --effort high` and carried `AUTONOMOUS_CONFIG=$KIT/config.json`
  (`ps`, as in Setup).

### The persisted definition and stage summary

The session persisted at 20:59:53, with the code at `8755bc8`, by running step 4
of its prompt:

```text
/autonomous:run --apply --persist linear:DOT-121:grill-me:1
```

The run wrote the receipt `persisted.json` and posted the comment at 21:00:03. Its
report carried the re-serialisation note of F1: Linear returns `-` list markers as
`*`, and the text matches. The description read from Linear after the 2026-11-05
repeat (below):

- It starts with `## Definition` and holds one `## Definition` and one
  `## Original description`. Below the separator is the baseline description. With
  the two links of F6 removed it equals the baseline text.
- The headings of the definition, in order:

  ```text
  ## Definition
  ### Problem
  ### Solution
  ### Acceptance criteria
  ### Non-goals
  ### Decisions
  ### Proposed autonomy
  ### Artifacts
  ---
  ## Original description
  ```

  The autonomy section was headed `### Autonomy` until 2026-11-05 (F7).

The task has one comment. Its first two lines are the header and, after a blank
line, the title of the stage summary:

```text
autonomous · grill-me · linear:DOT-121:grill-me:1 · definition saved

# DOT-121 grill-me stage summary
```

The rest of the comment equals `stage-summary.md` line for line. The summary has
four sections: `## Where the work lives`, `## Facts found in the grill`,
`## Rejected options` and `## Suggested skills`. The first one records that the
code is in `pabloimrik17/daily-agentic-task-force`, not in dotfiles, on the branch
`feature/DOT-121-read-github-blockers` (F8).

### First transition, answer AFK (2026-11-04 21:01)

| Time (UTC)               | Event                                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 21:01:14.985             | The answer run (`--apply --answer 'transition:linear:DOT-121=AFK'`) starts.                                             |
| 21:01:20.510             | `AFK` added.                                                                                                            |
| 21:01:22.072             | `proposal` added; Linear acknowledges the update.                                                                       |
| 21:01:24.290             | The run exits 3: read-back mismatch, `nothing was removed`. The read-back lists `personal`, `grill-me`, `taken`, `AFK`. |
| 21:01:30.6 to 21:01:33.8 | The session's own reads list the same four labels.                                                                      |

A read at 21:09 listed `personal`, `grill-me`, `taken`, `AFK` and `proposal`.
`grill-me` was still on, as the message said. The cause is finding F5, fixed in
`288214b`, committed at 21:45.

### Second answer, HITL

After `288214b` the session's step 6 ran again on the fixed code and the human
answered HITL. The detail line reports that it added `HITL`, removed `AFK` and
`grill-me`, and read the labels back. The result marker is dated 22:16:19.

### Autonomy and the second persist (2026-11-05)

The definition persisted at 20:59:53 said AFK under `### Autonomy`, and the labels
said HITL (F7, fixed in `67ffd23`). In the session the heading in `definition.md`
was renamed to `### Proposed autonomy` with the text unchanged, and persist ran
again at 18:01:51, with the persist code of `288214b`. The report reads:

```text
outcome: advance
description: written, read back
comment: already posted, found
exit code: 0
```

It also carries the re-serialisation note. The receipt now holds
`"at": "2026-11-05T18:01:51.225Z"`. The task still has one comment. The
description it read held the auto-linked identifiers of F6 in its original block,
and the run passed over them. The new section still begins `AFK:` and the label
is `HITL`: the section is the grill's proposal and the label is the decision.

### Marker and artifacts

`result.json` holds outcome `completed`, `finishedAt` 2026-11-04T22:16:19Z and
this summary:

```text
Grilled DOT-121 into a confirmed single-task definition (GitHub blockers read at listing time, open-only, any repo, cut-short lists fail), added Open blocker to the autonomous glossary, persisted it and transitioned the task to HITL.
```

Its artifacts are `$STATE/attempts/linear/DOT-121/grill-me/1/definition.md`, the
`stage-summary.md` beside it, and `plugins/autonomous/GLOSSARY.md`. The glossary
entry is commit `a303d80`, `docs(autonomous): define open blocker (DOT-121)`: six
added lines that define **Open blocker**, on `feature/DOT-121-read-github-blockers`
of this repository (F8).

### Reconcile

Three runs with `--task linear:DOT-121` and `--account claude`, without `--stage`.
The first two ran without `--apply`:

| Run (UTC)           | Mode      | `reconcile`                                                                   | `launch`                              |
| ------------------- | --------- | ----------------------------------------------------------------------------- | ------------------------------------- |
| 2026-11-04 21:08:58 | dry run   | `1 attempt observed`, `nothing changed`. No result marker, action `observed`. | `wait`, excluded: `classification`    |
| 2026-11-05 17:53:44 | dry run   | `1 attempt observed`, `1 would-finalise`. Marker ok, action `finalised`.      | `wait`, excluded: `taken`             |
| 2026-11-05 18:13:22 | `--apply` | `1 attempt observed`, `1 finalised`. Marker ok, action `finalised`.           | `wait`, excluded: `unsupported stage` |

The real run exited 2: its outcome is `wait` because `launch` had nothing to start.
The attempt record afterwards:

- State `completed`. History: `pending`, `created` and `started` at 2026-11-04
  20:10:35, `completed` at 2026-11-05 18:13:22.
- `taken.added` 2026-11-04 20:10:35, `taken.removed` 2026-11-05 18:13:22.
- The record keeps the agent conversation id. `cleanup` and `retained` are null.
- The session is gone. `aoe list --all` does not list `864a753c360d416b` (read on
  2026-11-05, after the reconcile). Reconcile finalises in a fixed order: capture
  and conversation id, session removal, `completed`, then the `taken` removal.
- `capture.txt`, 53 lines, was saved in the attempt directory.
- The dotfiles worktree is still on disk, with no commit beyond `main`.

The labels read after the reconcile are `personal`, `proposal` and `HITL`. The
state is still Backlog.

The 9.2 criterion holds. The definition and the stage summary are persisted, with
the headings and the comment above. The labels moved from `personal`, `grill-me` to
`personal`, `proposal`, `HITL`, with `taken` held until the reconcile. The reconcile
removed the session and `taken`.

## Step 3 (9.3): sandbox cases

Pending.

## Findings

| Id  | What happened                                                                                                                                                                                                      | Outcome                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| F1  | Linear re-serialises Markdown, so the persist read-back comparison failed on a description with dash bullets and a link (2026-11-03, DOT-122).                                                                     | Fixed in `8755bc8` `fix(autonomous): confirm persisted descriptions by their text`. Re-tested, below.                |
| F2  | With an empty original description, Linear strips the newline after `## Original description`; the next splice nested the description.                                                                             | Fixed in `40a97b5` `fix(autonomous): find the separator at the end of a stripped description`. Confirmed on DOT-124. |
| F3  | In auto permission mode the classifier denied teammate tracker writes (`gh repo create`, Linear `issue create` of the throwaway issues).                                                                           | Process finding, not a code defect. The user ran those writes with the `!` prefix.                                   |
| F4  | `python3 agentic-task/scripts/workspace-links.py --check` exits 1 on a stale relative pointer (`../agentic-task/.beads`) in another worktree. By code reading, `--apply` raises before writing, so it was not run. | Outside this change. The redirect was written by hand (step 1).                                                      |
| F5  | Linear acknowledged a label write but served reads without it for at least 8.4 s, so the transition's read-back failed and removed nothing (2026-11-04, DOT-121).                                                  | Fixed in `288214b` `fix(autonomous): wait out a tracker's read lag in every read-back`. Section below.               |
| F6  | About a minute after a persist, Linear replaced issue identifiers in the description with Markdown links, so a letters-and-digits comparison fails on the URL (2026-11-04, DOT-121).                               | Fixed in `288214b`: a link compares by its text. Confirmed by the 2026-11-05 persist on DOT-121.                     |
| F7  | Persist runs before the transition asks for the autonomy, so the definition said AFK while the human chose HITL and the labels said HITL (2026-11-04, DOT-121).                                                    | Fixed in `67ffd23` `fix(autonomous): record the grill's autonomy as a proposal`. Section below.                      |
| F8  | Repository inference reads the Linear project `Dotfiles`, so the session started in a dotfiles worktree while the code and the glossary live in this repository (DOT-121).                                         | Not fixed in this change. Follow-up.                                                                                 |

### F1: the first Linear round trip (2026-11-03)

A throwaway Linear issue, DOT-122, with an original description of 195
characters. The record `linear:DOT-122:grill-me:1` (state `started`, stage
`grill-me`), `definition.md` and `stage-summary.md` were written under a
temporary `AUTONOMOUS_STATE`. Persist ran twice at commit `8ffcadf`:

```bash
AUTONOMOUS_CONFIG=$KIT/config.json AUTONOMOUS_STATE=<scratchpad>/linear-rt/state \
  bun plugins/autonomous/src/run.ts --apply --persist linear:DOT-122:grill-me:1 --json
```

Both runs exited 3 (run 1 at 18:17:05 UTC, run 2 at 18:17:15 UTC):

```text
{"outcome":"not-evaluable","written":{"description":true,"comment":"none"},"readBack":{"description":false,"comment":false},"reasons":["linear DOT-122: the description read back differs from the one written"],"receipt":null}
```

No comment was posted and no receipt was written. The comparison ignored only
trailing whitespace. The diff between the text written and the text Linear
returned shows the whole difference: `-` list markers, nested ones too, come
back as `*`, and external link destinations come back wrapped in `<>`. Task
items (`- [ ]`) stay as written. Everything else is identical, including the
`<draft>` and `snake_case_name` probes outside code.

```text
-- A second run leaves the description unchanged and posts no second comment.
+* A second run leaves the description unchanged and posts no second comment.
-...a [link](https://example.com/docs)), and the stage would fail...
+...a [link](<https://example.com/docs>)), and the stage would fail...
```

The user decided the fix: compare the letters and digits in order. When the text
matches but the bytes do not, the report carries a note and the tracker's
version is kept in `description.read.md`; a text difference still fails with no
receipt.

### F2: the empty original description

`SEPARATOR` ends with a newline. With an empty original description the spliced
description ends with `## Original description` and that newline. Linear returns
it without the newline, so the next splice did not find the separator and
nested the whole description under a new heading. A stub that trims reproduced
it. On DOT-124 (empty original, after the fix) the description Linear returned
after run 1 ends with `## Original description` and no newline, and run 2
replaced the definition in place.

### Re-test after the fixes (2026-11-04)

Two throwaway issues, DOT-123 with an original description and DOT-124 with an
empty one, two persist runs each at 20:06 UTC, with the same command:

| Issue   | Run | Started (UTC) | Exit | `written.comment` | `readBack` (description, comment) | Receipt          |
| ------- | --- | ------------- | ---- | ----------------- | --------------------------------- | ---------------- |
| DOT-123 | 1   | 20:06:01      | 0    | `posted`          | true, true                        | `persisted.json` |
| DOT-123 | 2   | 20:06:12      | 0    | `existing`        | true, true                        | `persisted.json` |
| DOT-124 | 1   | 20:06:26      | 0    | `posted`          | true, true                        | `persisted.json` |
| DOT-124 | 2   | 20:06:38      | 0    | `existing`        | true, true                        | `persisted.json` |

Every run reported outcome `advance` and the re-serialisation note:

```text
linear DOT-123: the tracker re-serialised the description; its text matches what was written, and what it returned is at <attempt dir>/description.read.md
```

Each issue has one comment after run 2, headed
`autonomous · grill-me · linear:<id>:grill-me:1 · definition saved`. The
description read back after run 2 is identical to the one after run 1. On DOT-124
it holds one `## Definition` and one `## Original description`. A read-only
`linear api` query on 2026-11-04 returned `trashed: true` for DOT-122, DOT-123
and DOT-124. The evidence is kept in the orchestrator session's scratchpad:
`<scratchpad>/linear-rt/out/DOT-122/` (`run1.json`, `diff1.txt`), `DOT-123/` and
`DOT-124/`.

### F5: a label write that reads did not show (2026-11-04)

The first transition answer on DOT-121 (AFK, 21:01 UTC) exited 3 with a read-back
mismatch and `nothing was removed`. Linear's history shows both adds: `AFK` at
21:01:20.510 and `proposal` at 21:01:22.072. The read-back is one read straight
after the last write, and it listed `personal`, `grill-me`, `taken` and `AFK`. The
session's own reads from 21:01:30.6 to 21:01:33.8 still lacked `proposal`, so the
lag lasted at least 8.4 s. A read at 21:09 listed it.

The cause is on Linear's side, not a lost write:

- linear-cli 2.6.0 sends one `issueUpdate` with `addedLabelIds` and waits for
  `success`. It never reads the issue's labels, so no read-modify-write could drop
  one, and it keeps no cache.
- The `taken` read-back and the label-triage read-back also read once, straight
  after the write. They passed only because the lag did not reach them.

Fix `288214b`: a shared `readUntil` reads again after 1, 2, 4, 8 and 15 s, at most
six reads over 30 s, until the read shows the write. The transition, persist (the
description and the comment), the `taken` label and label-triage use it. A mismatch
after the last read says `read 6 times over 30 s`. A failed read is returned at
once. The true bound of the lag is unknown; 30 s is about three and a half times
the 8.4 s seen.

### F6: Linear links the identifiers after a save (2026-11-04)

The description read after the first persist held `[DOT-110](https://linear.app/…)`
and `[DOT-121](https://linear.app/…)` where the persisted text had `DOT-110` and
`DOT-121`. Linear's history shows the persist's description write at 20:59:57.904
and a second `updatedDescription` row at 21:01:00.573, about a minute later. A
comparison of letters and digits, the rule of F1, counts the letters of the URL and
fails. A check of the original block against the baseline reported a difference
for the same reason.

Fix `288214b`: a Markdown link compares by its text. The 2026-11-05 persist, run
over a description whose original block still held two such links, exited 0 with
outcome `advance`.

### F7: the autonomy the description states (2026-11-04)

Persist runs at step 4 and the transition asks the human for the autonomy at step 6.
The definition on DOT-121 said AFK under `### Autonomy`, the human answered HITL,
and the description contradicted the labels. Fix `67ffd23`: the template's section
is `### Proposed autonomy`. It records what the grill proposes. The label the
transition sets is the decision, and the agent does not persist a second time. On
DOT-121 the heading was renamed in the session and the definition persisted again,
once, on 2026-11-05 (above).

### F8: repository inference (2026-11-04)

Inference reads the Linear project. DOT-121 belongs to `Dotfiles`, so the launch
created its worktree from `$WS/dotfiles`. The code and the glossary of the task live
in this repository. The session made the glossary entry here: commit `a303d80`
(`plugins/autonomous/GLOSSARY.md` only) on `feature/DOT-121-read-github-blockers`,
stacked on `8755bc8` and pushed. The dotfiles worktree has no commit beyond `main`.
The definition's decisions and the stage summary say where the work lives. This
change does not fix the inference. It is a follow-up.

## Cleanup

Pending.
