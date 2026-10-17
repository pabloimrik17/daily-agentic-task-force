# Design

## Context

See proposal.md for motivation. The decisions were settled with the user in a grill on 2026-10-17 and are recorded in Linear DOT-109.

These facts shape the approach:

- **The runner** (`src/runner.ts`): `runSteps` runs `STEPS = [quotaGateStep, labelTriageStep, selectStep]` and stops at the first step that does not advance. Each step sees `RunContext` with `args`, `now`, `config`, `results` (earlier steps' results, design D1 of work selection) and `io` (execs and factories). Modes that run no step (`--bootstrap-labels`, `--answer`) branch in `src/run.ts` before `runSteps`.
- **Nothing persists between runs.** Every step reads the trackers afresh; the plugin keeps no state on disk.
- **The trackers** (`src/label-triage/trackers/`) expose `addLabel` but no removal. All three CLIs remove labels incrementally: `bd label remove`, `gh issue edit --remove-label`, `linear issue update --remove-label` (verified for DOT-110).
- **The configuration** (`src/config.ts`) is parsed by hand with `validate.ts` primitives; `selection` was added as a required block by DOT-108 and needed a coordinated dotfiles migration.
- **`claude-print.ts`** is the one `claude -p` invocation; `PRINT_TIMEOUT_MS` is 300 s.
- **Agent of Empires 1.14.0** (verified 2026-10-17 on the source of the tag, read-only):
    - `aoe add <path> --title --group --tool --cmd-override --extra-args --launch` prints `ID: <16 hex>` on stdout; no `--json`.
    - `aoe list --json` carries `id, title, path, group, tool, profile`; trashed sessions stay listed with no marker. `aoe session show <id> --json` refreshes and carries `status` and `agent_session_id`. Status values: `running, waiting, idle, unknown, stopped, error, starting, deleting, creating`. `waiting` comes from Claude Code hooks (`Notification` for a permission prompt or AskUserQuestion); `Stop` gives `idle`.
    - `aoe remove <id>` moves to the trash by default, where the session keeps appearing as `error`; `--purge` deletes the record and AoE's own transcript, and keeps the worktree unless `--delete-worktree`. `aoe session capture <id> -n <lines> --strip-ansi` prints the pane.
    - `--extra-args` is spliced into a shell string, so a positional prompt must be single-quoted; `--cmd-override` takes an absolute path and degrades pane-content detection, hooks still work with `--tool claude`. `--yolo` adds the tool's permission bypass.
    - No tag or metadata field is exposed by the CLI; `color` and `favorite` are not in the JSON.
    - `codex` takes a positional prompt, `-m` and `-c model_reasoning_effort=`, and has status hooks. `opencode` takes `--prompt`, has no status hooks and no model flag in its interactive mode.
- **worktrunk 0.77.0**: `wt -C <repo> switch [--create --base <base>] <branch> --no-cd --format=json` prints `{ path, branch, … }`; an existing branch reuses its worktree; `--create` on an existing branch is an error. The user's path template is `<repo>-worktrees/<branch with / as ->`, the same as AoE's. User hooks: `copy-ignored` blocks, `bun install` runs in the background. `wt remove <branch>` removes the worktree.
- **ghd-aoe** (`~/.local/lib/ghd-aoe.ts`) is the precedent for: atomic JSON writes, a lock with pid and stale reclaim, a `pending` record before `aoe add`, recovery by path match with ambiguity refused, Haiku naming with a deterministic fallback, and group derivation from the repository. Its conversation reuse is not adopted.
- **Repository signals**: `linear issue view --json` carries `project.name` (`Dotfiles` for DOT-109); Beads tasks carry repository-named labels (`monolab`, `eci-av`, `iot-platform-frontend`) among topic labels; a GitHub id carries its repo.
- **Quality gates**: fallow audit on pre-commit and PRs, cyclomatic ≤ 9 for unexported `src/` functions, duplicates rejected; knip and fallow flag unused exports.

## Goals / Non-Goals

**Goals:**

- Every decision in code; the only LLM call is the session name, and it never blocks.
- The session and workspace integrations are behind contracts with one implementation each; a replacement touches one module and its tests.
- A crash at any point of a launch or a finalisation is recoverable by the next run without duplicating a session or repeating a stage.
- Everything observable in the report, text and JSON.

**Non-Goals:**

- Reading AoE's or worktrunk's files on disk; CLI only.
- Any stage implementation beyond the test stage.
- Counting slots or deciding whether a launch is allowed by capacity (DOT-111).

## Decisions

### D1 — Attempt records in a local state directory

```ts
interface AttemptRecord {
    schema: "autonomous.attempt.v1";
    id: string; // "<source>:<task>:<stage>:<n>"
    task: { source: Source; id: string; title: string };
    stage: string;
    attempt: number;
    state: AttemptState; // pending | created | started | completed | retained | aborted | discarded
    history: { state: AttemptState; at: string }[];
    taken: { added: string | null; removed: string | null };
    workspace: { manager: "worktrunk"; repository: string; inferredFrom: string; branch: string; path: string };
    session: { manager: "aoe"; profile: string; id: string | null; group: string; title: string; titleSource: "llm" | "fallback"; tool: string; agentSessionId: string | null } | null;
    observed: { status: string; state: "open" | "exited" | "gone"; needsHuman: boolean; at: string } | null;
    cleanup: { pending: true; error: string } | null;
    retained: { at: string; reason: string } | null;
}
```

Path: `<state>/attempts/<source>/<task id>/<stage>/<n>/record.json`, with `prompt.md`, `result.json` and `capture.txt` beside it. `<state>` is `$AUTONOMOUS_STATE`, else `$XDG_STATE_HOME/autonomous`, else `~/.local/state/autonomous`. GitHub ids contain `/` and `#`; the `/` nests one directory deeper, which is harmless. Writes go through a temporary file and `rename`, as ghd-aoe does. Records are parsed strictly with `validate.ts`; an unparsable record makes `reconcile` `not-evaluable` naming the file.

**Alternatives rejected:**

- A comment or field in the tracker. Three CLIs, three formats, and the state would be parsed from text. `taken` is the only tracker-level signal, and it is enough for a second machine to stay away.
- One index file for all attempts. Two writers would clobber each other; one directory per attempt needs no index, and listing is a directory walk.

### D2 — Session manager contract and the AoE adapter

```ts
interface SessionSpec { path: string; title: string; group: string; tool: "claude" | "codex"; binary: string | null; args: string[]; instruction: string }
interface SessionManager {
    create(spec: SessionSpec): Promise<Result<{ id: string }>>; // not started
    start(id: string): Promise<Result<void>>;
    observe(id: string): Promise<Result<Observed>>; // { state: "open" | "exited" | "gone"; status: string; needsHuman: boolean; agentSessionId: string | null }
    findByPath(path: string): Promise<Result<{ id: string; title: string }[]>>; // for recovery, which narrows by title
    capture(id: string, lines: number): Promise<Result<string>>;
    remove(id: string): Promise<Result<void>>; // permanent, workspace kept
}
```

`src/sessions/aoe.ts` implements it over `execCommand("aoe")`:

- `create`: `aoe [--profile p] add <path> --title <t> --group <g> --tool <tool> [--cmd-override <binary>] --extra-args "<args> '<instruction>'"`, no `--launch`, no `--yolo`. The id is the `ID:` line of stdout; when absent, the result is an error and the attempt stays `pending` for recovery. The instruction is single-quoted with `'` escaped as `'\''`, and the stage's args are appended in front of it as the tool expects (`--model`, `--effort` for claude; `-m`, `-c model_reasoning_effort=` for codex). The instruction is one short sentence naming the prompt file's absolute path: no task text reaches the shell.
- `start`: `aoe session start <id>`.
- `observe`: `aoe session show <id> --json`, mapped with the table of the spec; a non-zero exit whose stderr says the session is not found is `gone`, any other failure is an error.
- `findByPath`: `aoe list --json` filtered by `path` after `realpath` on both sides; it returns each match's id and listed title, so recovery can narrow by title.
- `capture`: `aoe session capture <id> -n 200 --strip-ansi`.
- `remove`: `aoe remove <id> --purge`, never `--delete-worktree`.

The profile is passed to every command when configured; otherwise AoE's default applies and `aoe profile default` is not called.

**Alternative rejected:** resolving the id by listing after `add` as ghd-aoe does. The `ID:` line is in the source; listing stays as the recovery path only.

### D3 — Observed state mapping in one function

| AoE `status` | `state` | `needsHuman` |
| --- | --- | --- |
| `running`, `starting`, `creating`, `idle`, `unknown` | `open` | false |
| `waiting` | `open` | true |
| `stopped`, `error`, `deleting` | `exited` | false |
| not found | `gone` | false |

`reconcile` also needs "is the agent busy": `running`, `starting` and `creating` are busy; `idle`, `waiting` and `unknown` are not. That is a second boolean on `Observed`, `busy`, so the manager module never sees AoE's vocabulary.

### D4 — Workspace manager contract and the worktrunk adapter

```ts
interface WorkspaceManager {
    prepare(repository: string, branch: string): Promise<Result<{ path: string; created: boolean }>>;
    release(repository: string, branch: string): Promise<Result<void>>;
}
```

`src/workspace/worktrunk.ts`: `prepare` runs `git -C <repo> rev-parse --verify --quiet refs/heads/<branch>` to decide `--create`, then `wt -C <repo> switch [--create] <branch> --no-cd --format=json` with a 120 s limit, and validates `path` as an existing directory. `--base` is omitted: worktrunk defaults to the repository's default branch and the user's config may override it. `release` runs `wt -C <repo> remove <branch>` without deleting the branch. Hooks run as configured; nothing waits for background ones.

The branch is `feature/<task id>-<slug>`: the slug is the title lower-cased, non-alphanumerics collapsed to `-`, cut to 40 characters. For a GitHub id the `/` and `#` become `-`. It is derived from the title at the task's first attempt and reused from the task's latest attempt record afterwards, so a title edited by a stage does not move the task to a new branch.

### D5 — Repository inference

`src/workspace/infer.ts`: `readdir` of the workspace root, keeping directories that contain `.git`; the task's signals (`WorkTask.repository` for GitHub, the Linear project name read by the Linear reader, Beads labels minus the contract labels and minus `taken`) are compared to directory names with ghd-aoe's `comparableName` (NFKD, `/_-` to space, lower-case). Exactly one directory matching any signal wins; zero or several is a `wait` reason that lists the signals and the matches. The Linear `WorkReader.detail` gains `project: string | null` from `issue view`'s `project.name`; `WorkTask` gains `project` and `repository` as nullable fields, both `null` for Beads.

The AoE group is derived from the repository directory name with ghd-aoe's rule: an existing group whose last segment compares equal wins, else the humanised directory name. Groups come from `aoe group list --json`.

### D6 — The stage contract and registry

```ts
interface Stage {
    id: string;
    emoji: string;
    agentArgs(tool: "claude" | "codex"): string[]; // model/effort flags the stage wants
    prompt(input: { attempt: AttemptRecord; task: WorkTask; resultPath: string }): string;
    completed(task: TrackerTask): boolean; // the tracker check; the marker is checked by reconcile
}
const STAGES: ReadonlyMap<string, Stage>; // registered implementations; "test" only in this change
```

`select/stage.ts` keeps `SUPPORTED_STAGES = ["grill-me"]` for selection; the registry is what `launch` consults, so a selected `grill-me` unit is reported as waiting for an implementation until DOT-110 registers one. The test stage's prompt asks the agent to write `result.json` with the given content and stop; its `completed` always returns true.

### D7 — The result marker

```json
{ "schema": "autonomous.result.v1", "attempt": "<id>", "outcome": "completed", "summary": "<text>", "artifacts": ["<paths>"], "finishedAt": "<iso>" }
```

Parsed strictly; `attempt` must equal the directory's id; `outcome` must be `completed`. Anything else counts as absent with the reason in the report. The prompt gives the agent the absolute path and the exact content to write, with the attempt id filled in.

### D8 — The reconcile step

`src/attempts/reconcile.ts`, step id `reconcile`, placed first in `STEPS`. Per record, in this order:

1. `pending` → `findByPath(workspace.path)`, keeping only the sessions whose title equals `record.session.title` (written before `create`): one → `created`; none → `aborted`; several → `retained` with reason. The title only narrows a path match and never identifies a session on its own, so a session the runner did not create is never adopted. On abort, `taken` is removed only when `taken.added` is set. When it is null the add was never recorded and `taken` may belong to another machine's run: nothing is removed, `taken.removed` stays null, the task is read, and the report says "task still carries taken; remove it by hand if no other run holds it" when it does. A failed read is reported and the abort proceeds. With `--apply` only; without it, report the resolution it would make.
2. `created` → with `--apply`, `start`, then `started`.
3. `started` → `observe`; write `observed`; when `exited` or `gone` and the proofs fail → `retained` with capture; when the proofs hold and `!busy` → finalise (capture, save `agentSessionId`, `remove`, `completed`, remove `taken`); when the proofs hold and `busy` → report "completing"; otherwise report the observation.
4. `completed` with `cleanup` → `remove` again; on success clear `cleanup` and remove `taken`.
5. `retained`, `aborted`, `discarded` → listed only.

The capture saved in steps 3 and 4 is never fatal: a failed `capture` or a failed write of `capture.txt` becomes a note (`capture failed: …`, `saving the capture failed: …`) and the finalisation or retention goes on.

A failure of a manager command for one attempt makes the step `not-evaluable` naming the command; attempts already written stay written. The step is `advance` otherwise, with reasons summarising counts (observed, finalised, retained, cleanups pending, needing a person).

### D9 — The launch step

`src/attempts/launch.ts`, step id `launch`, placed last. Input: the selected unit from the `select` result, or the supplied task from `--task` (read through the `WorkReader` of its source and passed through the same exclusions as `select`, so a taken or unclassified task is reported as such). Preconditions in order: stage registered; task read again carries no `taken`; no attempt of the task open, that is in `pending`, `created`, `started` or `retained`, or `completed` with a pending cleanup (an `aborted` or `discarded` record never counts, whatever its `cleanup` holds); repository inferred. Each failure is `wait` with the reason. Then the sequence of the spec: `prepare` → name (D10) → write `pending` record, with the session block and its title → `addLabel(taken)` with read-back, recording `taken.added` → write `prompt.md` → `create` → `created` → `start` → `started`. The title is in the record before `create` so recovery can narrow by it. Any failure after the record exists is `not-evaluable`; the record keeps the last state.

Without `--apply`, the step stops after the preconditions and the inference and reports the repository, branch and title it would use.

The attempt number is the highest existing number for that task and stage plus one.

### D10 — Session naming

`src/sessions/naming.ts` calls `claudePrint` with `naming.model` and `naming.effort`, a 10 s exec (`execCommand("claude", 10_000)`), the schema `{ title: string }`, and a prompt that asks for at most four English words describing the task's purpose from its title, description and labels, treated as untrusted data. The fallback is ghd-aoe's `normalizeTitle` (strip a conventional prefix, first four words, capitalised). The title is `auto <emoji> <name> (<task id>)`. The step's tier is `llm` when the inference answered, `code` otherwise, and `titleSource` records which.

### D11 — Discard mode

`src/attempts/discard.ts`, branched in `run.ts` like answer mode. Resolves the id (attempt id, or task id to the task's single attempt that still holds it: not `aborted`, not `discarded`, and not `completed` unless it carries a pending cleanup, the same rule for both forms, so a closed attempt never removes a `taken` a later one holds), then: when `session.id` is set and `observe` is not `gone`, save the capture and the agent's conversation id into the attempt directory (the "Session removal" rule applies to every removal by the runner; a failed capture or write is a note, never fatal) and `remove`; `removeLabel(taken)` with read-back; record `discarded` with `cleanup` set to null, so a stale cleanup never blocks a launch; `release` only with `--release-workspace`. Report `autonomous.discard.v1` with `{ schema, startedAt, outcome, attempt, task, removed: { session, taken, workspace } }`. A failure stops at that point and exits 3; what was already removed is reported.

### D12 — Run lock

`src/attempts/lock.ts`: `<state>/run.lock` written with `wx`, holding `{ pid, startedAt }`; a lock whose pid is dead is reclaimed by rename, as ghd-aoe does. A lock with no parsed owner, empty or unparsable, is most likely being written by another run between creating the file and filling it, so it is held, not reclaimed, until its mtime is older than a grace period (10 s, a constant); after that it is reclaimed as a dead one. Held by `main` around `runSteps` and around discard mode; bootstrap and answer mode do not take it. Held even without `--apply`, because `reconcile` reads records that `--apply` runs rewrite.

### D13 — Configuration overlay

`config.defaults.json` ships beside `config.example.json`:

```json
{ "sessions": { "tool": "claude", "profile": null, "binary": null }, "workspace": { "root": "~/WebstormProjects" }, "naming": { "model": "haiku", "effort": "low" } }
```

`loadConfig` parses the user's file, then for each optional block takes the user's object (or `{}`) and fills each missing key from the defaults, recording the filled paths in `ConfigLoad.defaulted: string[]`. Unknown keys are still rejected before the overlay. `~` in `workspace.root` is expanded with `HOME`. The run report prints `defaults: sessions.tool, …` in its header when the list is non-empty; `--json` carries it as `config.defaulted`. The schema id stays `autonomous.config.v1`: an old file still parses.

### D14 — Trackers gain removal

`Tracker.removeLabel(id, label)` on the three trackers, with the commands above. A shared `removeLabelConfirmed(tracker, id, label)` in `src/attempts/taken.ts` performs the removal and the read-back and returns the labels found when the label is still there; `addLabel` for `taken` goes through the same read-back helper that triage uses. Triage's `write.ts` is untouched.

### D15 — Arguments

`args.ts` gains `task: { source; id } | undefined`, `stage: string | undefined`, `discard: string | undefined`, `releaseWorkspace: boolean`. Combinations: `--stage` needs `--task`; `--task`/`--stage` exclude `--bootstrap-labels`, `--answer`, `--discard`; `--discard` needs `--apply` and combines with `--json` and `--release-workspace` only; `--release-workspace` needs `--discard`. `--task` parses `<source>:<id>` at the first `:` and rejects an unknown source.

### D16 — Where the new execs live

`MainDeps` and `RunContext.io` gain `sessions: SessionManager`, `workspace: WorkspaceManager`, `naming: NamingExec`, `state: string` (the resolved state directory), `git: Exec` and `fs` is not injected: records are read and written through `node:fs/promises` under `state`, and tests point `AUTONOMOUS_STATE` at a temporary directory. The AoE and worktrunk adapters are built from `execCommand("aoe")`, `execCommand("wt", 120_000)` and `execCommand("git")`.

### D17 — Tiering

| Part | Tier |
| --- | --- |
| records, lock, recovery, observation, proofs, finalisation, retention, cleanup | code |
| preconditions, inference, branch, workspace, `taken`, creation, start | code |
| session name | llm, with a code fallback |
| discard | code |

### D18 — Glossary rename

`plugins/autonomous/CONTEXT.md` → `GLOSSARY.md` and `plugins/stonks/CONTEXT.md` → `GLOSSARY.md` with `git mv`; root `GLOSSARY-MAP.md` listing both contexts and their relationship (none today); links updated in both READMEs, the ADRs, `commands/run.md` and the Linear issues DOT-82 and DOT-110. One `chore:` commit, so the rename does not hide in the feature diff.

### D19 — ADRs

- `0002-remove-taken-on-finalisation.md`: the runner removes `taken` when an attempt is finalised or discarded; the second exception to never removing a label; alternatives: never remove (tasks blocked forever after each stage), remove when the session exits (loses the retained-attempt guarantee).
- `0003-optional-config-blocks-with-shipped-defaults.md`: optional blocks overlaid from a shipped defaults file, key by key, reported when used; why `selection` stays required; alternatives: required with a major release, writing the user's file (clashes with chezmoi-managed configs).

## Risks / Trade-offs

- **[A session purged after the agent completed holds the only copy of what it printed.]** → The capture (200 lines) and `agentSessionId` are saved first; Claude's own conversation stays in `~/.claude/projects` and can be resumed by hand.
- **[`aoe add` output format changes and the id is not parsed.]** → The attempt stays `pending` and recovery by path adopts the session on the next run; the fixture test pins the current format.
- **[Repository inference picks the wrong repo.]** → Only an exact single match is accepted; the report names the signal used; a wrong worktree is visible before any agent work matters, and the dry run shows it without `--apply`.
- **[Branch collision: `feature/x` and `feature-x` map to one directory.]** → Task ids are unique per source and the slug is a suffix; worktrunk reports "path occupied" and the launch fails closed.
- **[The agent never writes the marker.]** → The attempt stays open as "idle without a result" and the user discards it; nothing is retried or lost.
- **[A crash between the `taken` write and the parse of `aoe add` could adopt a manual session that shares the worktree.]** → Closed: recovery narrows the path match by the title the runner recorded before `create`, so a session it did not create is not a candidate; the title never identifies a session on its own, and the report names the adopted id before anything is started.
- **[An abort of a pending attempt whose `taken` write was never recorded could remove a `taken` another machine's run holds.]** → The abort removes `taken` only when the record shows the runner added it; otherwise it reports that the task still carries it, for removal by hand.
- **[The user removes `taken` by hand while an attempt is open.]** → `launch` checks open attempts, not only `taken`, so the task is not launched twice; `reconcile` still finalises the open one.
- **[A codex session's `waiting` is only a permission request.]** → Documented; the grill stage in DOT-110 targets claude.
- **[fallow complexity budget.]** → `reconcile` is a dispatch on state with one function per state; the launch sequence is a list of steps each returning a result.
- **[Haiku naming costs a call per launch.]** → 10 s limit, low effort, fallback; the step never waits on it beyond the limit.

## Migration Plan

1. Merge this change; release-please opens a minor release of `autonomous`.
2. No configuration change is required. The user may add `sessions`, `workspace` or `naming` keys later; until then the report lists the defaults used.
3. On each machine, update the plugin and run `/autonomous:run` once without `--apply`: `reconcile` reports nothing to reconcile, and `launch` reports the selected unit as waiting for a stage implementation.
4. Validate the cycle with `bun plugins/autonomous/src/run.ts --account <key> --apply --task <source>:<id> --stage test`, then with the session finished, a second run finalises it; record both in the evidence file.

Rollback: reinstall the previous plugin version. Attempt records and worktrees are inert files; `taken` labels left by an open attempt are removed by hand, as DOT-108 already documents.
