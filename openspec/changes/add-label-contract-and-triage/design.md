> **Provisional, like the first iteration.** The step contract, run context and report shape change here as the quota gate's design said they would (DOT-82). Prefer changing them again over working around them.

## Context

See proposal.md for motivation. What shapes the approach:

- **The runner today** (`src/runner.ts`, `src/run.ts`): steps receive `{ args, now, io: { openUsage } }`; the run stops at the first non-`advance`; the report is `autonomous.run.v1` with one entry per executed step; there is no write path and no configuration. Everything is code tier.
- **Plugins install without dependencies** and the OpenUsage JSON is validated by a hand-written parser (quota-gate design D4). The same holds for every new input.
- **State of the trackers on 2026-09-26**: Linear has `AFK`, `HITL`, `Grill Me`, no scope labels, ≈80 open issues without an entry label; Beads has 504 open issues, `AFK` on 60, `human` on 3, scope only as `nazaries` (399), `project:personal` (15), `personal-side` (1); GitHub has 13 open issues in three repos, 11 unlabelled. The whole Linear workspace and every GitHub repo are personal; Nazaries work lives only in Beads.
- **CLIs verified**: `bd` 1.3.0 (`list --json`, `label add`, `-C <dir>`); `gh` (`issue list --json`, `issue edit --add-label`, `label create --color`), authenticated through its keyring; schpet/linear-cli 2.6.0 (`issue query --all-teams --json`, `issue update --add-label`, `label list --json`, `label create -n -c`), credentials in the macOS keychain via `linear auth login`, or `LINEAR_API_KEY`; `claude` 2.1.283 (`-p`, `--model`, `--effort`, `--json-schema`, `--output-format json`). No official Linear CLI exists.
- **Decisions taken with the user** are recorded in DOT-82 (sections "Sub-issue 1" and "Sub-issue 2"); this document explains how they are implemented, not why they were taken.

## Goals / Non-Goals

**Goals:**

- Every read and every write goes through an injected exec, so the whole step is testable with synthetic CLI output, including the LLM judgement.
- Fail closed on reading; degrade visibly on judging; never lose a label on writing.
- Keep the judgement swappable for Jev without touching contract, threshold or report.

**Non-Goals:**

- A general tracker adapter framework: three small modules with the same shape are enough.
- Persisting anything between runs, or interpreting the report in the command.
- Deciding eligibility from the labels (next slice).

## Decisions

### D1 — Two capabilities, one change

`label-contract` (vocabulary, configuration, bootstrap) and `label-triage` (reading, deriving, writing, reporting) are separate specs because they change for different reasons: the vocabulary will grow with lifecycle labels; the step will gain Jev and the interactive handoff. They ship as one change because the contract alone has nothing that exercises it end to end.

### D2 — Every source through its CLI, one module per tracker

`src/label-triage/trackers/{beads,github,linear}.ts` each export the same small shape: `listTasks()`, `listLabels()`, `addLabel(id, label)`, `readTask(id)`, `createLabel(name, colour)` — built on an injected `exec(args)` like `execOpenUsage`, with the same 120 s timeout, `ENOENT` and non-zero handling, and a strict parser for each command's JSON that keeps only the fields used (id, title, description, labels, state, updated time). Tracker-specific facts stay inside the module: Linear's `--all-teams` and workspace-level labels, GitHub's per-repo labels and `--repo`, Beads' `-C <dir>` and the absence of label objects. The parsers are versioned by the CLI version they were verified against, as OpenUsage is.

**Alternatives rejected**: Linear over GraphQL with `fetch` — kept as the documented fallback if `linear issue query --json` turns out not to carry labels, since it needs no dependency; Linear over MCP — not reachable from the script and not reproducible. A generic `Tracker` registry — the three modules are listed in one array in the step.

### D3 — Configuration file, strict parser shared with OpenUsage

