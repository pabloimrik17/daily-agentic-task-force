# autonomous

Entry point of the autonomous loop: an orchestrator that will discover
previously defined work and delegate it to other agents. Before it may start
anything it runs a fixed list of gate steps. Today that list holds two steps:
`quota-gate`, which decides whether the Claude account has quota to spend, and
`label-triage`, which reports the tasks missing a label of the contract and,
with `--apply`, writes the labels it is confident about.

**The contracts are provisional.** The step contract, the run report and the
runner shape are a first iteration and are expected to change as further steps
are added. The JSON report is versioned (`autonomous.run.v1`) so consumers can
detect a change.

## Install

```bash
/plugin marketplace add pabloimrik17/daily-agentic-task-force
/plugin install autonomous@daily-agentic-task-force
```

## Requirements

- [`bun`](https://bun.sh) on `PATH`. The step runner is TypeScript executed
  from source; plugins install without dependencies, so it uses nothing but
  `bun` and Node built-ins.
- The [`openusage`](https://github.com/robinebers/openusage) CLI on `PATH`,
  verified against 0.7.12. Its `openusage.limits.v1` output is validated
  strictly; a change in that contract makes the gate `not-evaluable`, never a
  silent pass. A call that takes longer than 120 s is treated as a failure
  (`not-evaluable`).
- [`bd`](https://github.com/steveyegge/beads) on `PATH`, verified against
  1.3.0.
- [`gh`](https://cli.github.com) on `PATH`, verified against 2.100.0,
  authenticated through its own keyring.
- [`linear`](https://github.com/schpet/linear-cli) (schpet/linear-cli) on
  `PATH`, verified against 2.6.0, authenticated with `linear auth login`
  (credentials in the macOS keychain, or `LINEAR_API_KEY`). No official
  Linear CLI exists.
- [`claude`](https://claude.com/product/claude-code) 2.1.283 or later, for
  `-p`, `--model`, `--effort`, `--output-format json`, `--json-schema`,
  `--safe-mode`, `--tools`, `--strict-mcp-config` and
  `--no-session-persistence`.

Every CLI's output is validated by hand; there are still no runtime
dependencies. Each call is bounded by a 120 s timeout, except the LLM
judgement batch, which allows 300 s. A missing CLI is installed through the
user's dotfiles (`BREW_PACKAGES`); adding the Linear CLI there is tracked as
DOT-82 sub-issue 7.

## Usage

```text
/autonomous:run [--account <provider-key>] [--force] [--json] [--apply]
/autonomous:run --bootstrap-labels [--json]
```

| Flag                       | Effect                                                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `--account <provider-key>` | Claude account to evaluate (`claude` or `claude@<id>`). Required when several Claude accounts are present                                 |
| `--force`                  | Ask OpenUsage to bypass its shared cache                                                                                                  |
| `--json`                   | Print one `autonomous.run.v1` JSON document instead of the text report; with `--bootstrap-labels`, one `autonomous.bootstrap.v1` document |
| `--apply`                  | Let steps write. Without it a run has no side effects beyond the CLIs' own caches                                                         |
| `--bootstrap-labels`       | Run only the label bootstrap and exit. Only combines with `--json`                                                                        |

The script can also be run directly, which is what a shell or `/loop` should
branch on:

```bash
bun plugins/autonomous/src/run.ts --account claude --json --apply
```

`--apply` and `--bootstrap-labels` are the only ways anything is written. They
are separate write paths that cannot be combined, and each must be typed
explicitly: nothing adds either on its own. A `/loop` that should write passes
`--apply` explicitly, as above.

### Exit codes

For `/autonomous:run [--account …] [--force] [--json] [--apply]`:

| Code | Outcome                                                                                                                                       |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | `advance` — every step advanced                                                                                                               |
| 2    | `wait` — a step says to wait (for example, a window exhausted)                                                                                |
| 3    | `not-evaluable` — no decision possible: account absent, ambiguous or unknown, or data missing, incomplete, invalid, outdated, stale or failed |
| 1    | Invalid arguments or a failure of the runner itself                                                                                           |

For `/autonomous:run --bootstrap-labels [--json]`:

| Code | Outcome                                                                                             |
| ---- | --------------------------------------------------------------------------------------------------- |
| 0    | Every label is present or was created on every enabled source                                       |
| 3    | The configuration could not be loaded, a source could not be evaluated, or a label failed to create |
| 1    | Invalid arguments or a failure of the runner itself                                                 |

## Configuration

Per-user settings live outside the plugin, in one JSON file validated as
strictly as the OpenUsage document: a missing file, a missing required field,
a mistyped field or an unknown field is an error naming the path, never a
default. No credentials are stored in it.

- Path: `~/.config/autonomous/config.json`, overridable with
  `AUTONOMOUS_CONFIG` (mainly for tests and machines with several roles).
- Schema: `autonomous.config.v1`.
- A missing file's error names the path and points to the example at
  `plugins/autonomous/config.example.json`.
- Without a configuration file the quota gate still runs, but a run it lets
  through then exits 3 (`not-evaluable`), because `label-triage` cannot be
  evaluated. This changes the outcome for users who ran only the quota gate.

```jsonc
{
    "schema": "autonomous.config.v1",
    "sources": {
        "linear": {
            "enabled": true,
            "scope": "personal",
            "aliases": { "grill-me": ["Grill Me"] },
        },
        "beads": {
            "enabled": true,
            "directory": "/path/to/beads/repo",
            "aliases": {
                "work": ["project:example"],
                "personal": ["project:personal"],
                "HITL": ["human"],
            },
        },
        "github": {
            "enabled": true,
            "repos": ["owner/repo"],
            "scope": "personal",
        },
    },
    "judgement": {
        "model": "claude-sonnet-5",
        "effort": "medium",
        "threshold": 0.95,
        "cap": 25,
        "batch": 20,
    },
}
```

Per source:

- `enabled` — whether `label-triage` and `--bootstrap-labels` touch this
  source at all.
- `scope` — `"work"` or `"personal"`: the structural rule, which makes every
  task from this source evidence for that scope. It counts alongside any alias
  evidence: when they agree the scope is derived, and when they disagree the
  task is left for the human.
- `aliases` — legacy label names, per contract label, that count as evidence
  for that label without being the label itself. They are never removed from
  a task; the contract label is added alongside them.
- `directory` (Beads only) — the repository `bd` runs against (`-C`).
- `repos` (GitHub only) — the `owner/repo` list `gh` operates on.

`judgement` configures the LLM tier: `model` and `effort` passed to
`claude -p`, `threshold` (0-1) a group's confidence must meet to be written,
`cap` the maximum number of tasks judged in a run, `batch` the maximum number
of tasks sent to one `claude -p` call.

## The label contract

Every task carries two label groups:

| Group | Labels                    | Rule                                                                                  |
| ----- | ------------------------- | ------------------------------------------------------------------------------------- |
| scope | `work`, `personal`        | Exactly one. `work` is Nazaries work and has priority over `personal`                 |
| entry | `AFK`, `HITL`, `grill-me` | At least one. `AFK` and `HITL` never together; `grill-me` precedes both when combined |

`AFK` means an agent may advance the task without a human; `HITL` means an
agent may advance it, but a human intervenes during or at the end of each
stage; `grill-me` means the task must be refined with a human before anyone
works on it.

Spelling is exact and case-sensitive: `Grill Me` is not `grill-me`. Colours,
applied where the tracker supports them:

| Label      | Colour    |
| ---------- | --------- |
| `AFK`      | `#5e6ad2` |
| `HITL`     | `#eb5757` |
| `grill-me` | `#f2994a` |
| `work`     | `#2f80ed` |
| `personal` | `#27ae60` |

The loop never creates labels on its own. `--bootstrap-labels` does: at
workspace level on Linear (a same-name label in any team counts as present),
per repo on GitHub, and not at all on Beads, where labels exist only by use. An existing label with a different colour is left
untouched and reported, never overwritten. Legacy names configured as
`aliases` are evidence for a rule and are never removed.

## The `label-triage` step

Second in the run, after `quota-gate`. It reads the open tasks of every
enabled source — Linear across all teams except completed, canceled and
`Duplicate` issues, Beads issues that are `open` or `in_progress`, GitHub open
issues per configured repo — and reports every task missing a label group or
carrying a group conflict.

Each missing group is first derived by a deterministic rule from its evidence
(aliases, the source's structural `scope`), and a group whose evidence
conflicts is listed for a human. A group with no evidence — usually entry, and
scope on a source without a structural rule — is derived by an LLM judgement,
batched and capped, ordered with `work` evidence first and then by most
recently updated. Only a group at or above the
configured `threshold`, and valid under the contract, is written, and only
with `--apply`: writes are additive, read back to confirm, and a source stops
writing on the first mismatch — nothing is ever removed. An unreadable source
makes the whole run `not-evaluable`; a failed judgement only drops the LLM's
contribution, and the step itself never blocks the run (`advance`) —
everything else is still listed for a human.

The report carries, per source and group, counts and
`source → task → labels → reason` lines (whether applied or only proposed,
the tier, the confidence), the tasks left for a human, and any write failure.
The JSON form carries one record per derived group with its status, so an
error rate can be measured from reports alone, with no other state kept
between runs.

The first `--apply` is the intended one-off clean-up of the existing backlog
(roughly 400 Beads issues gaining `work`, roughly 90 Linear and GitHub issues
gaining `personal`): run without `--apply` first and read the report before
applying. That first `--apply` issues about a thousand CLI calls and exceeds
the command's timeout, so it must be run from a shell
(`bun plugins/autonomous/src/run.ts --account <key> --apply`), not through
`/autonomous:run`.

### Active-account caveat

The judgement runs `claude -p` on the active Claude account, through the
subscription the quota gate already checked. `--account` must name that same
account; `claude-swap` integration is deferred. The judgement runs in safe
mode with no tools, no hooks, no MCP servers and no session persistence,
because the prompt carries issue text anyone can write.

## The quota gate

For the selected account the gate reads OpenUsage and evaluates the `session`
and `weekly` windows: used amount, limit, window length, reset time, and the
usage projected to the end of the window as OpenUsage's `Pace.evaluate`
computes it. Other resources, such as `fable`, are listed but not evaluated.
They must still be well-formed, because validation covers the whole OpenUsage
document, including accounts that are not selected.

The decision, in order of precedence:

1. **wait** when either window, with fresh, complete and valid data, has
   `used ≥ limit` and a reset time still ahead;
2. **not-evaluable** when the account is stale, OpenUsage reports an error for
   it, a window is missing, incomplete or invalid, or an exhausted window's
   reset time has already passed (refresh with `--force`);
3. **advance** otherwise.

Projection is reported but never blocks. Missing or stale data is never read as
available capacity.

## Tiering: code → Jev → LLM

Every part of every step is placed in the earliest tier that can do it
reliably:

1. **Code** — anything fully deterministic.
2. **Jev** (TypeSafe AI) — narrow, typed judgements that fit a
   schema-constrained answer: a choice, a classification, an evaluation.
   Control flow stays in code.
3. **LLM** — open-ended reasoning or text.

This buys determinism, reliability and a lower token cost. Every part of the
quota gate, and every step's report rendering, is code. `label-triage`'s
tiering:

| Part                                            | Tier |
| ----------------------------------------------- | ---- |
| read and validate the three sources             | code |
| detect missing groups and conflicts             | code |
| scope and entry by rule (evidence)              | code |
| entry (and scope without evidence) by judgement | llm  |
| threshold, validity, ordering, cap              | code |
| writes and read-back                            | code |
| report                                          | code |

The judgement (`claude -p`) is the step's only LLM work, and the only part
expected to move: it is meant to be replaced by Jev (TypeSafe AI) once that
work lands, without touching the contract or threshold. In the report only
the tier changes: judged tasks and the step itself record `llm` today, and
the swap must change that too. The
command's own only LLM work is relaying the script's output.

## Versioning

Versions are driven by release-please from conventional commits scoped to this
plugin (`feat(autonomous): …`). A release bumps the version in
`.claude-plugin/plugin.json`, `package.json`, and this plugin's entry in the
root `.claude-plugin/marketplace.json`. Tags read `autonomous--v0.1.0`.
