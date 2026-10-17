# Manual stage-session cycle (task 8.2)

Recorded 2026-10-17 on the author's machine with `aoe` 1.14.0, `wt` 0.77.0 and `claude` on `PATH`, against Linear task DOT-109 (project Dotfiles, labels `personal` and `AFK`), with `AUTONOMOUS_STATE` pointing at a scratch directory and `AUTONOMOUS_CONFIG` at a copy of the user configuration that carries none of the optional blocks. Tracker titles and the account line are left out; `<scratch>` stands for the scratch directory. The quota-gate detail lines are omitted after the first run.

## 1. Dry run of the supplied task

```bash
AUTONOMOUS_STATE=<scratch>/state AUTONOMOUS_CONFIG=<scratch>/config.json bun plugins/autonomous/src/run.ts --account claude --task linear:DOT-109 --stage test
```

```text
autonomous run — started 2026-10-17T14:05:28.131Z
outcome: advance
defaults: sessions.tool, sessions.profile, sessions.binary, workspace.root, naming.model, naming.effort

[reconcile] advance (code)
  reasons:
    - nothing to reconcile

[quota-gate] advance (code)
  account   claude — <account left out>
  fetched   2026-10-17T14:05:25.000Z
  session   0% / 100%  window 5h  resets 2026-10-17T18:20:00.000Z  no projection: no consumption yet
  weekly    20% / 100%  window 7d  resets 2026-10-23T07:00:00.000Z  projected 108.1%
  rateLimitResets ? / ?  not evaluated
  reasons:
    - session window has capacity: 0/100 percent, resets at 2026-10-17T18:20:00.000Z
    - weekly window has capacity: 20/100 percent, resets at 2026-10-23T07:00:00.000Z

[launch] advance (llm)
  task        linear → DOT-109 → <title left out>
  stage       test
  input       supplied
  repository  /Users/etherless/WebstormProjects/dotfiles (from Dotfiles)
  branch      feature/DOT-109-manage-fresh-sessions-per-stage-through
  group       Dotfiles
  title       auto 🧪 Manage per-stage agent sessions (DOT-109) (llm)
  reasons:
    - would launch test for linear:DOT-109 in /Users/etherless/WebstormProjects/dotfiles on feature/DOT-109-manage-fresh-sessions-per-stage-through as "auto 🧪 Manage per-stage agent sessions (DOT-109)"
    - name inferred by the LLM
```

Exit 0. The config copy carries none of the optional blocks, so the header lists the six defaulted keys. Nothing was written: the state directory stayed empty.

## 2. Launch with `--apply`, first attempt: the taken write fails closed

```bash
AUTONOMOUS_STATE=<scratch>/state AUTONOMOUS_CONFIG=<scratch>/config.json bun plugins/autonomous/src/run.ts --account claude --apply --task linear:DOT-109 --stage test
```

```text
autonomous run — started 2026-10-17T14:05:59.718Z
outcome: not-evaluable
defaults: sessions.tool, sessions.profile, sessions.binary, workspace.root, naming.model, naming.effort

[reconcile] advance (code)
  reasons:
    - nothing to reconcile

[quota-gate] advance (code)
  account   claude — <account left out>
  fetched   2026-10-17T14:05:25.000Z
  session   0% / 100%  window 5h  resets 2026-10-17T18:20:00.000Z  no projection: no consumption yet
  weekly    20% / 100%  window 7d  resets 2026-10-23T07:00:00.000Z  projected 108%
  rateLimitResets ? / ?  not evaluated
  reasons:
    - session window has capacity: 0/100 percent, resets at 2026-10-17T18:20:00.000Z
    - weekly window has capacity: 20/100 percent, resets at 2026-10-23T07:00:00.000Z

[launch] not-evaluable (llm)
  task        linear → DOT-109 → <title left out>
  stage       test
  input       supplied
  repository  /Users/etherless/WebstormProjects/dotfiles (from Dotfiles)
  branch      feature/DOT-109-manage-fresh-sessions-per-stage-through
  group       Dotfiles
  title       auto 🧪 Per-stage session manager (DOT-109) (llm)
  workspace   /Users/etherless/WebstormProjects/dotfiles-worktrees/feature-DOT-109-manage-fresh-sessions-per-stage-through (created)
  attempt     linear:DOT-109:test:1 pending, no session
  reasons:
    - taken: linear issue update DOT-109 --add-label taken: linear failed: ✗ Failed to update issue: Issue label not found: taken
  Run `linear label list --team DOT` to see available labels.
```