`autonomous.config.v1` at `~/.config/autonomous/config.json` (override: `AUTONOMOUS_CONFIG`, mainly for tests and machines with several roles). Shape:

```jsonc
{
  "schema": "autonomous.config.v1",
  "sources": {
    "linear": { "enabled": true, "scope": "personal", "aliases": { "grill-me": ["Grill Me"] } },
    "beads":  { "enabled": true, "directory": "/path/to/repo", "aliases": { "work": ["nazaries", "project:example"], "personal": ["project:personal"], "HITL": ["human"] } },
    "github": { "enabled": true, "repos": ["pabloimrik17/monolab"], "scope": "personal" }
  },
  "judgement": { "model": "claude-sonnet-5", "effort": "medium", "threshold": 0.95, "cap": 25, "batch": 20 }
}
```

`scope` on a source is the structural rule; `aliases` map a contract label to the source's legacy names. Unknown fields are rejected, so a typo cannot silently disable a rule. The primitive validators of `quota-gate/parse.ts` (`object`, `string`, `number`, `boolean`, path-carrying errors) move to `src/validate.ts` and both parsers use them; quota-gate tests keep passing unchanged. The example file ships at `plugins/autonomous/config.example.json` and the README points to it. **Alternative rejected**: the tables inside the plugin — they name clients and projects and the repo is public.

### D4 — The judgement: `claude -p` behind an injected exec, Jev next

Tiering for this step:

| Part                                   | Tier |
| -------------------------------------- | ---- |
| read and validate the three sources    | code |
| detect missing groups and conflicts    | code |
| scope and entry by rule (evidence)     | code |
| entry (and scope without evidence) by judgement | llm  |
| threshold, validity, ordering, cap     | code |
| writes and read-back                   | code |
| report                                 | code |

