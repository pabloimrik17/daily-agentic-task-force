# Verification stage verification

End-to-end checks of tasks 11.1–11.3. The plugin code under test is this feature worktree,
`feature/DOT-149-add-verify-stage`, run from source. Every tracker write had the user's go-ahead in
the Plannotator Inbox thread "DOT-149 etapa de verificación (apply)".

## 11.1 Bootstrap of `code-review`

2026-11-21 11:02 UTC, with the loop stopped (no `loop.lock` or `run.lock` in
`~/.local/state/autonomous`, no `run.ts` process) and the user's configuration (Beads, four
GitHub repositories, Linear; `AUTONOMOUS_CONFIG` unset).

Before: the label listings were not saved (the operator's read-back script never ran). The first
run's `created` status in every scope is the evidence that `code-review` was absent: the bootstrap
reports `present` for a label that exists.

`bun plugins/autonomous/src/run.ts --bootstrap-labels --json`: exit 0,
`autonomous.bootstrap.v1`, outcome `advance`. Every label other than `code-review` reported
`present`; Beads `not applicable - Beads needs no label creation: labels exist by use`.

| Scope                                   | Label         | Status    | Colour    |
| --------------------------------------- | ------------- | --------- | --------- |
| `pabloimrik17/dotfiles`                 | `code-review` | `created` | `#a3e635` |
| `pabloimrik17/kinkoi-project`           | `code-review` | `created` | `#a3e635` |
| `pabloimrik17/monolab`                  | `code-review` | `created` | `#a3e635` |
| `pabloimrik17/daily-agentic-task-force` | `code-review` | `created` | `#a3e635` |
| Linear workspace                        | `code-review` | `created` | `#a3e635` |

A second run (text report, exit 0) reported every label, `code-review` included, `present` in
every scope. Read-back: `gh label list --search code-review` shows `code-review a3e635` in the four
repositories, and `linear label list --all` shows `code-review #a3e635 Workspace`.

PASS: `code-review` exists with its contract colour on every tracker that needs label creation.

## 11.3 Sandbox cases

2026-11-21 11:11–11:16 UTC (setup, launch and the case 1 session) and 2026-11-22 09:02–09:06 UTC
(checks, reconcile, case 2 and cleanup). The plugin is the feature worktree at commit `1b57aa3`, the
commit the preflight recorded, run from source. The kit is `~/.local/state/autonomous/verification-sandbox`:
its configuration disables Linear, narrows GitHub to `pabloimrik17/grill-sandbox`, keeps Beads and
sets `runner.parallel` to `2`. Its wrapper `bin/claude` adds `--plugin-dir` for the worktree and
exports `AUTONOMOUS_CONFIG` and `AUTONOMOUS_STATE`, so the attempts live under the kit's own
`state/`. It is separate from the 9.3 kit because 11.2 runs through that kit on the real tracker
and its live session reads that configuration on every `/autonomous:run`; narrowing it would have
broken 11.2. A separate state directory also keeps the reconcile away from every other attempt (the
9.3 side effect). The 9.3 kit's wrapper was only re-pointed to this worktree, and its
configuration was not touched.

The tasks are Beads tasks. Cases 1, 2 and 4 use task `agentic-task-wnc2` and the change
`sbx-verify-greeter` on the draft pull request `pabloimrik17/grill-sandbox#13`. Case 3 uses task
`agentic-task-p6t9` and a throwaway local repository. The launch used `agentArgs`
`["--model","opus","--effort","high"]`. The raw files of the first operator turn (setup, case 3,
the case 1 launch and case 4) were lost to a reboot (F1), so those cases come from the outputs the
operator saw, taken from its transcript. The files of the second turn (the reconcile, case 2 and
cleanup) are kept. Where a report and a raw output disagree, the raw output wins and the text says
so.

### Case 1: an `AFK` task from launch to `code-review`

Task `agentic-task-wnc2`, "Sandbox: verify greeter happy path", labels `AFK`, `grill-sandbox`,
`personal`, `verify`. Branch `feature/agentic-task-wnc2-sandbox-verify-greeter-happy-path`, with two
pushed commits: `927e16c` `docs(openspec): propose sbx-verify-greeter (agentic-task-wnc2)` and
`1d22bff` `feat(greeter): add the greeter and its checks (agentic-task-wnc2)`. Pull request
`pabloimrik17/grill-sandbox#13`, a draft.

The planted mismatch: the change has a requirement "Version flag" (`greet 1.0.0` and exit 0 for
`--version`) and a requirement that `scripts/test.sh` checks every scenario, and all its tasks are
ticked. `1d22bff` has no `--version` branch and `scripts/test.sh` has no version check. Before the
fix, `sh bin/greet.sh --version` printed `Hello, --version!`.

Launch (from the transcript):

- The dry run `--task beads:agentic-task-wnc2 --stage verify` exited 0 and said `would launch
  verify for beads:agentic-task-wnc2 in ~/WebstormProjects/grill-sandbox on
  feature/agentic-task-wnc2-sandbox-verify-greeter-happy-path as "auto 🔍 Sandbox greeter
  verification (agentic-task-wnc2)"`, with the note `name inferred by the LLM`.
- The launch (`--apply`, same arguments) exited 0 at 2026-11-21 11:13:07 UTC. It created attempt
  `beads:agentic-task-wnc2:verify:1`, state `started`, in a new worktree
  (`workspace.created` `true`), with the aoe session `591a661e39b44ae9`. The record holds
  `agentArgs` `["--model","opus","--effort","high"]`.
- The first snapshot, 21 seconds after the launch (11:13:28 UTC): session `running`, the attempt
  directory held only `prompt.md` and `record.json`, the branch held only the two fixture commits.

The session (the transcript `e25afc0a-372a-4a90-bc15-d8f6fc8dde5f`) ran from its first call at
11:13:22 UTC to `result.json` at 11:16:27 UTC; the logbook entry states `11:13 → 11:16 UTC
(3 min)`. Its tool calls were `Agent` (4), `Bash` (13, and one more after the re-prompt), `Skill` (3) and
`Write` (2); none was a question to the human. The two snapshots read `running` (11:13:28 UTC) and `idle` (2026-11-22 09:04:40 UTC);
none read `waiting`.

The round, from `findings.md` (the record of the findings), the timeline of the session's tool calls
and the teammates' transcripts:

| Time (UTC) | Who                                     | What                                                                                                                                |
| ---------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 11:13:37   | reporter, `general-purpose`, `sonnet`   | Invoked the skill `openspec-verify-change` on `sbx-verify-greeter` (11:13:40) and checked the task's definition. Handback 11:14:05. |
| 11:14:37   | orchestrator, `opus`                    | Wrote the finding triage in `findings.md` (below).                                                                                  |
| 11:14:43   | refuter "Refute finding F1", `haiku`    | Added `check 'greet 1.0.0' --version` to `scripts/test.sh` and ran it: it failed, `rc=1`. Handback 11:14:53, "F1 survives".         |
| 11:15:01   | fixer "Fix finding F1", `haiku`         | Edited `bin/greet.sh` only; the refuter's test line stayed. Handback 11:15:08.                                                      |
| 11:15:19   | fix checker "Fix check for F1", `haiku` | A different teammate from the fixer (its own agent id). Verdict `ACCEPT`, no change to the repository. Handback 11:15:29.           |
| 11:15:31   | orchestrator                            | Committed `bin/greet.sh` and `scripts/test.sh` as `3c24b75` and pushed.                                                             |

The teammates' types and models are as the transcript records them: every `Agent` call has
`subagent_type` `general-purpose` and a `model` of `sonnet` (the reporter) or `haiku` (the other
three); the teammates' own transcripts record `claude-sonnet-5-5` and `claude-haiku-5-5`, and the
orchestrator's `claude-opus-5-5`. The `Agent` inputs hold only `description`, `model`, `prompt` and
`subagent_type`: no effort was passed. Each teammate's `.meta.json` holds `pickedEffortModel`
`claude-opus-5-5`; what that field stands for is not established. The orchestrator triaged the
findings itself and started no teammate for it. One fix check ran for the one fix.

The record `findings.md` (round 1, subject `1d22bff`, a clean working tree at the start):

- Reported by the reporter: R1 `CRITICAL` (`--version` not implemented, `bin/greet.sh:3-4`),
  R2 `CRITICAL` (`scripts/test.sh:14-15` has no `--version` check and exits 0), R3 `WARNING`
  ("exit non-zero when a check fails" only partly supported, a consequence of R2), R4
  `SUGGESTION` (`check()` captures only stdout).
- Triage: F1 from R1, R2 and R3, one root cause, severities kept as reported, destination fix.
  F2 from R4, below the floor, dismissed without a refutation, because `set -eu` in
  `scripts/test.sh` aborts when the greeter exits non-zero, so the exit status is checked.
- Refutation of F1: survives. Reproduction: the new `check 'greet 1.0.0' --version` fails with
  `FAIL: greet --version: expected "greet 1.0.0", got "Hello, --version!"`, `rc=1`.
- Fix check 1 of F1: `ACCEPT`. The test fails against the old greeter (`rc=1`) and passes with the
  fix (`rc=0`), and the diff is limited to the branch and one test line.

The fix and its check run (`3c24b75`, `fix(greeter): add the --version flag and its check
(agentic-task-wnc2)`, pushed): `git log` shows the three commits `3c24b75`, `1d22bff`, `927e16c`;
the working tree was clean; `0` commits were unpushed; `sh bin/greet.sh --version` printed
`greet 1.0.0`; `sh scripts/test.sh` printed `all checks passed` and exited `0`; `0` of the
repository's tracked files match `findings`, `stage-summary` or `logbook-entry`, so the record
stayed outside the repository. The session ran that test after the push and listed it as the only
check the repository defines.

The markers in the attempt directory, in the order the spec's closing order sets (persist,
transition, log, result):