Exit 3. The worktree was prepared and the record written as `pending`, then `linear issue update --add-label taken` failed because the Linear workspace had no `taken` label yet: no session was created, as the spec's "Taken cannot be written" scenario requires. The contract bootstrap is the sanctioned fix:

## 2a. Label bootstrap

```bash
AUTONOMOUS_STATE=<scratch>/state AUTONOMOUS_CONFIG=<scratch>/config.json bun plugins/autonomous/src/run.ts --bootstrap-labels
```

```text
label bootstrap — started 2026-10-17T14:07:00.476Z
outcome: advance
  beads     not applicable — Beads needs no label creation: labels exist by use
  github    pabloimrik17/dotfiles: created taken; present work, personal, AFK (colour #0052cc, expected #5e6ad2), HITL (colour #b60205, expected #eb5757), grill-me
  github    pabloimrik17/kinkoi-project: created taken; present work, personal, AFK, HITL, grill-me
  github    pabloimrik17/monolab: created taken; present work, personal, AFK, HITL, grill-me
  github    pabloimrik17/daily-agentic-task-force: created taken; present work, personal, AFK, HITL, grill-me
  linear    workspace: created taken; present work, personal, AFK, HITL, grill-me
```

Exit 0. `taken` was created on the Linear workspace and on the four GitHub repositories.

## 2b. Second `--apply` run: recovery of the pending attempt hits a defect

```bash
AUTONOMOUS_STATE=<scratch>/state AUTONOMOUS_CONFIG=<scratch>/config.json bun plugins/autonomous/src/run.ts --account claude --apply --task linear:DOT-109 --stage test
```

```text
autonomous run — started 2026-10-17T14:07:17.228Z
outcome: not-evaluable
defaults: sessions.tool, sessions.profile, sessions.binary, workspace.root, naming.model, naming.effort

[reconcile] not-evaluable (code)
  linear:DOT-109:test:1  pending → pending  session not observed  marker not checked  none: linear issue update DOT-109 --remove-label taken: linear failed: ✗ Failed to update issue: Label d8acea84-d882-4459-b23b-cafd52cdc28d is not on issue 7f90bd09-b317-4b96-8608-e140b6699eea and cannot be removed.
  reasons:
    - linear:DOT-109:test:1: linear issue update DOT-109 --remove-label taken: linear failed: ✗ Failed to update issue: Label d8acea84-d882-4459-b23b-cafd52cdc28d is not on issue 7f90bd09-b317-4b96-8608-e140b6699eea and cannot be removed.
```

Exit 3. `reconcile` found no session for the pending attempt and tried to remove `taken`, which the task never carried; Linear refuses to remove a label that is not on the issue, so the attempt stayed `pending`. Fixed in commit `fix(autonomous): treat an absent taken label as removed`: the abort skips the tracker when `taken` was never added, and the confirmed removal reads the task first and counts an absent label as removed.

## 2c. Third `--apply` run: attempt 1 aborted, attempt 2 launched

```bash
AUTONOMOUS_STATE=<scratch>/state AUTONOMOUS_CONFIG=<scratch>/config.json bun plugins/autonomous/src/run.ts --account claude --apply --task linear:DOT-109 --stage test
```

