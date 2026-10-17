# Spec Delta

## Purpose

Runs one fresh agent session per attempt to advance a task's stage, through replaceable session and workspace integrations, and decides from evidence whether the stage completed, failed or still needs a person.

## ADDED Requirements

### Requirement: An attempt

An attempt SHALL be one launch of a managed session for one stage of one task, identified as `<source>:<task>:<stage>:<n>`, where `n` counts the attempts of that task and stage from 1. Its record SHALL hold the task, the stage, the attempt number, its state, the time of each state change, the workspace, the session, whether `taken` was added and removed, the last observation, and any retention or pending cleanup. The record SHALL be kept outside every tracker and outside the workspace.

#### Scenario: Second attempt of a stage

- **WHEN** Linear `DOT-109` was attempted once for `grill-me` and is launched again for it
- **THEN** the new attempt is `linear:DOT-109:grill-me:2`

#### Scenario: Record outside the workspace

- **WHEN** an attempt is launched for a task whose worktree is `/w/repo-worktrees/feature-DOT-109`
- **THEN** no file of the attempt is written under that worktree

### Requirement: Attempt states

An attempt SHALL be in exactly one of: `pending` (record written, no session yet), `created` (session exists, not started), `started`, `completed`, `retained` (its session exited without completing), `aborted` (no session was ever created) or `discarded`. A `completed` attempt MAY additionally carry a pending cleanup. Every state change SHALL be written to the record before the next action that depends on it.

#### Scenario: Interrupted between creation and start

- **WHEN** the runner is killed after the session was created and before it was started
- **THEN** the record reads `created` and names the session id

### Requirement: Local state directory

Attempt records and their files SHALL live under a state directory, `$XDG_STATE_HOME/autonomous` by default (`~/.local/state/autonomous` when `XDG_STATE_HOME` is unset), overridable with the environment variable `AUTONOMOUS_STATE`. Each attempt SHALL have its own directory, nested by source, task, stage and attempt number, holding the record, the prompt, the result marker when written and the capture when retained. Writes SHALL be atomic: a reader never sees a partial record.

#### Scenario: GitHub task directory

- **WHEN** an attempt is launched for GitHub `owner/name#12` at stage `test`
- **THEN** its files live under `<state>/attempts/github/owner/name#12/test/1/`

#### Scenario: Override for tests

- **WHEN** `AUTONOMOUS_STATE` names a directory
- **THEN** every attempt record is read from and written to that directory

### Requirement: Run lock

A run that reads or writes attempts SHALL hold a lock in the state directory for its duration. A run that finds the lock held by a live process SHALL be `not-evaluable`, naming the other run. A lock left by a process that no longer exists SHALL be reclaimed.

#### Scenario: Overlapping runs

- **WHEN** a run starts while another run holds the lock and is still alive
- **THEN** the new run is `not-evaluable` with a reason naming the active run and writes nothing

#### Scenario: Stale lock

- **WHEN** the lock names a process id that no longer exists
- **THEN** the run reclaims the lock and proceeds

### Requirement: The reconcile step

`/autonomous:run` SHALL run a `reconcile` step first, before `quota-gate`, so a completed stage is recorded and its session removed even when no quota is left. The step SHALL resolve `pending` attempts, observe every `created` or `started` attempt, finalise, retain or report each as the requirements below define, retry pending cleanups, and SHALL NOT return `wait`. Without `--apply` it SHALL observe and report what it would do, writing nothing.

#### Scenario: Quota exhausted

- **WHEN** a started attempt has completed its stage and the Claude account has no quota left
- **THEN** `reconcile` finalises the attempt and `quota-gate` then returns `wait`

#### Scenario: Nothing to reconcile

- **WHEN** the state directory holds no attempt
- **THEN** the step is `advance` with the reason that there is nothing to reconcile, and no session manager command is run

#### Scenario: Session manager unreadable

