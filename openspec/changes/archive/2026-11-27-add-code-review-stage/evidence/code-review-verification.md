# Code review stage verification

End-to-end checks of tasks 12.1–12.3. The plugin code under test is this feature worktree,
`feature/DOT-164-add-code-review`, at commit `25dc2c0`, run from source. Every tracker write had the
user's go-ahead in the Plannotator Inbox thread "DOT-164 etapa de code review (apply)", given on
2026-11-25 at 22:25 UTC: the bootstrap "Sí, con el loop parado", the launch "Sí, lánzala", and the
sandbox cases "Solo después de 12.2". The orchestrator relayed these answers; the thread is not in the
evidence directory.

The kit is `~/.local/state/autonomous/implementation-verification`. Its configuration holds the real
configuration plus `runner` and `sessions` (`17`: no line exists only in the real configuration). Its
wrapper `bin/claude` was re-pointed from `feature-add-verify-stage` to this worktree before the launch
(`30` before, `31` after: one `--plugin-dir` line changed). The raw files are in
`~/.local/state/autonomous/implementation-verification/evidence-12` (`$EVID` below) and are cited by
number. Where a teammate's report disagrees with a raw file, the raw file wins and the text says so.
The 12.3 sandbox cases ran on a second kit, `~/.local/state/autonomous/verification-sandbox`, with
their raw files in its `evidence-12.3` directory (`$EV` in section 12.3).
Times are UTC. The directory listing `82` shows local time (UTC+1); this text converts it.

## 12.1 Bootstrap of `external-review`

2026-11-25 22:27–22:32 UTC, with the loop stopped and the kit's configuration (Beads, four GitHub
repositories, Linear).

Preflight (`00`–`03`, `18`, `19`; 22:27:00): no `loop.lock`, no `run.lock` and no `run.ts` process
(`01`). `external-review` was absent in the four repositories and in Linear; `code-review` was present
in all five (`02`, `03`). Every other contract label already had its contract colour: `18` lists 11
labels per repository, all `ok`, and the Linear listing shows no drift.

Before: the label listings in `02` and `03` hold no `external-review`.

`bun plugins/autonomous/src/run.ts --bootstrap-labels --json` (`20`, started 22:31:17): exit 0,
`autonomous.bootstrap.v1`, outcome `advance`. Beads reported `applicable` `false`, reason "Beads needs
no label creation: labels exist by use". In the four repositories and Linear, 55 label rows were
`present` and 5 were `created`, all `external-review`:

| Scope                                   | Label             | Status    | Colour    |
| --------------------------------------- | ----------------- | --------- | --------- |
| `pabloimrik17/dotfiles`                 | `external-review` | `created` | `#8b5e3c` |
| `pabloimrik17/kinkoi-project`           | `external-review` | `created` | `#8b5e3c` |
| `pabloimrik17/monolab`                  | `external-review` | `created` | `#8b5e3c` |
| `pabloimrik17/daily-agentic-task-force` | `external-review` | `created` | `#8b5e3c` |
| Linear workspace                        | `external-review` | `created` | `#8b5e3c` |

No row was `recoloured` or `failed`. A second run (text report, `21`, started 22:31:31) exited 0 and
reported all 12 labels, `external-review` included, `present` in every scope. Read-back (`22`, `23`):
`gh label list --search external-review` shows `external-review #8b5e3c` in the four repositories, and
`linear label list --all` shows `external-review #8b5e3c Workspace` (19 labels; 18 before).

PASS: `external-review` exists with its contract colour on every tracker that needs label creation.

## 12.2 Real task: DOT-121

2026-11-25 22:32 UTC to 2026-11-26 21:06 UTC. The task is Linear DOT-121, "Read GitHub blockers in the
selection reader" (`personal`, `HITL`, state Backlog), with the draft pull request
`pabloimrik17/daily-agentic-task-force#90` on
`feature/DOT-121-read-github-blockers-in-the-selection-re`. Its labels before the run were `personal`,
`HITL` and `code-review`; it had four comments (the grill-me, proposal, implement and verify stage
summaries) and the description hash `a00f3aec…3102` (`07`, `52`). The pull request was `OPEN`, a
draft, at head `717baa3`, with no review and no thread (`06`, `08`, `53`, `54`). The worktree was
clean, in sync with its branch on the remote, with nothing unpushed (`10`, `55`). The change
`read-github-blockers` was active there with 10 of 10 tasks done (`11`). A second worktree,
`feature-DOT-121-read-github-blockers` at `a303d80`, belongs to an older branch and was not used
(`09`). The loop was stopped for the whole run.

### Preflight and launch

- A read-only scout ran the preflight at 22:27 UTC (`00`–`19`). The configuration check (`17`), the
  label colour check (`18`) and the checks of the task, the pull request, the worktree and the change
  (`04`–`12`) found nothing to fix. No attempt directory `code-review` and no aoe session mentioned
  DOT-121 (`15`, `16`).
- The first label line in `04` shows `"comments": 1` and `05` prints `1`: the jq expression counted
  the keys of the `comments` object. `07` and `52` count the comments themselves: 4.
- Two dry runs at 22:27–22:28 UTC (`40` with `--stage code-review`, `41` without) both exited 0 and
  gave the same `launch` step: `would launch code-review for linear:DOT-121 … as "auto 🧐 Read github
  blockers in (DOT-121)"`. The title comes from the fallback, because the LLM name `Read GitHub
  blockers in selection` has 5 words and the limit is 4. Both show `input` `supplied`. After them no
  file under `~/.local/state/autonomous` was newer than the start and the labels were unchanged
  (`42`).
- The pre-launch check (`50`–`58`, 22:31:48) found the same labels, four comments, the same
  description hash, the pull request `OPEN`, draft, head `717baa3`, 0 threads, a clean worktree, no
  lock, no attempt directory and `external-review` present in the repository.
- The launch (`--apply --task linear:DOT-121 --stage code-review --json`, `60`, 22:32:10) exited 0:
  reconcile, capacity (grill slots 1/1, work slots 1/4), quota gate (session 22 %, weekly 28 %) and
  launch all `advance`. It created attempt `linear:DOT-121:code-review:1`, state `started`, in the
  existing worktree (`workspace.created` `false`), with the aoe session `8c4b561f9af044ca` (`63`,
  `64`). The record (`61`) holds `agentArgs` `["--model","opus","--effort","high"]` and the history
  `pending`, `created`, `started`, all at 22:32:10.409. The labels after the launch were `HITL`,
  `code-review`, `personal`, `taken` (`66`). The agent session id is
  `896a0f87-8540-45a2-b725-89561022df5e` (`65`). The session received `Read <attempt
  directory>/prompt.md and follow it.` at 22:32:33.
- The prompt (`62`, 66629 bytes) holds the bodies of the branch's `review-team` and
  `adversarial-review` skills with no `${CLAUDE_PLUGIN_ROOT}` left and no `feature-add-verify-stage`
  path (both counts 0). `67` counts: `read-github-blockers` 14, `pull/90` 5, `#90` 8, `HITL` 7,
  `--publish` 2, `--persist` 1, `--transition` 1, `--log` 1, `review-team` 4, the threads heading
  `Threads a code review published` 1, `The walkthrough` 2, the plugin path 4, the `findings.json` path
  2, the `review` directory path 1. `adversarial-review` counts 0 in `67` because a skill's
  frontmatter is stripped; the body is present (`# Adversarial review` at line 427, `# Review team` at
  line 581). `AFK` counts 5, at lines 54, 302, 304, 355 and 365, all inside DOT-121's own description
  and comments (the stage instructions start after line 385); the stage instructions hold no `AFK`
  text. The three lines `---` are separators in the task description.
- Plugin loaded: the session's transcript holds 16 mentions of `plugins/autonomous/src/run.ts`, all
  under the DOT-164 worktree (`68b`).
- The watch (`watch-12.2.sh`, log `watch-12.2.log`) started at 22:32:32.

### The review team

At 22:32:53 the orchestrator ran `review-team/cli.ts plan` with no `--tier`. The plan
(`70-attempt-copy/review/plan.json`): tier measured `L`, used `L`; 1564 lines in 24 files; no security pattern matched; five reviewers.
The measure counts no file under `openspec/changes/` (`measure.ts`), which is why 24 differs from the 29
file diffs in the review's patch.

| Reviewer      | Kind     | Engine                                       | Duration | Result                       |
| ------------- | -------- | -------------------------------------------- | -------- | ---------------------------- |
| `walkthrough` | teammate | Claude Code 2.1.332, `opus`, effort `medium` | 175.7 s  | ran: draft guide, 7 sections |
| `code-review` | teammate | Claude Code, `opus`, effort `high`, `xhigh`  | 420.6 s  | ran: 8 findings, 2 doubts    |
| `tests-lens`  | teammate | Claude Code, `opus`, effort `high`           | 177.8 s  | ran: 4 findings, 1 doubt     |
| `coderabbit`  | CLI      | CodeRabbit 0.9.6                             | 192.3 s  | ran: 2 findings              |
| `codex`       | CLI      | Codex CLI 0.171.0, effort `high`             | 7.7 s    | skipped, model not supported |

Codex was skipped. Its reason, in the report and in the record's `review.skipped`: "codex: The
'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account." The plan passes Codex
an effort and no model (`plan.json`), so Codex used `model = "gpt-6.1-sol"` from the user's
`~/.codex/config.toml` (the orchestrator's finding; the header of `review/raw/codex.stderr.txt`
shows `model: gpt-6.1-sol`). The plan's own `skipped` list is empty: the skip is recorded when the
reviewer runs, in `report.md` (section "Reviewers", "Skipped"). Codex's run command exited 0
(task notification, 22:34:13).