```text
autonomous run — started 2026-10-17T14:09:28.592Z
outcome: advance
defaults: sessions.tool, sessions.profile, sessions.binary, workspace.root, naming.model, naming.effort

[reconcile] advance (code)
  linear:DOT-109:test:1  pending → aborted  session not observed  marker not checked  aborted
  reasons:
    - 1 aborted

[quota-gate] advance (code)
  account   claude — <account left out>
  fetched   2026-10-17T14:05:25.000Z
  session   0% / 100%  window 5h  resets 2026-10-17T18:20:00.000Z  no projection: no consumption yet
  weekly    20% / 100%  window 7d  resets 2026-10-23T07:00:00.000Z  projected 107.8%
  rateLimitResets ? / ?  not evaluated
  reasons:
    - session window has capacity: 0/100 percent, resets at 2026-10-17T18:20:00.000Z
    - weekly window has capacity: 20/100 percent, resets at 2026-10-23T07:00:00.000Z

[launch] advance (llm)
  task        linear → DOT-109 → <title left out>
  stage       test
  input       supplied
  repository  /Users/etherless/WebstormProjects/dotfiles (from Dotfiles)
  branch      feature/DOT-109-manage-fresh-sessions-per-stage-through
  group       Dotfiles
  title       auto 🧪 Stage session manager integration (DOT-109) (llm)
  workspace   /Users/etherless/WebstormProjects/dotfiles-worktrees/feature-DOT-109-manage-fresh-sessions-per-stage-through (reused)
  attempt     linear:DOT-109:test:2 started, session 15d81cbee14048f1
  reasons:
    - launched linear:DOT-109:test:2 as "auto 🧪 Stage session manager integration (DOT-109)" in /Users/etherless/WebstormProjects/dotfiles-worktrees/feature-DOT-109-manage-fresh-sessions-per-stage-through
```

Exit 0. The pending attempt 1 was aborted without a tracker call; attempt 2 reused the worktree, `taken` was added and read back, the prompt was written, and the session was created in group `Dotfiles` and started. Verified by hand: `aoe list --json` shows the session with that title and group, `linear issue view DOT-109 --json` lists `personal`, `AFK`, `taken`, and the worktree exists under `~/WebstormProjects/dotfiles-worktrees/`.

## 3. Plain run with `--apply`: finalisation

```bash
AUTONOMOUS_STATE=<scratch>/state AUTONOMOUS_CONFIG=<scratch>/config.json bun plugins/autonomous/src/run.ts --account claude --apply --no-handoff
```

```text
autonomous run — started 2026-10-17T14:10:57.662Z
outcome: wait
defaults: sessions.tool, sessions.profile, sessions.binary, workspace.root, naming.model, naming.effort

[reconcile] advance (code)
  linear:DOT-109:test:1  aborted → aborted  session not observed  marker not checked  none
  linear:DOT-109:test:2  started → completed  session idle/open  marker ok  finalised
  reasons:
    - 1 attempt observed
    - 1 finalised

[quota-gate] advance (code)
  (detail omitted)

[label-triage] advance (llm)
  (section omitted: it lists tracker tasks; it applied three code-tier `personal` labels on GitHub tasks, unrelated to the cycle)

[select] advance (llm)
  (section omitted: it lists tracker tasks)

[launch] wait (code)
  task        beads → agentic-task-2x0 → <title left out>
  stage       grill-me
  input       selected
  reasons:
    - stage grill-me has no implementation
```

Exit 2 (the run ended in `wait` at `launch`, as expected without a supplied task: `grill-me` has no implementation). `reconcile` found the marker written by the agent and the session `idle`, and finalised attempt 2: it saved the capture (`capture.txt`) and the agent's conversation id, purged the session, recorded `completed` and removed `taken`. Verified by hand afterwards: the session is gone from `aoe list --json`, `linear issue view DOT-109 --json` lists `personal` and `AFK` only, and the worktree still exists.

## 4a. Second launch, attempt 3

```bash
AUTONOMOUS_STATE=<scratch>/state AUTONOMOUS_CONFIG=<scratch>/config.json bun plugins/autonomous/src/run.ts --account claude --apply --task linear:DOT-109 --stage test
```