| File              | Time (UTC)   | Content                                                                                                           |
| ----------------- | ------------ | ----------------------------------------------------------------------------------------------------------------- |
| `persisted.json`  | 11:15:56.489 | `autonomous.persisted.v1`, header `autonomous · verify · beads:agentic-task-wnc2:verify:1 · stage summary saved`  |
| `transition.json` | 11:16:08.013 | `{"answer":["code-review"],"by":"agent"}`                                                                         |
| `logbook.json`    | 11:16:18.709 | `autonomous.logged.v1`, pull request 13                                                                           |
| `result.json`     | 11:16:27     | `autonomous.result.v1`, `outcome` `completed`, three artifacts (`findings.md`, `stage-summary.md`, logbook entry) |

Tracker state:

| Moment                                  | Labels of `agentic-task-wnc2`                              |
| --------------------------------------- | ---------------------------------------------------------- |
| Before the launch (transcript)          | `AFK`, `grill-sandbox`, `personal`, `verify`               |
| After the launch (transcript)           | `AFK`, `grill-sandbox`, `personal`, `taken`, `verify`      |
| Before the reconcile (2026-11-22 09:04) | `AFK`, `code-review`, `grill-sandbox`, `personal`, `taken` |
| After the reconcile                     | `AFK`, `code-review`, `grill-sandbox`, `personal`          |