The orchestrator started the three teammates at 22:33:33, 22:33:49 and 22:34:05, and ran Codex and
CodeRabbit as background commands at 22:33:11 and 22:33:13. `collect` ran at 22:40:07 and the report
(`report.json`, `report.md`, `walkthrough.html`) appeared at 22:40:12. The report holds 1 `CRITICAL`,
5 `WARNING`, 10 `SUGGESTION` and 4 doubts, and the "Walkthrough guide" line.

### The finding triage and the refutation

The orchestrator's last events before the stall are two Inbox `read_thread` calls at 22:41:03 and
22:41:07 and one more message at 22:41:22 (see F1). The triage was written after the nudge and sent at
18:19:03 on 2026-11-26 to the Inbox thread "DOT-121 code review" as a message with two `:::question`
blocks. It merged the 16 reported findings and the 4 doubts, plus the verification's items, into 15
findings and 2 doubts. It proposed: fix f5, f6, f7, f8, f12, f13, f14; defer f2 to a follow-up; dismiss
f3, f4, f9, f10, f11, f15 (each below the floor and contradicted by the code or the definition); settle
d1 and d2 against the references. The two questions were:

1. f1 (`CRITICAL`): what to do with a finding whose fix would change the definition (D4: a cut-short
   list fails the read for every listed issue). The options kept their order, with the recommendation
   on its own line.
2. Whether to approve the rest as listed.

The human answered at 20:21:58 (the thread said "Your last message was 2 hours ago"): for f1 "Keep it as
specified, and create a follow-up task to revisit the rule in its own grill"; for the rest "Approve as
listed" (orchestrator's relay of the Inbox thread, confirmed by the answer text in the transcript).
The refutation started at 20:22:35, after the answer, so the human saw the triage before it.

Three refuters ran on `sonnet` at effort `medium`, started at 20:22:35, 20:22:43 and 20:22:53 and
finished between 20:24:22 and 20:25:21:

| Refuter    | Findings         | Outcome                                                                                                              |
| ---------- | ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| `refute-a` | f1, f2           | Both survive. Four reproduction tests fail on the current code.                                                      |
| `refute-b` | f5, f6, f14      | All survive by mutation of `readers/github.ts` (suite 1527/1527 before). f6 only in part: a `gh` failure is refuted. |
| `refute-c` | f7, f8, f12, f13 | f13 and f8 survive; f7 and f12 are refuted. f13 has a reproduction test.                                             |

The reproduction tests are kept in `70-attempt-copy/repro/` (`repro-f1.test.ts`, `repro-f2.test.ts`,
`repro-f13.test.ts`) and were removed from the working tree; the refuters reported `git status --short`
empty at their handbacks. The record (`70-findings.json`, digest in `70-findings.sha`, `326e6489…36e7`) holds
every finding with its outcome:

| Finding | Severity     | Reporter(s)                                        | Destination | Refutation  | Publication       |
| ------- | ------------ | -------------------------------------------------- | ----------- | ----------- | ----------------- |
| f1      | `CRITICAL`   | code-review                                        | defer       | survived    | deferred, DOT-169 |
| f2      | `WARNING`    | code-review                                        | defer       | survived    | deferred, DOT-170 |
| f3      | `WARNING`    | coderabbit                                         | dismiss     | not-refuted | none              |
| f4      | `WARNING`    | coderabbit                                         | dismiss     | not-refuted | none              |
| f5      | `WARNING`    | tests-lens                                         | fix         | survived    | fixed, `d6caa65`  |
| f6      | `WARNING`    | tests-lens                                         | fix         | survived    | fixed, `92d6e31`  |
| f7      | `SUGGESTION` | walkthrough, code-review, tests-lens, verification | fix         | refuted     | none              |
| f8      | `SUGGESTION` | walkthrough                                        | fix         | survived    | fixed, `732f05d`  |
| f9      | `SUGGESTION` | code-review                                        | dismiss     | not-refuted | none              |
| f10     | `SUGGESTION` | code-review                                        | dismiss     | not-refuted | none              |
| f11     | `SUGGESTION` | code-review                                        | dismiss     | not-refuted | none              |
| f12     | `SUGGESTION` | code-review                                        | fix         | refuted     | none              |
| f13     | `SUGGESTION` | code-review                                        | fix         | survived    | fixed, `9813df3`  |
| f14     | `SUGGESTION` | tests-lens                                         | fix         | survived    | fixed, `e9ffefa`  |
| f15     | `SUGGESTION` | verification                                       | dismiss     | not-refuted | none              |
| d1      | doubt        | walkthrough, verification                          | settled     |             | none              |
| d2      | doubt        | tests-lens                                         | settled     |             | none              |

f1's reason is the human's decision: keep the behaviour the definition specifies and revisit the rule
in its own grill. f1 stays `CRITICAL` and goes to `defer`, not to `fix`, because its fix would change
the definition, which the stage must not do for an `HITL` task without asking the human (the spec,
"The code review never changes the proposal or the definition"). The human was asked and chose.
Refuted: f7, because the `repository` field and the id are built from the same configured repository;
f12, because nothing compares task ids with blocker ids.

### Fixes and checks

Fixes ran one at a time, each ending in its commit before the next fixer message (`76` has the author
dates, local time converted):

| Finding | Commit    | Committed (UTC) | Files                                                         | Fix checks                                   |
| ------- | --------- | --------------- | ------------------------------------------------------------- | -------------------------------------------- |
| f5      | `d6caa65` | 20:29:29        | `github.test.ts` (+2)                                         | 2: first `REJECT` (20:28:43), then `ACCEPT`  |
| f6      | `92d6e31` | 20:31:01        | `github.test.ts` (+25)                                        | 1: `ACCEPT`, both mutations caught           |
| f14     | `e9ffefa` | 20:33:17        | `github.test.ts` (+12)                                        | 1: `ACCEPT`, three lenient reads each caught |
| f13     | `9813df3` | 20:36:41        | `github.ts` (+26 −19), new `github-listing-cap.test.ts` (+34) | 1: `ACCEPT`, one side effect noted           |
| f8      | `732f05d` | 20:38:41        | `trackers/github.ts` and `readers/github.ts` (+5 −5 in total) | 1: `ACCEPT`, a pure rename                   |

- f5's first fix widened the argument assertion to eight arguments, pinned `--state open` and hardcoded
  `"1001"`. The checker rejected it as doing more than the finding asks, and named the minimal fix. The
  fixer revised it; the second check accepted (20:29:21) and the commit followed (20:29:29). This is
  the two-check limit of the skill, reached and not exceeded.
- The f13 checker noted that, over the cap, a malformed blocker entry now also reports the cap error.
  The orchestrator took this as the intent of f13 and committed. The logbook entry lists it as a
  decision: let the listing cap error win over blocker errors.
- The f13 fix keeps its reproduction as the regression test `select/github-listing-cap.test.ts`
  (`70-attempt-copy/repro/repro-f13.test.ts` is its source). The skill says a fixer never changes it;
  it was put back in the tree before the fixer started.
- The orchestrator ran the commit and the push in one command per fix (`git commit -q -m …`, `git push
  -q`), staged by path, with no `--no-verify` and no `--amend` in any of the five commands. The commits are conventional with
  the scope `autonomous`; none is breaking. `git log` shows 5 commits after `717baa3`.
- At 20:40:32 the eight repository checks ran: `lint:oxfmt`, `lint:eslint`, `lint:markdownlint`,
  `lint:knip`, `lint:fallow`, `lint:marketplace`, `typecheck` and `test` all exited 0; `test` reports
  2011 tests passed. The branch head was `732f05d`, equal to the remote's (`76`).
- No teammate staged, committed or pushed: `84` counts 0 tool commands with a git mutation in each of
  the eight teammate transcripts, and a search of their `Bash` commands for `git add`, `commit`, `push`,
  `stash`, `checkout`, `restore`, `reset` and `apply` found none. One refuter used `git worktree add
  --detach` and `git worktree remove` on a throwaway path (see F8); `84`'s pattern does not count
  those.