The judgement is `claude -p --model <m> --effort <e> --output-format json --json-schema <schema>` with a prompt built from `src/label-triage/criteria.md` (the contract's meanings, in the words the future creation-time skill will reuse) plus a batch of tasks. The schema returns, per task id, per group: `labels`, `confidence`, `reason`. The envelope of `--output-format json` and the structured payload are both validated strictly; a task missing from the answer, or given a label outside the vocabulary, is reported as not judged. The exec is `JudgementExec = (batch) => Promise<Result>` and is the only thing the Jev sub-issue replaces. Timeout 300 s per batch. `claude -p` uses the active account and the subscription: the README states `--account` must be that account.

**Alternatives rejected**: Jev now — blocked on DOT-92 and on a bundling step the plugin does not have; judging in the command — puts control flow in the LLM and needs a multi-pass protocol, which is exactly what the reserved `handoff` will be designed for later.

### D5 — Threshold, validity and ordering in code

Rules yield confidence 1. A group is written when `confidence ≥ threshold` **and** the labels are valid under the contract (the validity check runs after the judgement, so a confident-but-invalid answer becomes a question, never a write). Groups are independent. Ordering for the cap: tasks with `work` evidence first, then by the tracker's updated time descending; deterministic for a given input so the report is reproducible.

### D6 — Writes: additive, read back, stop per source on mismatch

`--apply` travels in `RunArgs` and `RunContext`. A write is one `addLabel` per label; then `readTask` and a superset check against the labels seen before the write plus the added ones. The first mismatch on a source stops writes to that source for the run — the cheapest protection against a CLI that replaces label sets — and is reported with both sets. Rule-derived writes are uncapped; on the first `--apply` this adds `work` to ≈400 Beads issues and `personal` to ≈90 Linear/GitHub issues, which is the intended one-off clean-up. No comments, no removals, ever.

### D7 — Reading fails closed, judging degrades

An unreadable source makes the step `not-evaluable`, as the quota gate does with OpenUsage: a run that silently skipped Beads would hide the Nazaries backlog, which has priority. A failed judgement only removes the LLM's contribution: the report still lists what the rules found and what the human must decide, and the outcome stays `advance`. The step never returns `wait`.

### D8 — Report and run context

`RunContext.io` becomes `{ openUsage, trackers: { beads, github, linear }, judgement }` plus `config` (loaded once in `run.ts`, `null` when absent so the quota gate keeps working without a file and the triage step reports the missing file). The report schema stays `autonomous.run.v1`: a new entry in `steps[]` with its own `data` is additive. `handoff` remains reserved and unemitted. Step id: `label-triage`; order: after `quota-gate`.

### D9 — Bootstrap is a mode, not a step

`--bootstrap-labels` short-circuits in `run.ts` before the steps: it needs the configuration and the tracker modules but none of the step machinery, and it must not be gated by quota. It processes every enabled source even when one fails (the opposite of the step's reading rule) because creating labels on Linear is useful even while `gh` is logged out. Exit codes reuse the outcome mapping (0 / 3 / 1).

### D10 — Layout

```text
plugins/autonomous/
  config.example.json                    # autonomous.config.v1 example
  src/validate.ts                        # primitives shared by both parsers
  src/config.ts                          # config path, strict parser
  src/label-contract/contract.ts         # labels, groups, colours, meanings
  src/label-contract/detect.ts           # presence, missing, conflict per group
  src/label-contract/bootstrap.ts        # --bootstrap-labels
  src/label-triage/trackers/{beads,github,linear}.ts
  src/label-triage/rules.ts              # evidence → derived group (tier code)
  src/label-triage/judgement.ts          # claude -p exec, schema, strict parse
  src/label-triage/criteria.md           # meanings for the prompt (and the future skill)
  src/label-triage/decide.ts             # threshold, validity, ordering, cap
  src/label-triage/write.ts              # additive write + read-back
  src/label-triage/render.ts
  src/label-triage/step.ts
  src/**/*.test.ts
```

## Risks / Trade-offs

- [schpet/linear-cli has almost no automated tests] → strict parsing against 2.6.0, additive commands only, read-back with stop-on-mismatch; GraphQL fallback documented.
- [`linear issue query --json` may not include labels] → verified first in the dotfiles sub-issue; fallback is the GraphQL module behind the same tracker shape.
- [LLM confidence is self-reported] → recorded per judgement in the JSON; `AFK` always shown with confidence; threshold and model are configuration; Jev replacement planned.
- [`claude -p` runs on the active account, not `--account`] → documented requirement; `claude-swap` integration stays deferred.
- [Bun loses a child's exit notification (oven-sh/bun#41024, #34069; seen on 1.3.14 during the first `--apply`, reported up to 1.4.x): `execFile` never calls back and its own timeout cannot end the call] → `execCommand` carries a watchdog at the timeout plus 5 s that kills the child and settles the call as a timeout, so the 120 s bound holds and a write stops only its source.
- [Keychain or `gh` auth unavailable in a headless `/loop`] → surfaces as `not-evaluable` naming the login command; nothing is guessed.
- [First `--apply` touches ≈500 issues] → rule writes are deterministic and reversible by hand; judged writes are capped; run without `--apply` first and read the report.
- [Configuration drifts between machines] → strict validation with paths; the example file is the reference.
- [Four more binaries the repo tooling does not know] → `knip.config.ts` `ignoreBinaries` gains `bd`, `gh`, `linear`, `claude`.

## Migration Plan

Additive. New flags, a new step and a configuration file. Without the file the quota gate behaves as today and the triage step reports the missing file as `not-evaluable`; creating the file from the example and running `--bootstrap-labels` once completes the setup. Rollback: remove `labelTriageStep` from `STEPS` in `run.ts`; nothing written to the trackers needs undoing, since only labels were added.

## Open Questions

- The exact JSON envelope `claude -p --output-format json` wraps around a `--json-schema` answer in 2.1.283: verified at implementation; the parser is strict either way.
- Whether `linear label create` without `--team` creates a workspace label in 2.6.0, or needs an explicit workspace flag: verified in the dotfiles sub-issue.