- The task has one comment, created 11:15:57 UTC. Its first line is `autonomous · verify ·
  beads:agentic-task-wnc2:verify:1 · stage summary saved`, then a blank line, then the stage summary.
  The task's description is the one the task was created with. The summary names the pull request,
  the change, the three commits, F1 fixed and F2 dismissed with their reasons, `None passed on`
  under `Code review` and under `QA`, `None.` under `Proposed follow-up tasks`, and `None.` under
  `Deviations from the proposal`.
- The pull request has one comment, created 11:16:21 UTC. It starts with the marker
  `<!-- autonomous:logbook beads:agentic-task-wnc2:verify:1 -->` and the header `### 🔍 verify ·
  attempt 1`. The next line reads `AFK` · `--model opus --effort high` · `2026-11-21 11:13 → 11:16
  UTC (3 min)` · `moved to code-review by the agent, with no answer` · `1 commit (3c24b75)`. Its
  `### Verification` section reads: fixed F1, dismissed F2, refuted none, passed on none, deferred
  none. The pull request holds the three commits, is `OPEN` and `isDraft` `true`, both before the
  reconcile and after it.
- There is one task comment and one logbook comment only, although the session was prompted again
  after the reboot (F2).

Reconcile, with `--task beads:agentic-task-wnc2` and no `--stage` (a `--stage` would skip the
unsupported-stage exclusion and launch a second attempt, the 9.3 F1):