The agents (`83`, `84`, `71`, and each transcript's own lines). The orchestrator's 235 assistant
messages were all `claude-opus-5-5` at effort `high`. `83` counts 117 tool calls: `Bash` 58,
`SendMessage` 27, the Inbox tool 11, `Agent` 9, `Write` 6, `ToolSearch` 2, `Skill` 2, `Read` 1 and
`ListAgents` 1. The 9 `Agent` calls started 8 teammates; the first `check-f5` call failed (F6).

| Teammate          | `subagent_type`          | Model passed | Effort passed | In its transcript             | Messages |
| ----------------- | ------------------------ | ------------ | ------------- | ----------------------------- | -------- |
| `rev-walkthrough` | `general-purpose`        | `opus`       | `medium`      | `claude-opus-5-5`, `medium`   | 15       |
| `rev-code-review` | `general-purpose`        | `opus`       | `high`        | `claude-opus-5-5`, `high`     | 8        |
| `rev-tests-lens`  | `general-purpose`        | `opus`       | `high`        | `claude-opus-5-5`, `high`     | 18       |
| `refute-a`        | `general-purpose`        | `sonnet`     | `medium`      | `claude-sonnet-5-5`, `medium` | 16       |
| `refute-b`        | `general-purpose`        | `sonnet`     | `medium`      | `claude-sonnet-5-5`, `medium` | 33       |
| `refute-c`        | `general-purpose`        | `sonnet`     | `medium`      | `claude-sonnet-5-5`, `medium` | 25       |
| `fix-f5`          | `apply-implementer-lite` | none         | none          | `claude-sonnet-5-5`, `medium` | 34       |
| `check-f5`        | `general-purpose`        | `haiku`      | none          | `claude-haiku-5-5`, `medium`  | 50       |

`fix-f5` has the model and effort of its definition (`~/.claude/agents/apply-implementer-lite.md`:
`sonnet`, `medium`, tools `Bash, Read, Edit, Write, Grep, Glob`). `check-f5` ran at the default
effort. Each of the five fixes was made by `fix-f5` and judged by `check-f5`; see F5.

### Publication and threads

Publish mode ran at 20:50:20 through the `autonomous:run` skill (`run.ts --apply --publish
linear:DOT-121:code-review:1`) and wrote `published.json` (`72`): schema `autonomous.published.v1`,
`publishedAt` 20:50:24.546, `findingsDigest` `326e6489…36e7`, equal to the digest of `findings.json`
(`70-findings.sha`). It posted one review (`COMMENTED`, body "Code review, round 1 / Threads: 0 open, 4
resolved / Review team: tier L, skipped codex (…)" with the `autonomous:review v1` marker) and four
threads (`73`):

| Finding | Thread (resolved) | Anchor                             | Status line         | Comment URL              |
| ------- | ----------------- | ---------------------------------- | ------------------- | ------------------------ |
| f1      | yes               | `readers/github.ts:51`, line       | deferred to DOT-169 | `discussion_r4713259354` |
| f2      | yes               | `readers/github.ts`, file (`FILE`) | deferred to DOT-170 | `discussion_r4713259446` |
| f5      | yes               | `readers/github.test.ts:67`, line  | fixed in `d6caa65`  | `discussion_r4713259543` |
| f6      | yes               | `readers/github.ts:96`, line       | fixed in `92d6e31`  | `discussion_r4713259655` |

The thread comments open with `issue (blocking)` for f1 (`CRITICAL`) and `issue` for the others, carry
the folded trace (reporter, severity, reproduction, `Claude Code 2.1.332`) and the marker
`autonomous:finding v1 attempt=linear:DOT-121:code-review:1 finding=<id>`. f2's thread is file-level:
`subjectType` `FILE` in `73` (GitHub shows `line` 1). The thread comments name the reproduction tests
`select/repro-f1.test.ts` and `select/repro-f2.test.ts` "kept outside the tree": no such file is in the
repository.

Nothing else was published: the fixed `SUGGESTION`s (f8, f13, f14), the refuted findings (f7, f12),
the dismissed findings (f3, f4, f9, f10, f11, f15) and the settled doubts (d1, d2) have no thread,
as the spec requires. The review count is one, and the pull request has no other review and no
`reviewDecision`. After the run the pull request was `OPEN`, `isDraft` `true`, `mergeable`
`CONFLICTING`, `mergeStateStatus` `DIRTY`, head `732f05d` (`73`).

The follow-up tasks (`77`, `88`): DOT-169 (from f1) and DOT-170 (from f2), both labelled `personal` and
`grill-me` at creation, project "Daily agentic task force", no parent and no children. DOT-169 is
related to DOT-121; DOT-170 is related to DOT-121 and to DOT-169. `88-relations-DOT-169.txt` and
`88-relations-DOT-170.txt` (`linear issue relation list`) show these relations. They are relations,
not subtasks. The closer's report said "description text only" because `issue view --json` has no
relations field; the raw files win. The orchestrator created DOT-169 after the human's first answer
(about 20:41) and asked an extra question for DOT-170's labels. Its judged inputs to the labelling
helper were `grill-me` at 0.9 for f1 and `AFK` at 0.75 for f2; its message to the human says the helper
would not choose f2's autonomy on its own. The human answered at 20:49:59:
"grill-me: refine it with you first, alongside f1's grill" (the thread's relay and the answer text in
the transcript). DOT-170 was created at about 20:50. No absolute path or machine detail is in the
follow-up descriptions, the thread comments, the stage summary, the logbook entry, `findings.json` or
the five commits (grep for `/Users/`, and for `/private/tmp` outside the commits: 0 in each).

### The walkthrough

The review team's draft (`review/walkthrough.json`) had 7 sections and one unplaced file
(`.openspec.yaml`). Publish mode brought it to the final diff: 8 sections, the trailing section "Code
review fixes" holding the new `github-listing-cap.test.ts`, and a patch of 30 file diffs (the draft's
patch had 29). Its rendering (`75`, `walkthrough.md`, 116 words) counts findings per section: "The
GitHub reader lists issues itself" 3 (f1, f2, f6), "Reader and selection tests" 1 (f5), the other six 0.
The digest of the walkthrough is in `published.json` (`walkthroughDigest` `2c9dc9c6…9570`).

The orchestrator sent the outcome summary to the Inbox thread at 20:51:22: each finding by outcome with
its reason, the thread links, the follow-up tasks and the pull request's URL (still a draft, still
conflicting). It then sent the walkthrough as a guided review with `review: true` at 20:51:30 (see
F10: the Inbox tool's `submit_guide` was reached over the Inbox's local HTTP endpoint with a script).
The human opened it and answered at 20:55:04: "I approved your review "Read GitHub blockers in the
selection reader"", with no comment.

### Human rounds

None ran. The human's only verdict on the walkthrough was an approval with no feedback (20:55:04). At
20:55:08 the orchestrator listed the pull request's review comments and issue comments newer than
20:51:00: none, and `git status` was clean. The prompt (section 7) ends the rounds once the human has
no more feedback; the orchestrator then went to the stage summary.

Task 12.2 requires at least one human round. This run did not meet that requirement. The user decided
(Inbox, about 21:00 on 2026-11-26) "Approve ahora y cubrir la ronda humana en un caso HITL extra de
12.3, con la ronda antes del resumen". `tasks.md` 12.3 gained case 5 for it: an `HITL` task with at
least one human round before the stage summary, a comment recorded as a finding of the reviewer
`human`, answered in its thread and published again, then `Approve`. The refutation's advisory mode,
the human-comment severity rule and the repeated rounds were therefore not exercised here.

### Closing

The stage summary was written after the human's approval and posted by persist mode (`74`, `78`,
`79`, `82`). The closing files, by time (`82`, converted to UTC), are in the order the prompt sets:

| File               | Time (UTC) | What                                                                             |
| ------------------ | ---------- | -------------------------------------------------------------------------------- |
| `published.json`   | 20:50:44   | Publish receipt (`publishedAt` 20:50:24).                                        |
| `stage-summary.md` | 20:55:30   | The stage summary, 750 words.                                                    |
| `persisted.json`   | 20:55:39   | Persist receipt (`at` 20:55:33); the Linear comment is 20:55:38.                 |
| `transition.json`  | 21:03:36   | `answer` `["external-review"]`, `by` `human`.                                    |
| `logbook-entry.md` | 21:03:47   | The logbook entry, 224 words.                                                    |
| `logbook.json`     | 21:03:53   | Log receipt (`at` 21:03:47); the pull request comment is dated 21:03:53 in `79`. |
| `result.json`      | 21:03:58   | `completed`, 5 artifacts.                                                        |

- The stage summary comment on DOT-121 is the fifth comment (`78`): its first line is `autonomous ·
  code-review · linear:DOT-121:code-review:1 · stage summary saved`, and the description hash is still
  `a00f3aec…3102`. `comment.md` is the summary with that header line. The summary holds the pull
  request URL, the change, the five commits, tier L and the skipped Codex, every finding and doubt by
  outcome with its reason, the thread links, DOT-169 and DOT-170, the conflict with `main`, the
  proposed follow-up tasks ("None left proposed") and suggested skills.
- The transition ran as `run.ts --apply --transition linear:DOT-121 --from code-review` at 20:55:42
  and returned a handoff with one question, "Approve it to move the task to external-review?", with the
  options `Approve` (`external-review`) and `Later`. The orchestrator sent it to the Inbox as a
  `:::question` at 20:55:51, not through `AskUserQuestion`: `83` counts 0 `AskUserQuestion` calls
  (the user's Inbox rule; see F3). The human answered `Approve` and the orchestrator ran
  `run.ts --apply --answer 'transition:linear:DOT-121=external-review'` at 21:03:19. The watch saw the
  labels `HITL`, `external-review`, `personal`, `taken` at 21:03:53 (no `code-review`).
- The logbook entry is the pull request's last comment (`79`,
  `https://github.com/pabloimrik17/daily-agentic-task-force/pull/90#issuecomment-7203351668`,
  21:03:53). It has the sections `What I did`, `Decisions`, `Assumptions` ("None"), `Next stage` (it
  names the conflict with `main` and says it was not rebased) and `Code review`: the four threads, all
  resolved, with links; the fixed suggestions, unpublished; the refuted; "Dismissed: 6, listed in the
  stage summary"; and the walkthrough rendering. The header says `HITL`, `--model opus --effort high`,
  22 h 31 min, answered `external-review`, 5 commits.
- The pull request is still a draft (`73`): neither the prompt nor any mode marked it ready.
- The tracked-file grep (`76`) found 2 files, `plugins/stonks/src/checks/findings.ts` and
  `findings.test.ts`, unrelated to this run (the same two as in the 11.2 run). No attempt file is tracked.

### The reconcile