- **WHEN** a started attempt exists and the session manager cannot list sessions
- **THEN** the step is `not-evaluable` with a reason naming the command, and no attempt changes state

### Requirement: Observed session state

The session integration SHALL reduce what it observes to `open`, `exited` or `gone`, and for `open` whether the session needs a person. For Agent of Empires: `running`, `starting`, `creating`, `idle` and `unknown` are `open`; `waiting` is `open` and needs a person; `stopped`, `error` and `deleting` are `exited`; a session absent from the listing is `gone`. An observed state SHALL never by itself make an attempt completed.

#### Scenario: Waiting for the person

- **WHEN** the session of a started attempt reports `waiting`
- **THEN** the attempt is reported as open and needing a person, and nothing changes

#### Scenario: Idle without a result

- **WHEN** the session reports `idle` and no result marker exists
- **THEN** the attempt stays `started` and the report lists it as idle without a result

#### Scenario: Unknown state

- **WHEN** the session reports `unknown`
- **THEN** the attempt is treated as open and nothing changes

### Requirement: Completion needs two proofs

An attempt's stage SHALL count as completed only when a valid result marker exists for that attempt and the stage's own check against the task's tracker holds. A marker is valid when it parses, names that attempt's id and reports outcome `completed`. A marker that is missing, malformed, or names another attempt SHALL count as absent and be reported.

#### Scenario: Marker from another attempt

- **WHEN** the marker in attempt 2's directory names attempt 1
- **THEN** the marker counts as absent and attempt 2 is not completed

#### Scenario: Tracker changed by hand

- **WHEN** the stage's tracker check holds but no marker was written
- **THEN** the attempt is not completed

#### Scenario: Both proofs present

- **WHEN** the marker is valid and the stage's tracker check holds
- **THEN** the attempt is eligible for finalisation

### Requirement: Finalisation

An eligible attempt SHALL be finalised only when its session is `open` without being running, `exited` or `gone`; a session reporting `running`, `starting` or `creating` SHALL be left alone. Finalisation SHALL, in order: save the agent's conversation id and a capture of the session in the attempt directory, remove the session, mark the attempt `completed`, then remove `taken` from the task. The attempt directory and the workspace SHALL be kept.

#### Scenario: Agent still running

- **WHEN** both proofs are present and the session reports `running`
- **THEN** nothing is removed and the attempt is reported as completing

#### Scenario: Successful finalisation

- **WHEN** both proofs are present and the session reports `idle`
- **THEN** the session is removed, the attempt reads `completed`, `taken` is removed from the task and the worktree still exists

### Requirement: Pending cleanup

When the session cannot be removed after both proofs are present, the attempt SHALL be marked `completed` with a pending cleanup naming the error, `taken` SHALL stay on the task, and every later `reconcile` SHALL retry the removal and then remove `taken`. The stage SHALL NOT run again for that task while the cleanup is pending.

#### Scenario: Removal fails

- **WHEN** both proofs are present and removing the session fails
- **THEN** the attempt reads `completed` with the cleanup error, the task still carries `taken`, and the report lists the pending cleanup

#### Scenario: Cleanup retried

- **WHEN** a later run removes the session of an attempt with pending cleanup
- **THEN** the cleanup is cleared and `taken` is removed from the task

### Requirement: Retained attempts

When a `started` attempt's session is `exited` or `gone` and the stage is not completed, the attempt SHALL be marked `retained`, with the reason and the time, and the last lines of the session captured into the attempt directory when the session still exists. A retained attempt SHALL keep `taken`, keep its session, and SHALL NOT be retried, relaunched or removed by any run. Every run SHALL list it until the user discards it.

#### Scenario: Session exited without result

- **WHEN** the session of a started attempt reports `stopped` and no valid marker exists
- **THEN** the attempt reads `retained`, its capture file exists, and the task still carries `taken`

#### Scenario: Retained attempt on later runs