| Run                              | Exit | `before`  | `state`     | `action`    | `marker`      | `stageNow`    | Launch step                                                      |
| -------------------------------- | ---- | --------- | ----------- | ----------- | ------------- | ------------- | ---------------------------------------------------------------- |
| Dry run, 2026-11-22 09:05:26 UTC | 2    | `started` | `started`   | `finalised` | `{"ok":true}` | `code-review` | `wait`: `beads:agentic-task-wnc2 is excluded: taken`             |
| `--apply`, 09:05:34 UTC          | 2    | `started` | `completed` | `finalised` | `{"ok":true}` | `code-review` | `wait`: `beads:agentic-task-wnc2 is excluded: unsupported stage` |

- Both runs ended `wait` because the launch step waited. The dry run's reconcile reasons were
  `1 attempt observed`, `1 would-finalise` and `nothing changed`; the apply's were `1 attempt
  observed` and `1 finalised`. Capacity read `grill slots 0/1` and `work slots 0/2`, and the quota
  gate had capacity (2 of 100 percent in the session window, 1 of 100 in the weekly one), so
  neither run stopped before the launch step.
- The attempt's session was `open`, `idle`, not busy and not `needsHuman` in both. `detail` was
  `null`. The dry run's launch exclusion was `taken` (the dry run does not remove it; `taken` is
  checked before the stage). After the apply the launch exclusion was `unsupported stage` (the task
  is in `code-review`, which has no stage).
- The record after the apply: `state` `completed`, `taken.removed` `2026-11-22T09:05:34.183Z`,
  `cleanup` `null`, `agentSessionId` `e25afc0a-372a-4a90-bc15-d8f6fc8dde5f`. `capture.txt` is in the
  attempt directory. `aoe session show 591a661e39b44ae9` exits 1 with `Error: Session not found:
  591a661e39b44ae9`. The pull request stayed a draft.

No follow-up task:

- Beads: the listing of tasks created since 2026-11-21 11:10:12 UTC holds the same two ids as the
  one taken at setup, `agentic-task-p6t9` and `agentic-task-wnc2`; the diff of the two id lists
  exited 0 (operator report). The start of that window was rebuilt (F1), and both tasks were created
  at 11:12:15 UTC.
- GitHub: the repository has three issues, created 2026-11-03 and 2026-11-05. None was created on
  or after the launch.
- The stage summary's `Proposed follow-up tasks` holds `None.`.

PASS: the `AFK` task went from launch to `code-review` with no question and no follow-up task. The
planted mismatch was found, refuted without success, fixed by a teammate, accepted by a different
one and committed once by the orchestrator. The task's labels, comments, pull request and reconcile
are as the spec requires.

### Case 2: the guards refuse the transition

Run on case 1's task `agentic-task-wnc2` after the reconcile, with
`run.ts --apply --transition beads:agentic-task-wnc2 --json`.

Setup (7.0): after the reconcile the task carried `code-review` (no `taken`) and the attempt
`verify:1` was `completed`, so the operator put the task back in `verify` by hand: `bd label remove
agentic-task-wnc2 code-review` and `bd label add agentic-task-wnc2 verify`. The labels read `AFK`,
`grill-sandbox`, `personal`, `verify`. The guards find the workspace through the task's latest
attempt record, of any stage (`transition/guards.ts`, `workspaceOf`), and transition mode refuses
earlier only when an open attempt of the stage has no `persisted.json` (`transition/receipt.ts`).
After the reconcile the only attempt was completed and its worktree was kept, so the run reaches
the guards with no new session. They run the same code as for a real session that left a fix
behind. Before 2a the working tree was clean, `0` commits were unpushed, and the change was
complete, `3` of `3` tasks (operator report; no raw file).

| Step | Setup                                                                           | Exit | `outcome`       | Reason, verbatim                                                                                                                                               |
| ---- | ------------------------------------------------------------------------------- | ---- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2a   | one line appended to `bin/greet.sh`, uncommitted                                | 3    | `not-evaluable` | `the working tree has 1 uncommitted change`                                                                                                                    |
| 2b   | that line committed locally as `fix(greeter): sandbox unpushed fix`, not pushed | 3    | `not-evaluable` | `the branch feature/agentic-task-wnc2-sandbox-verify-greeter-happy-path has 1 commit origin/feature/agentic-task-wnc2-sandbox-verify-greeter-happy-path lacks` |

Both outputs (2026-11-22 09:05:48 and 09:05:57 UTC) have `schema` `autonomous.transition.v1`,
`applied` `false` and one reason only. The labels read in the output and in `bd show` after each
run are `AFK`, `grill-sandbox`, `personal`, `verify`, identical to the labels before 2a, so the
task did not move. The commit of 2b exited 0 (no hook ran) and left an empty `git status`, with `1`
commit ahead of the remote. The exit codes come from the operator's report; the raw files hold the
outputs, not the exit codes.

PASS: each guard refused alone, with its own reason, and left the task in `verify`.

### Case 3: no verify workflow

Task `agentic-task-p6t9`, label `verify-sandbox-noverify`, in the throwaway repository
`~/WebstormProjects/verify-sandbox-noverify`: `git init`, no remote, `openspec/config.yaml`, the
update skill and the update command, and neither the verify skill nor the verify command. Its three
files were `.claude/commands/opsx/update.md`, `.claude/skills/openspec-update-change/SKILL.md` and
`openspec/config.yaml`. The account comes from the operator's transcript, because the raw files
were lost.

- The dry run `--task beads:agentic-task-p6t9 --stage verify` exited 2, `outcome` `wait`.
  `reconcile` advanced with `nothing to reconcile`, `capacity` with `grill slots 0/1` and
  `work slots 0/2`, and the quota gate had capacity. The launch step waited, with this one reason
  (home directory shortened to `~`):

    ```text
    the repository ~/WebstormProjects/verify-sandbox-noverify provides neither the skill openspec-verify-change (~/WebstormProjects/verify-sandbox-noverify/.claude/skills/openspec-verify-change/SKILL.md) nor the command /opsx:verify (~/WebstormProjects/verify-sandbox-noverify/.claude/commands/opsx/verify.md): update OpenSpec in that repository
    ```

- Nothing was created. The task's labels before and after were identical (`AFK`, `personal`,
  `verify`, `verify-sandbox-noverify`), with no `taken`. There was no attempt directory for the
  task in the kit's state and no worktrees directory. `git worktree list` in the repository showed
  one worktree. The list of files and the `git status` of the repository were identical to those
  taken before (both diffs exited 0). No aoe session mentioned the task.
- The launch step's `data.repository` was `null` in the `wait` result, where the runbook expected
  the repository's path and `inferredFrom`. The reason names the right path, and `excluded` is
  `null`, `stage` `verify`.

PASS: the stage waited, the reason names the skill and the command, and no file or attempt was
created.

### Case 4: the prompt holds the branch's skill

The installed plugin is `autonomous` 2.4.0. Its `skills/` holds only `labelling-new-tasks`, and
`test -e` for its `adversarial-review/SKILL.md` exited 1 (absent). The worktree's `skills/` holds
`adversarial-review` and `labelling-new-tasks`. The skill file's last commit is `89206b7` and
`git status` shows no change under `plugins/autonomous/skills`. The kit's wrapper passes
`--plugin-dir` for the worktree's `plugins/autonomous`.

Checks on the case 1 launch's `prompt.md` (right after the launch, from the transcript):

- The skill's body without its frontmatter (`4443` characters) is a substring of the prompt: `True`.
  The frontmatter line `name: adversarial-review` is not in the prompt: `False`.
- The line `You are the orchestrator of an adversarial review: a reviewer reports` occurs once, and so
  does `Before the report, look for what an earlier attempt`.
- The prompt names the change `sbx-verify-greeter`, pull request `pabloimrik17/grill-sandbox#13`, the verify workflow as
  `/openspec-verify-change` and the update workflow as `/openspec-update-change`. Line 56 reads
  `Severity scale: the verify workflow's CRITICAL, WARNING and SUGGESTION. The floor is CRITICAL.`
  Line 59 reads `Whether a human follows the review: no: this task carries AFK.`