Without `--stage` (with it, a second attempt would launch). The dry run (`80`, 21:05:46) exited 2, the
code for a `wait`, with reasons "1 attempt observed, 1 would-finalise, 2 retained, nothing changed";
the attempt showed `before` `started`, session `idle`, marker `ok` and `stageNow` `external-review`.
The apply (`81`, 21:06:00) exited 2 as well: "1 attempt observed, 1 finalised, 2 retained". It listed 26
attempts, 1 `finalised` (DOT-121's) and 25 `none`. The 2 retained attempts are
`github:pabloimrik17/daily-agentic-task-force#89:grill-me:1` and
`github:pabloimrik17/dotfiles#228:proposal:1`, unrelated. The launch step said `linear:DOT-121 is
excluded: taken` in the dry run and `excluded: unsupported stage` after the apply, as the spec expects
(`external-review` is not a supported stage).

After it: the aoe session `8c4b561f9af044ca` is gone (`85`: "Session not found"); the labels are `HITL`,
`external-review`, `personal` (`86`, no `taken`); the record is `completed`, `taken.removed`
21:06:00.674, `cleanup` and `retained` null (`87`).

### Findings

Each has a verdict: defect of this change, not a defect, or operational. Inferences are marked.

- **F1: the Mac slept and the session stalled for 19 h 39 min (operational).** The review team's report
  was ready at 22:40:12. The Mac slept at 22:41 on 2026-11-25 on battery (the orchestrator's `pmset`
  log, not in the evidence directory), one minute later, and cut the session's turn: the transcript
  ends with `API Error: Your computer went to sleep mid-response` (an assistant line stamped
  23:53:46). The session sat idle until the orchestrator nudged it with `tmux send-keys` at 18:18 on
  2026-11-26: "Your computer went to sleep mid-response at 22:41 UTC, right after the review team's
  report. Continue the stage from where you stopped: write the finding triage, send it to the Inbox and
  carry on with the stage prompt's steps." The transcript shows the nudge at 18:18:25 and the triage
  sent at 18:19:03. Before it, `/reload-plugins plannotator` ran as a local command at 18:06:06. The
  watch hit its 16 h limit at 15:17:36 and was restarted at 18:18:39 (log lines `END`, `NUDGE`,
  `NOTE`); the `NOTE` says the 15:17 time was only the watch's limit. The watch's own clock gives a
  hint of the sleep: it logged nothing between 01:41:30 and 15:17:36, and its limit of 16 h from
  22:32:32 fell at 14:32, so the process was suspended past that time (inferred). The stage ended 22 h 31 min after the launch. Nothing in the specs covers a sleeping host.
- **F2: Codex was skipped (configuration, outside this change).** See "The review team". The review
  team passes no Codex model, so the user's own Codex configuration decides, and the ChatGPT account
  does not support `gpt-6.1-sol`. The skill's rule that an unavailable reviewer is skipped with its
  reason worked: the report, the record, the review's body, the stage summary and the logbook entry all
  name it. This is not a defect of this change.
- **F3: the transition question went to the Inbox, not to `AskUserQuestion` (not a defect).** The
  user's global Plannotator rule says a decision only they can make goes to the Inbox as a
  `:::question`. The README mentions `AskUserQuestion` only at lines 322, 356 and 372, where it
  describes the `/autonomous:run` command's round for a handoff; it does not say the code review
  session's approval is an `AskUserQuestion`, and its transition section says transition mode "hands
  off the approval question". No README change is needed. The prompt's closing step 5 says the
  transition "asks the human"; the run handed the question off and the session relayed it, then ran
  `--answer` (inferred wording gap, small). `transition.json` has `by` `human`, so the answer is the
  human's.
- **F4: no human round ran (not a defect of the stage; a gap in this check).** See "Human rounds". The
  requirement of 12.2 is not met here and moved to 12.3 case 5.
- **F5: one fixer and one checker were reused for all five fixes (not a defect; inferred).**
  `fix-f5` made f5, f6, f14, f13 and f8, and `check-f5` judged all five, f5 twice. Every fix was judged
  by a teammate other than its fixer, and no teammate refuted its own report: the reporters are
  `rev-*`, the refuters `refute-*`. The skill says "Start each phase's teammates fresh" and "A fix is
  judged by teammates other than its fixer"; it does not say a teammate may not take a second fix of
  the same phase. I read "fresh" as per phase, not per fix (inferred). The fixer's and checker's names
  say `f5` for all five. A fresh checker per fix would cost more and would not change the rule that
  holds here. The checker's context grew over five checks (50 messages).
- **F6: the terminal had no room for another teammate pane (operational).** At 20:27:39 the first
  `check-f5` call failed: "Failed to create teammate pane: size or position no space for a new pane".
  The orchestrator sent shutdown requests to the seven finished teammates, first as plain-text JSON
  (8 tool errors: "message text must not be a teammate protocol frame"), then with the structured form
  after loading `SendMessage` with `ToolSearch`. It started `check-f5` again at 20:28:10. `fix-f5` has
  no `SendMessage` tool, so it could not approve its shutdown and stayed available; the orchestrator
  then reused it (F5).
- **F7: a user-started Inbox thread reached an idle teammate (operational, outside this change).**
  At 20:38:56 the user started an Inbox thread, "Review #108", about an unrelated pull request. The
  plugin delivered it to `check-f5`, the idle checker session, and not to the orchestrator (the thread
  text appears in `check-f5`'s transcript only). `check-f5` answered it: at 20:41:10 it submitted a
  guided review of pull request #108 (thread "Review of PR #108") and reported that it changed no code.
  The orchestrator learned of it from the checker's idle notification at 20:41:12 and shut `check-f5`
  down at 20:41:47. The stage's commits, files and tracker state are unaffected. Cause (inferred): the
  plugin delivers a user-started thread to a live session of the project, and an idle teammate session
  counted.
- **F8: the refuters shared one working tree and ran at the same time (not a defect; the skill and
  the spec are silent).** `refute-b` edited `readers/github.ts` for its mutations from 20:24:06 to
  20:24:20 in the shared tree, while `refute-a` wrote its reproduction test there at 20:24:06 and
  `refute-c` at 20:24:25. The orchestrator's message to `refute-b` at 20:23:02 ("do NOT mutate files in
  it", use a detached throwaway worktree) reached it at 20:25:25, after those edits. `refute-b` then
  used `git worktree add --detach` at 20:25:33 and removed the worktree by 20:26:17, and reported `git status
  --short` clean. Whether the overlapping edits changed any reproduction's outcome is not established:
  all four of `refute-a`'s tests failed on the current code, and the later fix checks used their own
  mutations. This repeats the shared-tree point of the 11.2 run (F5 there). The orchestrator sent its message
  about 10 s after starting the third refuter.
- **F9: the watch's `QUIET` and `STALL` lines were mostly false alarms (operational).** `QUIET` at
  22:32:33 fired one second after the session started and named `b8f36799….jsonl`, a transcript
  last written on 2026-11-22; the session's own transcript did not exist yet (the watch takes the
  newest `.jsonl` of the project directory). `STALL` at 22:37:37 fired while three teammates ran: the
  orchestrator was `idle` waiting for them (the capture shows `◯ rev-code-review 3m`). `STALL` at
  20:44:57, 20:55:04 and 20:59:12 and the one at 18:22:17 are the orchestrator waiting for the human's
  answer to a question in the Inbox, which aoe shows as `idle`, not `waiting`. Only the `STALL` at
  01:41:30 was a real stall (F1). The watch cannot tell a wait for the human from a stall.
  aoe also showed `running` until 00:42:12, two hours after the turn was cut (inferred: its status follows the pane, which did not change).
- **F10: the prompt says to send the walkthrough by file path, and the Inbox tool takes content
  (gap, small; inferred).** The prompt (line 780) tells the agent to send "the guide `<path>` with its
  patch `<path>`" through the Inbox's `submit_guide` tool. The orchestrator wrote that the patch "is
  too large to pass inline" (103702 bytes) and wrote `submit-guide.ts`, which calls the Inbox's local
  HTTP endpoint, the fallback the Inbox's guide documents. Its first call used `send_message` with the
  guide keys and the endpoint refused it ("Unrecognized keys"); the second, with the tool name
  `submit_guide`, ran after the edit; its output was not shown, and the human's approval of the review
  suggests it delivered the guide (inferred). I did not check
  whether the MCP tool accepts a path; the orchestrator's text says it does not. If it does not, the
  prompt's instruction cannot be followed as written.
- **F11: f2's anchor differs from the review team's location (not a defect; inferred).** The report
  places `code-review-2` at `openspec/changes/read-github-blockers/specs/work-selection/spec.md:3`.
  The record places f2 at the file `plugins/autonomous/src/select/readers/github.ts`, where the fix
  lies, and its thread is file-level. Under the spec's rule (a finding located in the change's own
  artifacts goes to the human for `HITL`) f2 was still shown to the human in the triage and approved as
  listed, so the human decided it. The record does not say why the location changed.
- **F12: the pull request conflicts with `main` (not a defect).** `mergeable` `CONFLICTING`,
  `mergeStateStatus` `DIRTY` after the run (`73`). The preflight did not record the mergeability. The
  stage did not merge or rebase, and named the conflict in the triage, the stage summary and the
  logbook entry, as the spec requires.
- **F13: differences between the reports and the raw files.**
    - The closer's report said DOT-169 and DOT-170 are linked to DOT-121 by "description text only".
      `88` shows Linear relations ("related"), and `77` shows no parent. The raw files win.
    - The scout's runbook says the dry run shows no `agentArgs`; `61` shows them after the launch:
      `["--model","opus","--effort","high"]`.
    - The watch log's time for `result.json` (21:04:08) is the poll time; the file's own time is
      21:03:58.
    - `04` and `05` show 1 comment; the task has 4 (`07`, `52`).
- **Not seen in this run.** No `AFK` task, so no blocked path, no open `question (blocking)` thread and
  no refusal of the transition (12.3 cases 1–3). No fix was rejected twice. No finding was passed on to
  QA. No second attempt resumed earlier work, so a finding linked to an existing thread, the
  idempotent second publish run and the exact-match reply were not exercised. No `plannotator`-off
  launch (12.3 case 4). No human round (F4).

## 12.3 Sandbox cases

Five sandbox cases on two Beads tasks and two draft pull requests in `pabloimrik17/grill-sandbox`,
2026-11-26 21:34 to 22:34 UTC. The plugin code under test is this worktree at commit `25dc2c0`, run
from source, as in 12.2. The kit is `~/.local/state/autonomous/verification-sandbox`. Its
configuration (`00`, a copy of the file) enables Beads at the `agentic-task` directory and no Linear;
`runner.parallel` is 2 and there is no `review` block, so the review team ran with the shipped
tiers. Its wrapper `bin/claude` was re-pointed from `feature-add-verify-stage` to this worktree
before the first launch (`00` before, `01` after: one `--plugin-dir` line changed). The raw files are
in `~/.local/state/autonomous/verification-sandbox/evidence-12.3` (`$EV` below), cited by number;
`case3/` and `case4/` are its two subdirectories. Where the orchestrator's notes
(`orchestrator-notes-12.3.md`) disagree with a raw file, the raw file wins and the text says so.
Times are UTC; the `ls` listings of `$EV` show local time (UTC+1).