- **WHEN** a run reconciles a retained attempt
- **THEN** it is listed in the report and nothing changes

### Requirement: Recovery of a pending attempt

A `pending` attempt SHALL be resolved before anything else: when exactly one session of the session manager has the attempt's workspace path, the attempt adopts it and becomes `created`; when none has it, `taken` is removed from the task and the attempt becomes `aborted`; when several have it, the attempt is retained for the user with that reason. A `created` attempt SHALL be started by `reconcile` with `--apply`.

#### Scenario: Session was created before the crash

- **WHEN** a pending attempt's workspace path matches one session
- **THEN** the attempt reads `created` with that session's id, and nothing is created again

#### Scenario: No session was created

- **WHEN** no session has the pending attempt's workspace path
- **THEN** `taken` is removed from the task and the attempt reads `aborted`

#### Scenario: Ambiguous recovery

- **WHEN** two sessions have the pending attempt's workspace path
- **THEN** the attempt is retained with that reason and neither session is touched

### Requirement: The launch step

`/autonomous:run` SHALL run a `launch` step last, after `select`. It SHALL take the selected work unit and, before anything else, check that the stage has an implementation, that the task read again from its tracker carries no `taken`, that no attempt of the task is `pending`, `created`, `started` or `retained`, and that a repository is inferred. A failed precondition SHALL make the step `wait` with that reason. Without `--apply` the step SHALL report what it would launch and `advance`.

#### Scenario: Stage without implementation

- **WHEN** the selected unit's stage is `grill-me` and no stage implementation is registered for it
- **THEN** the step is `wait` with a reason naming the stage

#### Scenario: Taken since selection

- **WHEN** the task read again carries `taken`
- **THEN** the step is `wait` and nothing is launched

#### Scenario: Dry run

- **WHEN** the run is invoked without `--apply` and every precondition holds
- **THEN** the step reports the task, stage, repository and branch it would use, writes nothing and is `advance`

### Requirement: Launch sequence

With `--apply`, `launch` SHALL, in order: prepare the workspace; write the attempt record as `pending` with the workspace path; add `taken` to the task; write the prompt; create the session; record its id and mark `created`; start the session and mark `started`. A failure at any point SHALL leave the record in the last state reached and make the step `not-evaluable` with the reason; a failure to add `taken` SHALL create no session.

#### Scenario: Taken cannot be written

- **WHEN** adding `taken` to the task fails
- **THEN** no session is created, the attempt reads `pending`, and the step is `not-evaluable` naming the write

#### Scenario: Launched

- **WHEN** every step of the sequence succeeds
- **THEN** the task carries `taken`, the record reads `started` with the session id, and the step is `advance`

#### Scenario: Creation fails

- **WHEN** creating the session fails after `taken` was added
- **THEN** the attempt stays `pending` and the next `reconcile` resolves it

### Requirement: Session identity

A managed session SHALL be identified by the id the session manager assigns at creation, read from the creation command's output and confirmed by reading the session back. The title SHALL never identify a session. The workspace path SHALL be used only to recover a pending attempt.

#### Scenario: Id parsed and confirmed

- **WHEN** the session manager reports the new session's id
- **THEN** the record holds that id and reading the session by it succeeds

#### Scenario: Id not parsed

- **WHEN** the creation command succeeds but its output carries no id
- **THEN** the attempt stays `pending` and is resolved by recovery on the next run

### Requirement: Session title and group

A managed session SHALL be titled `auto <emoji> <name> (<task id>)`, where the emoji is the stage's, and the name is at most four English words inferred by an LLM from the task's title and description, falling back to the task title's first words when the inference fails, times out or returns something invalid. The group SHALL be the project's, derived from the repository as the existing `ghd-aoe` integration does. The report SHALL say whether the name came from the LLM or the fallback.

#### Scenario: Name inferred