- On 2026-11-22 the same check on the kept `prompt.md` (21100 bytes) against the skill at the
  current worktree gave `4443 True False`.

The prompt is the evidence: the launch reads the skill from the running plugin
(`stages/plugin-skill.ts`, `PLUGIN_ROOT` is the plugin the code belongs to) and writes the prompt
before the session exists. The installed plugin has no such skill, so the body can only come from
the branch. The session's first message names the prompt file, and its steps follow the prompt: it
ran a report, a triage, a refutation, a fix and a fix check.

PASS: with the installed plugin lacking the skill, the prompt holds the branch's whole skill body.

### Findings

- **F1: the reboot cleared the scratchpad.** The machine rebooted on 2026-11-22 at 03:39 local time
  (the shutdown was at 03:31). The raw files of the first operator turn (preflight, kit, fixtures,
  case 3, the case 1 launch and case 4) were lost, and so were the baselines the later checks
  compared against. They were rebuilt, not re-captured: the three files of the throwaway
  repository's listing (`11.3-c3-files-before.txt`), the two task ids of the setup snapshot
  (`11.3-c1-bd-list-before.json`), the start of the Beads window (`11.3-c1-bd-since.txt`, two
  minutes before the task creation call; the exact second of the original is not in the
  transcript), the launch time (`11.3-c1-launch-at.txt`, 2026-11-21T11:13:07Z, as the operator
  reported it) and the GitHub issue list taken before (`11.3-c1-gh-issues-before.json`, filtered
  from today's list; the original was never printed). The raw file of the issue list after the run
  does not depend on a rebuilt file. The kept kit state, the attempt directory, the transcripts
  and `prompt.md` survived.
- **F2: the case 1 session was prompted again after the reboot.** Its aoe session's tmux was
  recreated on 2026-11-22 at 09:01:58 UTC (operator report), the conversation was resumed at 09:02:01 UTC
  (`SessionStart:resume`, the same conversation `e25afc0a-372a-4a90-bc15-d8f6fc8dde5f`) and it
  received its prompt again (`Read <attempt directory>/prompt.md and follow it.`, 09:02:02 UTC).
  It ran one read-only `Bash` call (`ls` of the attempt directory, `cat result.json`,
  `git status -sb`, `git log`), found `result.json`, said that running the prompt again would post the
  stage summary and the logbook entry twice, and wrote nothing. One task comment and one logbook
  comment remain, and the attempt directory and the branch did not change. Who relaunched the
  session is not established. An open aoe TUI relaunches a selected session row (unverified here);
  one was open (`aoe` pid `62221` at the preflight). The reconcile removed the session again, and no
  aoe session mentioned the task afterwards.
- **F3: the 6.5 dry run's launch exclusion read `taken`.** The runbook guessed the unsupported-stage
  wording. The dry run removes nothing, so `taken` was still on the task, and the exclusion check
  tests `taken` before the stage (`select/candidates.ts`, `exclusionBeforeDetail`). The apply
  removed `taken` and then read `unsupported stage`. Both are `wait` and exit 2.
- **F4: the status at the second snapshot was `idle`, not `error`.** The brief expected `error`
  (the session dead after the reboot). Because of the relaunch in F2 the session was `idle` and
  `aoe session capture` worked. This also matches the runbook's wait for `idle`.
- **F5: case 3's launch step has `data.repository` `null`.** The runbook expected the path and
  `inferredFrom`. The `wait` result carries none; the reason names the path. The verdict holds.
- **F6: the preflight's uncommitted files.** The operator's report says none of them is under
  `plugins/autonomous/src` or `skills`. The raw listing shows a modified
  `plugins/autonomous/src/label-contract/detect.test.ts`, which is a test. Nothing the session loads
  was uncommitted: the rest were `tasks.md`, the adversarial review spec, one eval prompt, four
  untracked eval files and the untracked evidence directory. Between `1b57aa3` and the current HEAD the changes under `plugins/` are
  `README.md`, the evals and `detect.test.ts`; no skill and no runtime file.
- **No exit 3 at the quota gate.** The 9.3 F3 did not recur: every run of this section had a
  quota gate with capacity.
- **The reconcile did not repeat the 9.3 F1.** It ran with `--task` only, so it finalised attempt 1
  and launched nothing.

Differences between the operator's reports and the raw output: the report counts 23 tool calls
before the re-prompt, while the timeline holds 22 before it and one after; the report dates the
re-prompt 09:02:10 UTC, which is the session's first tool call, while the prompt itself arrived at
09:02:02 UTC. The exit codes of case 2 and of the cleanup come from the report, not from raw files.

### Cleanup

- The session was removed by the reconcile (F2 does not change that). The attempt `verify:1` is
  `completed`, so the discard was not needed.
- The case 1 worktree was removed with `git worktree remove` (exit 0, no `--force`; its tree was
  clean). Pull request `pabloimrik17/grill-sandbox#13` was closed with `--delete-branch` (exit 0).
  The local branch was deleted with `git branch -D` (exit 0; it was at `ffc0f1c`, the unpushed
  fix of 2b), `git fetch --prune` removed `origin/feature/agentic-task-wnc2-sandbox-verify-greeter-happy-path`,
  and `git ls-remote` for the branch printed nothing.
- `bd close agentic-task-wnc2 agentic-task-p6t9` exited 0. Both tasks are `closed` and carry no
  `taken`. Task `agentic-task-wnc2` keeps the `verify` label that 7.0 put back; case 3's labels are
  unchanged.
- The throwaway repository's files still matched the list taken before; it was removed
  (`rm -rf`, exit 0) and `ls ~/WebstormProjects | grep -c noverify` printed `0`.
- The sandbox clone `~/WebstormProjects/grill-sandbox` reads `## main...origin/main`, has one
  worktree (`87fac3e [main]`), no `feature/agentic-task-wnc2*` branch and no worktree directory for
  the task. No aoe session mentions either task.
- The Beads Dolt routine ran: `bd conflicts list` found none, `bd dolt commit` exited 0 with
  `Nothing to commit.`, `bd dolt pull` exited 0, no conflicts again, and `bd dolt push --no-adopt`
  exited 0 with `Push complete.`.
- The kit `~/.local/state/autonomous/verification-sandbox` stays in place: its `state/` holds the
  attempt record this section cites. The 9.3 kit's wrapper still points at this worktree.