Go-aheads, all in the Inbox thread "DOT-164 etapa de code review (apply)" and relayed by the
orchestrator (orchestrator's note; the thread is not in `$EV`): "Solo después de 12.2" (2026-11-25
22:25, 12.2 is done); on 2026-11-26 at 21:29 the answers to the runbook's questions Q1–Q5, all the
recommendations (task B separate for case 5; re-run case 1 on a new task only if the planted doubt is
not published as a doubt; do not force the exact-match backstop; rename `plannotator` only if the
case 4 check fails; decline follow-ups in case 5); "Sí, lánzalo ahora" for L1 and for L3. After L1
the user was asked whether to repeat case 1 on a new task, because the planted doubt had been fixed
instead of published (see case 1), and answered "No repetir: el caso 1 queda cubierto con la duda
que publicó".

| Object | Id                  | Autonomy | Pull request                    | Branch and change                                                                        |
| ------ | ------------------- | -------- | ------------------------------- | ---------------------------------------------------------------------------------------- |
| A      | `agentic-task-2rkw` | `AFK`    | `pabloimrik17/grill-sandbox#14` | `feature/agentic-task-2rkw-sandbox-code-review-greeter`, change `sbx-cr-greeter`         |
| B      | `agentic-task-ge2f` | `HITL`   | `pabloimrik17/grill-sandbox#15` | `feature/agentic-task-ge2f-sandbox-code-review-human-round`, change `sbx-cr-human-round` |

Three launches, all through `--apply --task beads:<id> --stage code-review` (`12`, `44`, `63`). The
start is the record's `taken.added`; the end is the watch's `result.json` line.

| Launch | Attempt                                 | Cases    | Start    | End      | aoe session        |
| ------ | --------------------------------------- | -------- | -------- | -------- | ------------------ |
| L1     | `beads:agentic-task-2rkw:code-review:1` | 1, 2a, 3 | 21:35:58 | 21:42:27 | `02daf1c35dfa4ad1` |
| L2     | `beads:agentic-task-2rkw:code-review:2` | 2b, 4    | 21:45:46 | 21:53:00 | `97c4a16dff734121` |
| L3     | `beads:agentic-task-ge2f:code-review:1` | 5        | 21:55:30 | 22:32:51 | `9dd9f6473c254bf7` |

The notes put L1 at 21:36:07 and L2 at 21:45:55; the records and `12-L1-at.txt`, `44-L2-at.txt` say
21:35:58 and 21:45:46. All three agents ran `--model opus --effort high` (`13`, `45`, `63` records).
The loop was stopped throughout; the Mac was kept awake with `caffeinate` from 21:35 (orchestrator's
note) and nothing stalled.

### Setup

- Preflight at 21:34:28 (`00`): HEAD `25dc2c0` with only `tasks.md` modified and the `evidence/`
  directory untracked; the sandbox clone at `main...origin/main` with one worktree (`87fac3e`); no
  open pull request and no open `grill-sandbox` Beads task; GitHub issues 1–3 only; no `autonomous`
  process; `plannotator` 0.29.5 (the runbook said 0.29.4), Codex logged in with ChatGPT, CodeRabbit
  authenticated, `openspec` 2.0.0. `00-bd-ids.txt` (2042 ids) and `00-gh-issues.json` are the
  baselines for "no follow-up task".
- Task A created at 21:34:43 (`02`): `AFK`, `code-review`, `grill-sandbox`, `personal`, a definition
  with three acceptance criteria and a non-goal. Its change `sbx-cr-greeter` (two commits, `6a95043`
  and `40a8cf5`) and draft pull request 14 (`03`, `A.pr`). Dry run (`10`): exit 0, the launch step
  "would launch code-review for beads:agentic-task-2rkw … name inferred by the LLM".
- Planted in A: D1, `$name` unquoted in `printf` (a two-word name prints two greetings, no check covers
  it); D2, `cut -c1-12` with a comment about a banner width no document defines (meant to be a doubt).
  What each became is under case 1.
- Task B created at 21:53:52 (`60`): `HITL`, a definition whose greeter joins its arguments. Fixture
  B holds no planted defect: `scripts/test.sh` keeps a FAIL line that does not name the call, the
  target of the human's comment. Its change `sbx-cr-human-round` (two commits, `a42bc55` and
  `23bd713`) and draft pull request 15 (`61`, `B.pr`). Dry run (`62`): exit 0.