- **WHEN** the LLM returns a valid name for Linear `DOT-109` at stage `test`
- **THEN** the session is titled `auto 🧪 <name> (DOT-109)` and the report says the name was inferred

#### Scenario: Inference times out

- **WHEN** the LLM does not answer within its time limit
- **THEN** the session is titled with the fallback name, the launch proceeds and the report says the fallback was used

### Requirement: Session creation arguments

The session SHALL be created with the configured tool, in the workspace path, with the stage's agent arguments, and with an initial instruction that tells the agent to read the attempt's prompt file and follow it. The prompt file SHALL carry the attempt id, the task, the stage's instructions, and the absolute path and expected content of the result marker. The session SHALL never be created with the tool's permission bypass.

#### Scenario: Prompt as a file

- **WHEN** a session is created for an attempt
- **THEN** the prompt file exists in the attempt directory before the session is created, and the initial instruction names its absolute path

### Requirement: Supported session tools

The configured session tool SHALL be `claude` or `codex`. Any other value SHALL be rejected by the configuration with its path.

#### Scenario: Unsupported tool

- **WHEN** the configuration sets the session tool to `opencode`
- **THEN** the configuration is rejected with the path of that key

### Requirement: Session removal

The runner SHALL remove a managed session permanently, never to a trash, and SHALL never ask the session manager to delete the workspace. Before removal it SHALL save the agent's conversation id and a capture of the session into the attempt directory.

#### Scenario: Removed session is gone

- **WHEN** a session is removed by the runner
- **THEN** it no longer appears in the session manager's listing and its worktree still exists

### Requirement: Manual sessions are untouched

The runner SHALL act only on sessions whose id is recorded in an attempt. It SHALL never remove, start, stop or rename any other session.

#### Scenario: Manual session with the same path

- **WHEN** a session the user created by hand shares a worktree path with a completed attempt
- **THEN** that session is not touched by any run

### Requirement: Stage contract

A stage SHALL declare: its id, its emoji, its prompt for a task, its agent arguments, and its completion check against the task's tracker. A stage SHALL be launchable only when an implementation is registered for its id. Registering a stage SHALL require no change to `reconcile` or `launch`.

#### Scenario: Stage registered later

- **WHEN** an implementation for `grill-me` is registered
- **THEN** `launch` can launch `grill-me` units without any change to the steps

### Requirement: The test stage

A stage `test` with emoji 🧪 SHALL exist whose prompt asks the agent only to write the result marker and stop, and whose tracker check always holds. It SHALL never be a task's next stage and SHALL be launchable only through `--task … --stage test`.

#### Scenario: Test stage never selected

- **WHEN** `select` runs
- **THEN** no work unit has stage `test`

#### Scenario: Test stage completes

- **WHEN** an attempt at stage `test` has a valid marker and its session is idle
- **THEN** the attempt is finalised

### Requirement: Supplied task

With `--task <source>:<id>`, the run SHALL skip `label-triage` and `select` and give that task to `launch` as the selected unit, with the task's next stage, or the stage named by `--stage`. `launch` SHALL apply every precondition as usual. `--stage` SHALL be accepted only together with `--task` and SHALL name a registered stage.

#### Scenario: Supplied task with the test stage

- **WHEN** the run is invoked with `--apply --task linear:DOT-109 --stage test`
- **THEN** `reconcile`, `quota-gate` and `launch` run, `label-triage` and `select` do not, and an attempt `linear:DOT-109:test:<n>` is launched

#### Scenario: Stage without task

- **WHEN** the run is invoked with `--stage test` and no `--task`
- **THEN** the run prints a usage message and exits with code 1

#### Scenario: Supplied task excluded

- **WHEN** the supplied task carries no scope label
- **THEN** `launch` is `wait` with the exclusion reason

### Requirement: Discard mode

With `--apply --discard <attempt-id>`, the run SHALL run no step and SHALL, in order: remove the attempt's session when it still exists, remove `taken` from the task, and mark the attempt `discarded`, keeping its directory. With `--release-workspace` it SHALL also release the workspace, keeping the branch.

