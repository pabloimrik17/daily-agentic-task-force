## Why

The autonomous loop (Linear DOT-82) can only discover work it can recognise, and recognition runs on labels: which tasks an agent may take (`AFK`, `HITL`, `grill-me`) and whose they are (`work`, `personal` — Nazaries work has priority). Today that vocabulary is half-defined and mostly absent: Linear has `AFK`/`HITL` and no scope labels, Beads carries `AFK` on 60 of 504 open issues and scope only through legacy names (`nazaries`, `project:personal`), GitHub has nothing. Before a discovery step can exist, the labels must become a contract and the backlog must be brought under it. Refined with the user on 2026-09-26; this is the second slice after the quota gate.

## What Changes

- Add the **label contract**: two label groups every task must carry — scope (`work` | `personal`, exclusive) and entry (`AFK` | `HITL` | `grill-me`) — with one spelling, one meaning and one colour per label across Linear, Beads and GitHub; legacy labels recognised as aliases (evidence for a rule), never removed. Labels are never created by the loop on its own: a new `--bootstrap-labels` mode of `/autonomous:run` creates the missing ones, with colour where the tracker supports it, and exits.
- Add a **user-level configuration file** outside the plugin (the plugin ships the format and an example), validated strictly like the OpenUsage document: scope signals per source (alias and structural rules), the GitHub repo list, the Beads directory, the judgement model and effort, the confidence threshold, the per-run cap and batch size.
- Add the **`label-triage` step**, second in the run after `quota-gate`: reads the open issues of the three trackers through their CLIs (`bd`, `gh`, `linear`), reports every task missing a group, derives scope by deterministic rule and entry by an LLM judgement (`claude -p`, structured output, batched and capped), and writes the labels it is at least 95 % confident about — per group — only with the new `--apply` flag. Everything else is listed for the human. Writes are additive and read back. The step never blocks the run; an unreadable source makes the run `not-evaluable`.
- Extend the **run report** with the triage section (`Source → task → labels added → reason`, reason carrying tier and confidence, then the tasks the human is asked about) and, in JSON, the step's judgements so an error rate can be measured later without state.
- Document in the plugin README the new runtime requirements (`bd`, `gh`, `linear`, `claude`), the configuration file, the flags and the contract, and mark the `claude -p` judgement as the LLM tier to be replaced by Jev.

**Out of scope for this slice**: eligibility semantics and discovery of labelled work (next slice), the interactive `handoff` (the report is the only channel to the human), the Jev judgement (DOT-92 first), a creation-time labelling skill, lifecycle labels, the rename of Linear's `Grill Me` (a one-off by hand), and installing the Linear CLI (dotfiles, DOT-82 sub-issue 7).

## Capabilities

### New Capabilities

- `label-contract`: the shared label vocabulary — groups, spelling, meanings, colours, aliases and structural rules — the configuration that carries the per-user parts of it, and the bootstrap that creates missing labels on a tracker.
- `label-triage`: reading tasks from the three trackers, finding the ones missing a label group, deriving labels by rule and by judgement under a confidence threshold, writing them additively with read-back, and reporting.

### Modified Capabilities

- `autonomous-run`: a `--bootstrap-labels` mode that runs only the label bootstrap and exits, and an `--apply` flag that the runner passes to steps; without it no step writes to a tracker.

## Impact

- **New**: `plugins/autonomous/src/label-contract/` (contract table, configuration file parser, bootstrap) and `plugins/autonomous/src/label-triage/` (tracker readers and writers over `bd`, `gh`, `linear`; rules; judgement over `claude -p`; decision; render; tests), plus the criteria file the judgement prompt is built from.
- **Modified**: `src/args.ts` (`--apply`, `--bootstrap-labels`), `src/run.ts` and `src/runner.ts` (the run context carries the injected execs for `bd`, `gh`, `linear` and `claude`, and the loaded configuration), `commands/run.md` (argument hint), `README.md` of the plugin, `knip.config.ts` (`ignoreBinaries` gains `bd`, `gh`, `linear`, `claude`).
- **Runtime requirements on the consumer machine**: `bd` (verified against 1.3.0), `gh` (authenticated), `linear` (schpet/linear-cli, verified against 2.6.0, authenticated with `linear auth login`), `claude` (2.1.283 or later: `-p`, `--json-schema`, `--effort`), besides `bun` and `openusage`. Still no runtime dependencies: every CLI's output is validated by hand.
- **Side effects**: the first step that writes outside the machine. Only with `--apply`, only adding labels, never removing or replacing, no comments; `--bootstrap-labels` creates labels only. Both are explicit invocations; `/loop` passes `--apply` on purpose.
- **Quota**: the judgement runs on the active Claude account through the subscription, which the quota gate has already checked; `--account` must name that account.
- **Tracking**: Linear DOT-82, sub-issues 1 (contract) and 2 (triage step) — kept as sections of DOT-82 while the workspace cannot take new issues. Sub-issue 7 (Linear CLI in dotfiles) is a prerequisite for running against Linear.