- Case 4 setup (`case4/`, written before L2): a copy of `~/.local/bin` as symlinks without
  `plannotator` (`case4/bin`, 0 matches), a `ZDOTDIR` whose four startup files source the real ones
  and then replace `~/.local/bin` in the `PATH` with the farm, a wrapper `case4/claude` and a
  configuration `case4/config.json` that differs from `00-config.json` in `sessions.binary` only
  (`diff` of the two files). The check of the hiding left one file, `case4/check-session.txt`: a
  `claude -p` session ran `command -v plannotator || echo ABSENT-session` and printed
  `ABSENT-session`. The other three checks (runner shell, `zsh -c`, `zsh -l -i -c`) left no file;
  the notes say they passed (orchestrator's note). The rename of `~/.local/bin/plannotator` was not
  needed.
- Commands that failed before they ran, per the notes (orchestrator's note; their output was
  overwritten by the re-runs): the first L2 launch (21:45:37, exit 127, `env … run`: the runbook
  passed a shell function to `env`); two publish runs with `"beads:$A:code-review:1"`, where zsh
  read `$A:c` as a modifier, exit 1, nothing published. No raw file holds them. See F23.

### Case 1: `AFK` from launch to `external-review`

What ran: L1, 21:35:58 to 21:42:27 (6 min). The review team plan (`20-L1-attempt-copy/review/plan.json`):
tier S measured and used, 31 lines in 2 files, no security pattern; reviewers `walkthrough`,
`code-review` and `codex`. Codex was skipped: "codex: The 'gpt-6.1-sol' model is not supported when
using Codex with a ChatGPT account." (`21-L1-review.json`), as in 12.2 (F2). The prompt (`13`) holds
"Whether a human follows the review: no: this task carries `AFK`." once, the AFK doubt rule at line 46
("publish mode posts it as an open `question (blocking)` thread"), a "The walkthrough" section and no
"Human rounds" section.

Record (`21`):

| Id  | Kind    | Severity   | Reporters                | Destination | Refutation  | Publication      |
| --- | ------- | ---------- | ------------------------ | ----------- | ----------- | ---------------- |
| f1  | finding | CRITICAL   | code-review, walkthrough | fix         | survived    | fixed, `93fdb35` |
| f2  | finding | CRITICAL   | code-review, walkthrough | fix         | survived    | fixed, `0c0de3b` |
| f3  | finding | SUGGESTION | code-review              | fix         | refuted     | none             |
| f4  | finding | SUGGESTION | code-review              | dismiss     | not-refuted | none             |
| f5  | finding | SUGGESTION | code-review              | dismiss     | not-refuted | none             |
| d1  | doubt   |            | walkthrough, code-review | settled     |             | none             |
| d2  | doubt   |            | code-review              | publish     |             | none             |

f1 is D1. f2 is D2: the review team reported the 12-character cut as a CRITICAL finding, and d1 (the
same question as a doubt) was settled against the proposal and spec, which print `Hello, <name>!`
with no length limit (stage summary, "Doubts by outcome"). The doubt that reached the pull request is
d2, "How should an empty name behave?", which was not planted. The commits `6a95043`, `40a8cf5`,
`93fdb35`, `0c0de3b` are the branch (`25`).

Result per PASS clause:

| Clause                                                                                | Result                                                                                                                                              |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| No `waiting` in the watch log                                                         | Met: `watch-c1.log` has `running` and `idle` lines only. The session called no `AskUserQuestion` and no Inbox tool (tool counts of its transcript). |
| `transition.json` `{"answer":["external-review"],"by":"agent"}`                       | Met: `at` 21:41:55.667, `by` `agent`.                                                                                                               |
| Labels hold `external-review`, not `code-review`                                      | Met: see the state below.                                                                                                                           |
| Every `publish` doubt has an open `question (blocking):` thread with the doubt marker | Met for d2, the only doubt with that destination.                                                                                                   |
| No new Beads task, no new GitHub issue                                                | Met: `24-bd-ids.diff` adds `agentic-task-2rkw` only; `24-gh-issues-after.json` equals `00-gh-issues.json`.                                          |
| The stage summary's follow-ups are proposed titles only                               | Not shown: the summary says "Proposed follow-up tasks: None."                                                                                       |
| Pull request still a draft; one logbook comment with its marker                       | Met.                                                                                                                                                |

Case 1 passed. Two parts of the task's wording were not shown with the data of this case: "doubts"
in the plural (one doubt was published) and the planted doubt (it was fixed, see F17).

Tracker state (task A): labels before the launch `AFK, code-review, grill-sandbox, personal` (`11`);
after it, plus `taken` (`13`); at `result.json`, `AFK, external-review, grill-sandbox, personal,
taken` (`watch-c1.log` 21:42:28, `23`); after the reconcile (below) `AFK, external-review,
grill-sandbox, personal` (`41`). One task comment (`23`, `23-A-comments.json`), headed `autonomous ·
code-review · beads:agentic-task-2rkw:code-review:1 · stage summary saved`; the description is
unchanged.

Pull request state (`22`): `OPEN`, draft, head `0c0de3b` (before: head `40a8cf5`, no review, no
comment, no thread, `11`). One review `COMMENTED`, body "Code review, round 1 / Threads: 1 open, 2
resolved / Review team: tier S, skipped codex (…)" with `autonomous:review v1 …:code-review:1
round=1`. One comment, the logbook entry (21:42:10), marker `autonomous:logbook
beads:agentic-task-2rkw:code-review:1`. Three threads:

| Thread                  | State    | Place                                                               | First line                                                                                   | Marker                 |
| ----------------------- | -------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------- |
| `PRRT_kwDOVhIiDM68kVRU` | resolved | `bin/greet.sh`, file level                                          | `issue (blocking): Unquoted $name is word-split and glob-expanded in printf`                 | `finding … finding=f1` |
| `PRRT_kwDOVhIiDM68kVSe` | resolved | `bin/greet.sh`, lines 10-11                                         | `issue (blocking): Names are silently cut to 12 characters for a banner that does not exist` | `finding … finding=f2` |
| `PRRT_kwDOVhIiDM68kVTX` | open     | `openspec/changes/sbx-cr-greeter/specs/greeter/spec.md`, file level | `question (blocking): How should an empty name behave?`                                      | `doubt … finding=d2`   |

The two resolved threads end `Status: fixed in 93fdb35` and `Status: fixed in 0c0de3b`; the open one
ends `Status: open question`. Every marker names `attempt=beads:agentic-task-2rkw:code-review:1`.
The record keeps `thread: null` for all seven entries, d2 included (F18). The walkthrough was saved:
`published.json` holds `walkthroughDigest` `d90bc4fa1da5…` (`20`).

### Case 2a: publish twice more in attempt 1

Attempt 1 was still `started`. The session had published once, at 21:41:11 (`30-published.session.json`),
so the two runs are the second and the third (`31`, 21:43:32; `32`, 21:43:38). Both exited 0 with
`outcome` `advance`, `threads.opened`, `answered`, `resolved` and `unresolved` all `[]`, `matches`
`[]`, `reviews` `[]`, and `walkthrough` `{"outcome":"unchanged","reason":null}`. `30-pr-before-2a.json`
and `33-pr-after-2a.json` are byte-identical (`cmp`), and equal `22`: one review, one comment, three
threads, one comment per thread. `published.json` keeps `findingsDigest` `29ab9c57e666…` and
`walkthroughDigest` `d90bc4fa1da5…`; `publishedAt` moved from 21:41:11.428 to 21:43:38.282, the start
of the third run (`case3/published.json`, the attempt directory). The walkthrough files were rewritten
(the directory listing shows 22:43) with the same digest.

Case 2a passed. Spec: finding-threads, "Publishing is idempotent within an attempt", scenario "Mode
run twice".

### Case 3: the transition refused without a current publish receipt

Attempt 1 was open, with its persistence receipt (`persisted.json`, 21:41:47). To make the receipt
check run, the task was moved back by hand: `external-review` removed, `code-review` added
(`case3/labels-1.txt`: `AFK, code-review, grill-sandbox, personal, taken`). Both runs were
`--apply --transition beads:agentic-task-2rkw` at 21:43:53.

| Case | Setup                                   | Exit | Outcome         | Reason                                                                                                                                                                            |
| ---- | --------------------------------------- | ---- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3a   | `published.json` moved away             | 3    | `not-evaluable` | "code-review attempt … has no publish receipt at …/published.json, so its record is not published; publish it with --apply --publish …, or discard the attempt" (`case3/3a.json`) |
| 3b   | one newline appended to `findings.json` | 3    | `not-evaluable` | "code-review attempt … has a findings.json that differs from the one published, so its record is not published; publish it with …, or discard the attempt" (`case3/3b.json`)      |

Both reports have `applied` false and no `handoff`; the task's labels in them are unchanged. In 3b the
current digest of `findings.json` is `feb3702f…` and the published one `29ab9c57…`
(`case3/3b-digests.txt`). The files were restored: `findings.json` and `transition.json` in the
attempt directory equal the copies in `case3/` and in `20` (`cmp`, run for this section), and the
labels were put back (`case3/labels-2.txt` equals `case3/labels-0.txt`: `AFK, external-review,
grill-sandbox, personal, taken`). The pull request state after case 3 equals `22` (`43` is identical
to it by `cmp`).

Case 3 passed. The task says "names an older digest"; 3b made the record newer than the receipt
instead of editing the receipt, which is the same condition in the spec ("a digest that differs from
the attempt's current `findings.json`", autonomous-run, "The transition waits for the publish
receipt").

### Case 2b and case 4: a second attempt with `plannotator` off the `PATH`

What ran: the reconcile of attempt 1 (below), then `code-review` put back on the task by hand (labels
`AFK, code-review, grill-sandbox, personal`, `42`), then L2 with the `case4` wrapper and
configuration (`44`, exit 0, 21:45:46). `workspace.created` is `false`: same branch and worktree, head
`0c0de3b`. The pull request was unchanged between the attempts (`43` equals `22`).

The prompt (`45`): line 511 reads "Plannotator is not available on this machine (plannotator CLI not
found on PATH): publish mode writes no walkthrough, so there is none."; lines 135–139 list the three
threads of attempt 1 with their ids, states (resolved, resolved, open), places, markers and URLs.
Review team: tier S, 33 lines in 2 files; Codex skipped as before.

Record (`48`):

| Id  | Severity   | Destination | Refutation  | Publication      | Thread                  |
| --- | ---------- | ----------- | ----------- | ---------------- | ----------------------- |
| f1  | CRITICAL   | fix         | survived    | fixed, `94d6bbd` | null                    |
| f2  | CRITICAL   | fix         | refuted     | none             | null                    |
| f3  | CRITICAL   | fix         | refuted     | none             | null                    |
| f4  | CRITICAL   | fix         | refuted     | none             | `PRRT_kwDOVhIiDM68kVTX` |
| f5  | SUGGESTION | fix         | survived    | fixed, `cf6c19f` | null                    |
| f6  | SUGGESTION | dismiss     | not-refuted | none             | null                    |
| f7  | SUGGESTION | dismiss     | not-refuted | none             | null                    |
| d1  | doubt      | settled     |             | none             | null                    |
| d2  | doubt      | settled     |             | none             | null                    |

f4 is "An explicitly empty name prints Hello, World! instead of Hello, !", linked to attempt 1's open
doubt thread (the record's reason: "It is the empty-name question the first attempt published, so it
continues that thread"). Its refutation was `refuted` with no reproduction, so nothing was
published for it (F15). f1 is attempt 1's f3 (refuted there for lack of a reproduction), now with a
failing reproduction `scripts/regressions/failing-greeter-reports-fail.sh`, fixed. f5 is a fixed
`SUGGESTION`, so it has no thread.

Publish: the first run was refused, exit 3, nothing posted: "findings.json is invalid:
$.entries[d1].publication must be an object; $.entries[d2].publication must be an object" (session
transcript; F20). After the session added `{"state":"none"}` to both doubts the second run exited 0
at 21:51:55: one thread opened and resolved (f1, `PRRT_kwDOVhIiDM68kfH_`, `scripts/test.sh` line 9,
first line `issue (blocking): A failing greet.sh stops the test suite silently with no FAIL line`,
`Status: fixed in 94d6bbd`, marker `…code-review:2 finding=f1`), `exact matches: none`, one review
(round 1 of attempt 2, `Threads: 0 open, 1 resolved`), and `walkthrough: none (Plannotator is not
available (plannotator CLI not found on PATH))`. That line is in the session transcript. The file
meant to hold it, `47-L2-publish-walkthrough.txt`, caught a line of a tool's schema instead (F21).

Result per PASS clause:

| Clause                                                          | Result                                                                                                                                                          |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4: the prompt names the reason                                  | Met (line 511).                                                                                                                                                 |
| 4: no `walkthrough.{json,patch,md}` in attempt 2                | Met: 0 files (`47`); the team's draft `review/walkthrough.json` exists, unsaved.                                                                                |
| 4: `walkthroughDigest` null                                     | Met: `findingsDigest` `195af145827d…`, `walkthroughDigest` null (`47`, `46`).                                                                                   |
| 4: the publish report reads `walkthrough: none` with the reason | Met, from the transcript (see above).                                                                                                                           |
| 4: the logbook entry says why there is no walkthrough           | Met: "Walkthrough: none, because Plannotator is not available on this machine." in `46-L2-attempt-copy/logbook-entry.md`, published as the PR's second comment. |
| 4: the task still reaches `external-review`                     | Met: `transition.json` by `agent` at 21:52:33.273; labels after the reconcile `AFK, external-review, grill-sandbox, personal` (`51`).                           |
| 2b: the prompt lists the L1 threads                             | Met.                                                                                                                                                            |
| 2b: the re-found item's entry is linked to the L1 node id       | Met: f4. It was refuted, so publish mode neither replied nor reported a match.                                                                                  |
| 2b: no two threads with one first line from different attempts  | Met: the `uniq -d` over `50` prints nothing.                                                                                                                    |
| 2b: threads grow only by genuinely new entries                  | Met: 3 threads became 4, the new one being f1 of attempt 2.                                                                                                     |

Case 4 passed. Case 2b passed on the wording "no duplicate thread". The wording "a second attempt
that finds a finding already published" was shown for the link and the prompt only: no entry of
attempt 2 that publishes was linked to a thread of attempt 1, so the reply path (finding-threads,
"Existing threads are answered, never duplicated") and the exact-match backstop did not run live (F16).
The unit tests `publish.test.ts` cover them ("Earlier fix that did not hold", "Same finding found
again").

Pull request state after L2 (`50`): `OPEN`, draft, head `cf6c19f`; two reviews (attempt 1's and
attempt 2's, each with its own `autonomous:review v1` marker); two comments, the logbook entries of
attempts 1 and 2 (21:42:10, 21:52:45); four threads: the three of case 1 in the same states (`kVRU`
resolved, `kVSe` resolved and outdated, `kVTX` open with its one comment) and `kfH_` resolved. Task
state: labels as above; after attempt 2 the task holds two stage summary comments (`comment_count` 2,
read with `bd show` when this section was written; `$EV` has no file for it). The session also sent
one note to the Inbox at 21:52:59, "done, task moved to external review", with no question
(`questions: []` in the tool's result).

### Case 5: `HITL`, one human round on GitHub, then `Approve`

What ran: L3, 21:55:30 to 22:32:51 (37 min), with the human present. The dry run (`62`) predicted the
session title "Greeter script code review"; the launch used "Greeter script with tests" (`63`): the
LLM names it each time (F23). Review team: tier S, 32 lines in 2 files, Codex skipped as before
(`65-L3-review.json`). The prompt (`63`) holds "Whether a human follows the review: yes: this task
carries `HITL`." and the sections "Human rounds" and "Working with the human (HITL)".

Timeline (the session's transcript, the watch log and the files; the notes agree unless said):

| Time        | Event                                                                                                                                                                                                                                                 |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 21:57       | Review report ready (`REVIEWDIR` at 21:57:44).                                                                                                                                                                                                        |
| 21:58:23    | The session sends the finding triage to the Inbox thread "Greeter code review (agentic-task-ge2f)", two questions, before any refutation. The human answers "Approve as proposed" and "Only as the first argument, as today" (d3, destination `ask`). |
| 21:59:19    | Three refuters start for f1, f2 and f6.                                                                                                                                                                                                               |
| 22:00–22:01 | Fix commits `89fd7f7` (f1) and `7df50d3` (f6, with `scripts/regress-cdpath.sh`); `findings.json` written 22:01:27.                                                                                                                                    |
| 22:01:33    | First publish (`64-published.first.json`, `64-findings.first.json`): `threads opened: none`, `walkthrough: saved`. The turn ends here (F14).                                                                                                          |
| 22:06:59    | The human adds a single comment to `scripts/test.sh` line 11 on GitHub: thread `PRRT_kwDOVhIiDM68ksv2`. The notes say about 22:07–22:09.                                                                                                              |
| 22:17:02    | The orchestrator nudges the session with `tmux send-keys`. It then shows the outcome and sends the walkthrough as a guided review (22:17:37).                                                                                                         |
| 22:22:32    | The human answers the walkthrough with "Send feedback": "I left a comment on the pull request, on scripts/test.sh".                                                                                                                                   |
| 22:22:48    | The session records the comment as `h1` and asks "Do you approve this triage of h1 (WARNING, fix)?"; "Approve: fix it" at 22:27:07.                                                                                                                   |
| 22:27:38    | The refuter's outcome (`refuted`, no reproduction: "the expected text already identifies each check") is shown to the human, who answers "Keep it: fix it now".                                                                                       |
| 22:30:16    | Fix `0045321` committed and pushed after a checker other than the fixer accepted it.                                                                                                                                                                  |
| 22:30:28    | Second publish: `threads answered: h1`, `threads resolved: h1`, `threads opened: none`, `walkthrough: saved`; no review in the report.                                                                                                                |
| 22:30:52    | The session sends a recheck guide of the one-line change; the human approves it (22:31:08).                                                                                                                                                           |
| 22:31:27    | Stage summary persisted (`persisted.json`).                                                                                                                                                                                                           |
| 22:31:44    | The transition question is asked through `AskUserQuestion` in the session's pane (aoe status `waiting` 22:31:49 to 22:32:21; F24). The answer "Approve" arrives at 22:32:18.                                                                          |
| 22:32:26    | `transition.json`: `{"answer":["external-review"],"by":"human"}`.                                                                                                                                                                                     |
| 22:32:38–51 | Logbook entry published, result marker written.                                                                                                                                                                                                       |

Record (`65`, final): f1 and f6 fixed `SUGGESTION`s (`89fd7f7`, `7df50d3`), f2 refuted, f3, f4 and f5
dismissed, d1 and d2 settled, d3 `ask` with publication `asked`, and

| Id  | Round | Severity | Reporter | Destination | Refutation | Publication      | Thread                  |
| --- | ----- | -------- | -------- | ----------- | ---------- | ---------------- | ----------------------- |
| h1  | 2     | WARNING  | human    | fix         | survived   | fixed, `0045321` | `PRRT_kwDOVhIiDM68ksv2` |

h1 carries the label `issue`, no `blocking`, so `WARNING`, as the spec's severity rule says. The
refuter said `refuted`; the record says `survived` with no reproduction, because the human kept the
finding (the session's reply: "Kept."). The first publish's record (`64-findings.first.json`) held
nine entries and no `h1`; its receipt (`64-published.first.json`) held `findingsDigest`
`de4e45bda8e3…`, `walkthroughDigest` `4cab1b513c1c…`, `publishedAt` 22:01:33.387; the final receipt
holds `e643732d32e5…` and `49d5da2358d4…`, 22:30:28.279, so two generations exist.

Result per PASS clause:

| Clause                                                                                       | Result                                                                                                                                                        |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The finding triage is shown before the refutation                                            | Met (21:58:23, then refuters at 21:59:19).                                                                                                                    |
| The human's comment becomes a finding of the reviewer `human`, round 2, linked to its thread | Met: h1.                                                                                                                                                      |
| The refutation only advises, and the human decides                                           | Met: shown, kept.                                                                                                                                             |
| The thread is answered and resolved by publish mode                                          | Met: reply `Status: fixed in 0045321` with `autonomous:resolution v1 … finding=h1 state=fixed`, `isResolved` true.                                            |
| The first comment of the thread is the human's text with no marker                           | Met: it is the runbook's sentence, exactly, with no `autonomous:` marker.                                                                                     |
| Published again, and the stage summary after it                                              | Met: the second publish 22:30:28, `persisted.json` 22:31:27.                                                                                                  |
| The walkthrough sent, the human's verdict, the updated walkthrough                           | Met, after the nudge (F14).                                                                                                                                   |
| `Approve` answered by the human; labels `HITL, external-review, …`                           | Met: `by` `human`; see the state below.                                                                                                                       |
| No follow-up task created                                                                    | Met: `68-bd-ids.diff` adds `agentic-task-ge2f` only; `68-gh-issues-after.json` equals `00-gh-issues.json`; the summary says "Proposed follow-up tasks: None." |
| Pull request still a draft                                                                   | Met.                                                                                                                                                          |

Case 5 passed, with one intervention: the session did not continue after the first publish by
itself, and the orchestrator nudged it (F14). Every clause of the task's wording was shown.

Tracker state (task B): labels before `HITL, code-review, grill-sandbox, personal` (`63`); after
launch plus `taken`; at `result.json` `HITL, external-review, grill-sandbox, personal, taken`
(`watch-c5.log` 22:32:52, `67`); after the reconcile `HITL, external-review, grill-sandbox, personal`
(`69`). One task comment, the stage summary (`67-B-comments.json`), 22:31:27, with the section
"Finding threads" naming h1.

Pull request state (`66`): `OPEN`, draft, head `0045321` (before: head `23bd713`, nothing, `63`).
After the first publish and before the human's comment: no review, no thread (`watch-c5.log`,
22:01:05; 22:07:13 shows 1 review and 1 thread, the human's). Final: two reviews, both `COMMENTED`
with empty bodies; one comment, the logbook entry (22:32:41), marker `autonomous:logbook
beads:agentic-task-ge2f:code-review:1`, `HITL`, "answered `external-review`", 3 commits; one thread,
`PRRT_kwDOVhIiDM68ksv2`, `scripts/test.sh`, resolved, outdated, two comments: the human's (22:06:59,
no marker) and the reply (22:30:33, with the resolution marker). The first review is the human's
single comment; the second appeared during the second publish although its report lists no review
(F25).

### Reconciles and cleanup

Each reconcile ran without `--stage`, first as a dry run, then with `--apply`; every one exited 2, the
code for a `wait`, because the launch step reports `excluded: taken` and then `excluded: unsupported
stage`, as in 12.2.

| Reconcile    | Dry run       | Apply         | Attempt                                 | Before, after          | Labels after                                     | aoe session            | Record after                             |
| ------------ | ------------- | ------------- | --------------------------------------- | ---------------------- | ------------------------------------------------ | ---------------------- | ---------------------------------------- |
| A, attempt 1 | `40` (exit 2) | `41` (exit 2) | `beads:agentic-task-2rkw:code-review:1` | `started`, `completed` | `AFK, external-review, grill-sandbox, personal`  | gone (`41-A1-aoe.txt`) | `taken.removed` 21:44:06, `cleanup` null |
| A, attempt 2 | `51` (exit 2) | `51` (exit 2) | `beads:agentic-task-2rkw:code-review:2` | `started`, `completed` | same                                             | gone (`51-A2-aoe.txt`) | `taken.removed` 21:53:44                 |
| B, attempt 1 | `69` (exit 2) | `69` (exit 2) | `beads:agentic-task-ge2f:code-review:1` | `started`, `completed` | `HITL, external-review, grill-sandbox, personal` | gone (`69-B1-aoe.txt`) | `taken.removed` 22:33:38                 |

In each, the attempt showed session `idle`, marker `ok` and `stageNow` `external-review`, action
`finalised`. Reconcile A also observed `beads:agentic-task-wnc2:verify:1`, an earlier run's attempt,
unchanged (`none`).

Cleanup (`90`, `91`, `92`):

- `90-aoe-left.txt` is empty: no aoe session mentions either task.
- Both worktrees were removed without `--force`, exit 0 each; nothing was printed by the status check
  before the removal.
- Pull requests closed at 22:34:14 (14) and 22:34:17 (15) with their branches deleted on the remote;
  both are still drafts (`92`). The local branches were deleted (`cf6c19f`, `0045321`), the remote
  refs pruned, `ls-remote` printed nothing, and the clone is `## main...origin/main` with one
  worktree, `87fac3e [main]`.
- Tasks A and B are `closed`, `closed_at` 22:34:33, labels as after the reconciles (read with
  `bd show` when this section was written; `$EV` has no file for the close).
- The Beads Dolt routine and the end of `caffeinate` have no file in `$EV`. The notes do not report
  the Dolt sync. Process 70306 (`caffeinate.pid`) was not running when this section was written
  (`ps`). Neither is verified here (F26).

### Findings

Each has a verdict: defect of this change, not a defect, or operational. Inferences are marked.
F14 and F15 are for the verify; the text gives the evidence and what the specs say, and does not
decide them.

- **F14: the HITL session's turn ended right after publish mode's report (for the verify).**
  The session's transcript (not in `$EV`; project directory of the `ge2f` worktree): at 22:01:30 the
  agent ran `Skill autonomous:run` with `--apply --publish beads:agentic-task-ge2f:code-review:1`;
  the command text loaded; at 22:01:32 it ran `run.ts` and got the report (`threads opened: none …
  walkthrough: saved … exit=0`, 22:01:40). Its next message, 22:01:42, is that report in a code
  fence followed by `exit 0`, with `stop_reason` `end_turn`; a `turn_duration` record of 179753 ms
  follows (the notes: the aoe pane said "Cogitated for 3m 0s"). The next record is the orchestrator's nudge at
  22:17:02 ("Your turn ended right after the publish report. Continue the closing steps from there:
  show the outcome and send the walkthrough to the human for review, then wait for their verdict."),
  after the orchestrator checked that the input box was empty (the notes). The watch logged `idle`
  from 22:01:50 and a `STALL` at 22:04:55. The human asked where the walkthrough was at about
  22:07–22:09 (the notes). At the stop, the Stop hooks ran: `claude-judge-continuation` returned
  `{"decision": "approve", "reason": "Claude evaluation command failed, allowing default stop
  behavior"}`. The Mac was awake: the watch kept logging (a `STALL` at 22:04:55, a pull request poll at 22:07:13). The AFK sessions did not
  stop at the same point: L1 wrote "Published. Writing the stage summary." at 21:41:26 and L2 the
  same at 21:52:06, both after the same command. Prompt of L3, closing steps 2 and 3 (`63`, lines
  479–480): step 2 runs publish mode, step 3 is "Review the outcome with the human … Then send the
  walkthrough"; neither says to continue in the same turn. `plugins/autonomous/commands/run.md`
  lines 14 and 107–109 say the command "only runs it, relays what it prints" and that a publish
  report carries no handoff, "so the command ends here". Candidate cause (the notes' and mine,
  inferred): the session read "the command ends here" as the end of its turn. What the specs say:
  code-review-stage, "The code review closing order" fixes the order (publish mode, then for `HITL`
  the walkthrough and the human rounds) and "The walkthrough reaches an HITL human" says the
  agent sends it "once the stage's round is published"; neither says that the session continues
  after publish mode's report without an external prompt. autonomous-run is silent on the command
  ending a turn. The same symptom stalled 12.2 (F1) with another cause (sleep).
- **F15: an open `question (blocking)` thread of attempt 1 was linked by attempt 2, whose entry was
  refuted, and the thread was left as it was (for the verify).**
  Raw: `48-L2-findings.tsv`, entry f4: `thread` `PRRT_kwDOVhIiDM68kVTX`, refutation `refuted`,
  publication `none`. That thread is attempt 1's d2 ("How should an empty name behave?"), open with
  its single comment (`22`, `33`, `50`: `isResolved` false, one comment). The publish report of
  attempt 2 lists `threads answered: none`, `threads unresolved: none`, `exact matches: none`. The
  task went to `external-review` with the thread open; attempt 2's stage summary and logbook entry
  both name it ("Still open from round 1: the empty-name question"). Nobody answered it. A later
  reader sees a blocking question that the latest review no longer raises as a finding. What the
  specs say: finding-threads, "Only surviving findings are published" (a refuted finding SHALL NOT be
  published) and "Existing threads are answered, never duplicated" (for an entry linked to an
  existing thread, publish mode SHALL reply with the entry's state, resolve it when accounted for
  and unresolve it when open again) do not say what happens to a linked entry that is not
  published. "A thread's state follows the finding's outcome" lists a doubt among the things that
  keep a thread open. code-review-stage, "A new attempt resumes the code review", says the triage
  links a finding to the thread it continues; it does not say what a later attempt does with an open
  doubt it cannot settle. No spec makes an open `question (blocking)` thread a condition of the
  transition. The code agrees with the letter: `plan.ts` plans only published entries (inferred from
  `planEntries` and `survives` in `outcome.ts`).
- **F16: the reply inside an already published thread did not run live (a gap in this check, not a
  defect).** See case 2b. The runbook's Q3 (force the exact-match backstop) was answered "do not
  force"; the reply path and the backstop are covered by `publish.test.ts`.
- **F17: the planted doubt was fixed as a finding (not a defect; the doubt clause is met by d2).**
  See case 1. The review team reported the 12-character cut as CRITICAL finding f2 and as doubt
  d1, and d1 was settled against the proposal and spec ("Doubt the definition settles" in the
  code-review-stage spec). Doubts are what a reviewer cannot judge without knowing the intent
  (`skills/review-team/reviewers/code-review.md:25`, per the runbook); here the proposal answers the
  intent. The user decided not to repeat the case. The doubt that was published, d2, was not
  planted.
- **F18: `findings.json` keeps `thread: null` and `publication.state` `none` for the published
  doubt d2, and `thread: null` for the published f1 and f2 (not a defect; inferred).** The spec
  defines `thread` as the thread an entry continues and identifies a stage's own threads by their
  markers; it does not ask publish mode to write a thread id back. The next attempt found the threads
  through the prompt's list, which is built from the markers.
- **F19: the first review round of the `HITL` task opened no thread (not a defect).** Only fixed
  `SUGGESTION`s survived and the one doubt was asked, so by "Only surviving findings are published"
  nothing was posted; the only thread of the pull request is the human's.
- **F20: attempt 2's first publish was refused because two settled doubts had no `publication`
  (not a defect; operational).** The prompt says `none` is for "a settled or a published doubt"
  (`45`, line 504). The session left the field out; publish mode refused the record before posting
  anything and named the entries and the field, exit 3, as "An invalid record publishes nothing"
  requires; the session fixed the record and published again. This is a live run of that
  requirement.
- **F21: `47-L2-publish-walkthrough.txt` holds the wrong text (operational).** The runbook's `grep`
  matched the description of a tool parameter in the transcript, not the publish report. The
  PASS evidence for "the publish report reads `walkthrough: none`" is the transcript line quoted in
  case 2b and 4, not that file.
- **F22: Codex was skipped in all three reviews, with the 12.2 reason (not a defect; configuration,
  as F2).** `21-L1-review.json`, the L2 prompt's stage summary and `65-L3-review.json` name it. The
  plan's Codex version here is 0.172.0 (12.2: 0.171.0).
- **F23: differences between the notes or the runbook and the raw files, and runbook errors
  (operational, no effect).**
    - L1 and L2 started at 21:35:58 and 21:45:46, not 21:36:07 and 21:45:55.
    - The notes put the human's comment at about 22:07–22:09; the pull request says 22:06:59.
    - `plannotator --version` is 0.29.5 (`00`), not 0.29.4.
    - The dry run's session title for L3 ("Greeter script code review") differs from the launched one
      ("Greeter script with tests"); the LLM names it each time. L1 and L2 kept the dry run's title.
    - The runbook's `"beads:$A:code-review:1"` is read by zsh as `$A:c…`; two publish runs failed
      with exit 1 and posted nothing, and `env … run …` returned 127 (the shell function is not a
      program). `claude -p … --allowedTools Bash '<prompt>'` needs `--` before the prompt. These
      come from the notes; no raw file holds the failed runs.
    - The first `91-cleanup.txt` check ran `gh pr view --comments --json` twice and printed usage; `92`
      holds the data.
- **F24: the `HITL` transition question went through `AskUserQuestion` in the session's pane, not
  through the Inbox as in 12.2 (not a defect).** The session called `AskUserQuestion` at 22:31:44
  after the transition report handed the question off (`commands/run.md` step 4); aoe showed
  `waiting` from 22:31:49 to 22:32:21; the answer was applied with `--answer
  'transition:beads:agentic-task-ge2f=external-review'` at 22:32:20 and `transition.json` has `by`
  `human`. The user's global rule prefers the Inbox for decisions; the command's text decides here,
  as in F3. The triage and the other questions of case 5 did go through the Inbox.
- **F25: the pull request gained an empty-bodied review at the reply (not a defect; inferred).**
  Spec: "A reply to an existing thread … SHALL open no review". The second publish's report lists
  none, and `66` shows a second review `COMMENTED` with an empty body that appeared while it ran
  (`watch-c5.log`: 1 review at 22:07:13, 2 at 22:30:48). The human's own single comment is also a
  review with an empty body (22:06:59). Inferred: GitHub wraps a thread reply in an implicit review;
  this was not read from the API.
- **F26: the cleanup left no evidence for the Dolt sync and the end of `caffeinate` (operational).**
  See "Reconciles and cleanup". The closed state of the two tasks was read afterwards.

### Not seen in this run

- A reply in a thread of an earlier attempt for an entry that publishes, the exact-match backstop and
  the unresolve of a fix that did not hold (case 2b linked a refuted entry; F16).
- More than one published doubt in one attempt, and a doubt published for an `HITL` attempt (the
  `HITL` doubt was asked and answered).
- A proposed or created follow-up task: none was proposed in any attempt.
- A finding passed on to QA, a deferred finding and a blocked `AFK` attempt (a fix rejected twice,
  publish mode failing): no case reached them.
- A second human round, and a human comment made in a Plannotator review (the human's feedback came
  through the walkthrough verdict, the comment itself on GitHub).
- The answer `Later` to the approval question.
- A `CRITICAL` human comment (the one comment was `issue:`, `WARNING`).
- A run with the loop running: the loop was stopped for every case.