#### Scenario: Discard a retained attempt

- **WHEN** the run is invoked with `--apply --discard linear:DOT-109:test:1` for a retained attempt
- **THEN** its session is removed, `taken` is removed from `DOT-109`, the attempt reads `discarded` and its worktree still exists

#### Scenario: Session removal fails on discard

- **WHEN** removing the session fails
- **THEN** the attempt stays as it was, `taken` stays, and the run exits with code 3 naming the error

#### Scenario: Release the workspace

- **WHEN** `--discard … --release-workspace` is given
- **THEN** the worktree is removed after the session, and the branch is kept

### Requirement: Discard by task id

`--discard` MAY name a task as `<source>:<task>` instead of an attempt. It SHALL resolve to the task's single attempt that is not `completed`, `aborted` or `discarded`; when there are none or several, nothing SHALL change and the run SHALL report the attempt ids found.

#### Scenario: Discard by task

- **WHEN** `--discard linear:DOT-109` names a task with exactly one open attempt
- **THEN** that attempt is discarded

#### Scenario: Ambiguous task

- **WHEN** `--discard linear:DOT-109` names a task with two open attempts
- **THEN** nothing changes and the run reports both attempt ids

### Requirement: Workspace preparation

A workspace SHALL be a git worktree of the task's repository on the branch `feature/<task id>-<slug>`, where the slug is derived from the task title. When the branch exists, its worktree SHALL be reused; otherwise the branch SHALL be created from the repository's default branch. The runner SHALL never remove a worktree except on `--discard --release-workspace`, and SHALL never delete a branch. The runner SHALL NOT wait for background hooks of the workspace tool.

#### Scenario: Branch exists

- **WHEN** `feature/DOT-109-stage-session-manager` already has a worktree
- **THEN** the attempt uses that worktree and no branch is created

#### Scenario: Worktree reused across attempts

- **WHEN** attempt 2 of a task is launched after attempt 1 was discarded with the workspace kept
- **THEN** attempt 2 uses the same worktree

### Requirement: Repository inference

The repository SHALL be inferred from the task against the git repositories directly under the configured workspace root: for GitHub, the repository name of the task id; for Linear, the project name; for Beads, every label that is not a contract label. Names SHALL be compared case-insensitively with separators normalised. Exactly one match SHALL be required; zero or several matches SHALL prevent the launch with the reason.

#### Scenario: Beads label names the repository

- **WHEN** a Beads task carries `work`, `AFK` and `monolab`, and `<root>/monolab` is a git repository
- **THEN** the repository is `<root>/monolab`

#### Scenario: Two matches

- **WHEN** a Beads task carries two labels that both name repositories
- **THEN** the task is not launched and the reason names both

#### Scenario: Linear project

- **WHEN** a Linear task belongs to project `Dotfiles` and `<root>/dotfiles` is a git repository
- **THEN** the repository is `<root>/dotfiles`

### Requirement: Attempt report

The run report SHALL show, for `reconcile`, every attempt observed with its id, state, session state, whether it needs a person, and what was done to it; the retained attempts; the pending cleanups; and for `launch`, the attempt launched or the reason nothing was. With `--json` the steps' data SHALL carry the same information.

#### Scenario: Report of a run with one open attempt

- **WHEN** one started attempt is waiting for the person
- **THEN** the text report names the attempt, `waiting`, needs a person, and that nothing changed

### Requirement: Session and workspace commands are bounded

Every session manager command SHALL be bounded by the plugin's CLI time limit, and workspace preparation by 120 s. A command that exceeds its limit SHALL count as failed.

#### Scenario: Worktree preparation hangs

- **WHEN** preparing the worktree takes longer than 120 s
- **THEN** the launch fails with a reason naming the workspace command, and no `taken` is written
