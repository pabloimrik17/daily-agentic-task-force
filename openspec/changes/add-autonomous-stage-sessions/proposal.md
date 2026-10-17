# Proposal

## Why

`/autonomous:run` now selects the next work unit (DOT-108, PR #29) but nothing launches it: no session is created, nothing records that a task is taken, and nothing observes or closes what an agent did. Linear DOT-109, a sub-issue of DOT-82 that DOT-110 (the grill-me stage) and DOT-111 (the periodic runner) depend on, asks for that: one fresh session and agent per attempt to advance a stage, managed through an Agent of Empires (AoE) integration whose contract allows replacing it without rewriting selection or the stages.

The decisions were settled with the user in a grill on 2026-10-17 and are recorded in DOT-109 and in this change.

## What Changes

- **Attempts**: an _attempt_ is one launch of a managed session for one stage of one task, identified as `<source>:<task>:<stage>:<n>`. Its record, the prompt the agent receives, the result marker the agent writes and the pane capture on failure live in a local state directory (`$XDG_STATE_HOME/autonomous/attempts/…`), never in the tracker and never in the repository the agent works in.
- **Two new steps** in `/autonomous:run`: `reconcile`, first of all, and `launch`, last. The order becomes `reconcile → quota-gate → label-triage → select → launch`. Both write only with `--apply`.
    - `reconcile` resolves attempts whose creation was interrupted, observes every open managed session, finalises the attempts whose stage completed, retains the ones whose session exited without completing, retries pending cleanups, and reports everything. It never returns `wait`.
    - `launch` takes the selected work unit, prepares its workspace, adds `taken`, creates and starts the session, and records every step as it happens so an interruption anywhere is recoverable.
- **Completion is checked, never assumed**: a stage completes only when the agent wrote a valid result marker for that attempt **and** the stage's own check against the tracker holds. An idle agent, an exited process or a closed window is never success. Finalisation also waits for the session to be idle, waiting or exited: a running agent is never removed.
- **`taken` is written by the runner**: added before the session is created, removed only after the attempt is finalised (completed, discarded, or aborted before any session existed) and its session is gone. A retained failed attempt, and a completed attempt whose session could not be removed, keep it. Removing it is the second exception to "never remove a label"; ADR 0002 records it.
- **Failures are retained, never retried**: an attempt whose session exits without completing stays, with its session, until the user discards it with `--apply --discard <attempt>`. No time limit and no automatic retry. Discarding purges the session, removes `taken` and keeps the worktree unless `--release-workspace` is also given.
- **Sessions are purged, not trashed**: AoE's trash keeps a removed session listed as `error`, so the runner removes with `--purge` after saving the agent's conversation id and a capture of the pane. Work files are never deleted: `aoe remove` never gets `--delete-worktree`.
- **Workspace through worktrunk**: a `WorkspaceManager` contract (prepare, release) implemented with `wt`. The repository is inferred from the task (GitHub repo, Linear project name, Beads labels) against the directories of a workspace root; exactly one match or the task is not launched. One branch per task, `feature/<id>-<slug>`, whose worktree is reused across attempts and stages, and never removed by the runner except on `--discard --release-workspace`.
- **Session contract**: a `SessionManager` (create, observe, capture, remove) implemented over the `aoe` CLI. Identity is the session id parsed from `aoe add`; the worktree path is only the recovery key. Observed states are reduced to `open` (with "needs human" for AoE's `waiting`), `exited` and `gone`. Managed sessions get the project's group, as ghd-aoe does, and the title `auto <stage emoji> <name> (<task id>)`, the name inferred by Haiku with a deterministic fallback.
- **Stage contract**: a stage declares its inputs, prompt, emoji, agent arguments, the result marker it expects and its completion check. This change ships the contract and one **test stage** (🧪) that only writes the marker; it is never selectable and runs only with `--task <source>:<id> --stage test`. `grill-me` stays unsupported until DOT-110 registers it, so without `--task` `launch` reports the selected unit as waiting for a stage implementation.
- **Supplied task**: `--task <source>:<id>` skips `label-triage` and `select` and hands that task to `launch`, as DOT-110 asks for its own validation.
- **Run lock**: one run at a time per state directory; a second run finds the lock and is `not-evaluable`.
- **Configuration**: three new **optional** blocks, `sessions` (tool `claude` or `codex`, profile, binary), `workspace` (root) and `naming` (model, effort). The plugin ships `config.defaults.json`; a key missing from the user's file takes the shipped default, key by key, and the report names the keys that did. A mistyped or unknown key is still an error. Not breaking: existing configuration files keep working. ADR 0003 records why optional blocks have defaults while `selection` stayed required.
- **Trackers**: `removeLabel` on Beads, GitHub and Linear; the Linear reader also reads the project name.
- **Glossary**: `plugins/autonomous/CONTEXT.md` and `plugins/stonks/CONTEXT.md` are renamed to `GLOSSARY.md`, a root `GLOSSARY-MAP.md` points to them, and the autonomous glossary gains attempt, managed session, stage contract, workspace, result marker, retained attempt, pending cleanup and run lock.

**Out of scope:**

- Any real stage: the grill-me prompt, its transition and its tracker check (DOT-110).
- Slots, the human slot, cadence and the `/loop` wiring (DOT-111). `reconcile` exposes what DOT-111 needs: open attempts, which need a human, retained ones.
- Coordination of several runners or machines. `taken` already keeps a second machine from selecting a task; its attempts stay local.
- `opencode` as a session tool: it has no status hooks and no model flag in its interactive mode, so it would break the observed-state model. Follow-up.
- A handoff question for discarding; `--discard` from a shell is enough for now.
- Waiting for worktrunk's background dependency install before launching; a stage that needs dependencies says so in its prompt.

## Capabilities

### New Capabilities

- `stage-sessions`: attempts and their lifecycle; the `reconcile` and `launch` steps; the `--task`, `--stage` and `--discard` modes; the session and workspace contracts and their AoE and worktrunk implementations; the stage contract and the test stage; completion, retention, cleanup and the run lock; the attempt report.

### Modified Capabilities

- `label-contract`: `taken` is now added and removed by the runner under the rules above; the user configuration file gains optional blocks with shipped defaults, reported when used; the configuration holds `sessions`, `workspace` and `naming`.
- `label-triage`: the trackers gain label removal, used only by stage sessions; triage's own writes stay additive.
- `autonomous-run`: the fixed step list gains `reconcile` first and `launch` last; new flags `--task`, `--stage` and `--discard` and their combinations; the discard report.

## Impact

- **Code** (`plugins/autonomous/src/`):
    - new `sessions/` (session manager contract, AoE adapter, naming), `workspace/` (contract, worktrunk adapter, repository inference), `stages/` (contract, registry, test stage), `attempts/` (records, state directory, lock, reconcile and launch steps, discard mode, render);
    - `config.ts` and `config.defaults.json`: optional blocks and the default overlay;
    - `label-triage/trackers/*`: `removeLabel`; `select/readers/linear.ts`: project name;
    - `args.ts`, `run.ts`, `runner.ts` (`RunContext.io` gains the new execs and managers), `report.ts` (reasons for default config keys);
    - tests for each, with fixtures recorded from `aoe` 1.14.0 and `wt` 0.77.0.
- **Docs**: `README.md`, `commands/run.md`, the glossary rename and `GLOSSARY-MAP.md`, `config.example.json`, ADR 0002 and ADR 0003.
- **Report contract**: `autonomous.run.v1` gains two step results and, in text and JSON, the attempt data; a new `autonomous.discard.v1` document for discard mode. No schema change for the run report.
- **Behaviour for consumers**: a run now needs `aoe` and `wt` on the `PATH` only when it reaches `reconcile` with attempts to observe or `launch` with something to launch; with no state directory and nothing selected, nothing is called. `--apply` runs can now create sessions and worktrees and write `taken`.
- **Dependencies**: no new packages. `aoe`, `wt` and `claude` through the existing exec.
- **Release**: `feat(autonomous):`, a minor release. The new configuration blocks are optional, so no dotfiles migration is required; the user may add them later.
- **Tracking**: Linear DOT-109, sub-issue of DOT-82; it unblocks DOT-110 and DOT-111.