```text
autonomous run — started 2026-10-17T14:13:23.297Z
outcome: advance
defaults: sessions.tool, sessions.profile, sessions.binary, workspace.root, naming.model, naming.effort

[reconcile] advance (code)
  linear:DOT-109:test:1  aborted → aborted  session not observed  marker not checked  none
  linear:DOT-109:test:2  completed → completed  session not observed  marker not checked  none
  reasons:
    - nothing changed

[quota-gate] advance (code)
  (detail omitted)
  reasons:
    - session window has capacity: 0/100 percent, resets at 2026-10-17T18:20:00.000Z
    - weekly window has capacity: 20/100 percent, resets at 2026-10-23T07:00:00.000Z

[launch] advance (llm)
  task        linear → DOT-109 → <title left out>
  stage       test
  input       supplied
  repository  /Users/etherless/WebstormProjects/dotfiles (from Dotfiles)
  branch      feature/DOT-109-manage-fresh-sessions-per-stage-through
  group       Dotfiles
  title       auto 🧪 Stage session manager integration (DOT-109) (llm)
  workspace   /Users/etherless/WebstormProjects/dotfiles-worktrees/feature-DOT-109-manage-fresh-sessions-per-stage-through (reused)
  attempt     linear:DOT-109:test:3 started, session 6a79a1e05a0640ae
  reasons:
    - launched linear:DOT-109:test:3 as "auto 🧪 Stage session manager integration (DOT-109)" in /Users/etherless/WebstormProjects/dotfiles-worktrees/feature-DOT-109-manage-fresh-sessions-per-stage-through
```

Exit 0. Attempt 3 reused the worktree and started a new session.

## 4b. Crash simulated by hand

```bash
aoe remove 6a79a1e05a0640ae --purge
```

```text
  Removed session: auto 🧪 Stage session manager integration (DOT-109) (from profile 'main')
```

Run right after the launch, before the agent could write a marker. The attempt directory holds `prompt.md` and `record.json` only.

## 4c. Run that retains attempt 3

```bash
AUTONOMOUS_STATE=<scratch>/state AUTONOMOUS_CONFIG=<scratch>/config.json bun plugins/autonomous/src/run.ts --account claude --apply --task linear:DOT-109 --stage test
```

```text
autonomous run — started 2026-10-17T14:14:35.758Z
outcome: wait
defaults: sessions.tool, sessions.profile, sessions.binary, workspace.root, naming.model, naming.effort

[reconcile] advance (code)
  linear:DOT-109:test:1  aborted → aborted  session not observed  marker not checked  none
  linear:DOT-109:test:2  completed → completed  session not observed  marker not checked  none
  linear:DOT-109:test:3  started → retained  session not found/gone  marker no result marker  retained: session not found; no result marker
  retained:
    linear:DOT-109:test:3
  reasons:
    - 1 attempt observed
    - 1 newly retained
    - 1 retained

[quota-gate] advance (code)
  (detail omitted)
  reasons:
    - session window has capacity: 0/100 percent, resets at 2026-10-17T18:20:00.000Z
    - weekly window has capacity: 20/100 percent, resets at 2026-10-23T07:00:00.000Z

[launch] wait (code)
  task        linear → DOT-109 → <title left out>
  input       supplied
  excluded    taken
  reasons:
    - linear:DOT-109 is excluded: taken
```

Exit 2. `reconcile` observed the session as `gone`, found no marker and retained the attempt with the reason `session not found; no result marker`; no capture could be taken because the session no longer exists. `taken` stayed on the task, so `launch` reported the supplied task as excluded (`taken`) and waited. A second run of the same command lists the retained attempt again and changes nothing.

## 5. Discard

```bash
AUTONOMOUS_STATE=<scratch>/state AUTONOMOUS_CONFIG=<scratch>/config.json bun plugins/autonomous/src/run.ts --apply --discard linear:DOT-109:test:3
```

```text
autonomous discard — started 2026-10-17T14:14:47.479Z
outcome: advance
attempt: linear:DOT-109:test:3
task: linear:DOT-109
removed: session no, taken yes, workspace no
reasons:
  session 6a79a1e05a0640ae was already gone
  taken removed from linear:DOT-109
  attempt linear:DOT-109:test:3 discarded
```

Exit 0. The session was already gone, `taken` was removed and read back, and the attempt reads `discarded`. Verified by hand: `linear issue view DOT-109 --json` lists `personal` and `AFK` only, no session of the cycle is listed by AoE, and the worktree `~/WebstormProjects/dotfiles-worktrees/feature-DOT-109-manage-fresh-sessions-per-stage-through` on branch `feature/DOT-109-manage-fresh-sessions-per-stage-through` is kept, as the task asks.
