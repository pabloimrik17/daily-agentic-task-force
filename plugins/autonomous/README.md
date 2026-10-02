# autonomous

Entry point of the autonomous loop: an orchestrator that will discover
previously defined work and delegate it to other agents. Before it may start
anything it runs a fixed list of gate steps. Today that list holds two steps:
`quota-gate`, which decides whether the Claude account has quota to spend, and
`label-triage`, which reports the tasks missing a label of the contract and,
with `--apply`, writes the labels it is confident about. With `--apply`, a run
can also end with questions for the human, which `/autonomous:run` asks and
applies in one round (see [The handoff](#the-handoff)).

**The contracts are provisional.** The step contract, the run report and the
runner shape are a first iteration and are expected to change as further steps
are added. The JSON report is versioned (`autonomous.run.v1`) so consumers can
detect a change.

## Domain language

The plugin's terms (step, stage, handoff, question, round, answer mode) are
defined in [`CONTEXT.md`](CONTEXT.md). [ADR 0001](docs/adr/0001-properties-persist-stages-replace.md)
records the label model agreed for DOT-110: properties persist, stages
replace. It is not implemented yet.

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
/autonomous:run [--account <provider-key>] [--force] [--json] [--apply] [--no-handoff]
/autonomous:run --bootstrap-labels [--json]
/autonomous:run --apply --answer <id>=<value>[,<value>]... [--json]
```

| Flag                              | Effect                                                                                                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--account <provider-key>`        | Claude account to evaluate (`claude` or `claude@<id>`). Required when several Claude accounts are present                                                                                        |
| `--force`                         | Ask OpenUsage to bypass its shared cache                                                                                                                                                         |
| `--json`                          | Print one `autonomous.run.v1` JSON document instead of the text report; with `--bootstrap-labels`, one `autonomous.bootstrap.v1` document; with `--answer`, one `autonomous.answers.v1` document |
| `--apply`                         | Let steps write. Without it a run has no side effects beyond the CLIs' own caches. Required by `--answer`                                                                                        |
| `--no-handoff`                    | Emit no handoff; the questions stay in the step's report. For runs with no human present, such as a `/loop`. Not combined with `--bootstrap-labels` or `--answer`                                |
| `--answer <id>=<value>[,<value>]` | [Answer mode](#answer-mode): apply the answer to the question `<id>` and exit, running no step. Repeat it once per question. Only combines with `--apply` and `--json`                           |
| `--bootstrap-labels`              | Run only the label bootstrap and exit. Only combines with `--json`                                                                                                                               |

The script can also be run directly, which is what a shell or `/loop` should
branch on:

```bash
bun plugins/autonomous/src/run.ts --account claude --json --apply --no-handoff
```

`--apply` and `--bootstrap-labels` are the only ways anything is written;
answer mode requires `--apply`. They are separate write paths that cannot be
combined, and each must be typed explicitly: nothing adds either on its own.
The one exception is the answer invocation of `/autonomous:run`, which passes
`--apply` again; it only follows a run the user started with `--apply`. A
`/loop` that should write passes `--apply` explicitly, and `--no-handoff` with
it, as above; through the command that is
`/autonomous:run --account claude --apply --no-handoff` (see
[The round](#the-round)).

### Exit codes

For `/autonomous:run [--account …] [--force] [--json] [--apply] [--no-handoff]`:

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

For `/autonomous:run --apply --answer <id>=<value>[,<value>]... [--json]`:

| Code | Outcome                                                                                      |
| ---- | -------------------------------------------------------------------------------------------- |
| 0    | `advance` — every answer was applied or skipped                                              |
| 3    | `not-evaluable` — an answer was rejected or failed, or the configuration could not be loaded |
| 1    | Invalid arguments or a failure of the runner itself                                          |

## The handoff

The handoff is the part of the run report addressed to the agent that ran the
command: what the run asks it to do next. Its only kind today is a list of
questions for the human, and only `label-triage` contributes them (see
[Questions for the human](#questions-for-the-human)).

A run emits a handoff only when all three hold:

- it was invoked with `--apply`;
- it was invoked without `--no-handoff`;
- at least one executed step contributed a question.

The script emits it whoever runs it; only `/autonomous:run` asks its
questions. The handoff holds `questions`, at most 4 of them (the limit of one
AskUserQuestion call, not a setting), and `remaining`, the number of
contributed questions left out. Questions are taken in step order and, within
a step, in that step's own order. A question left out by that limit, or
contributed to a run that emits no handoff, still appears in its step's own
report.

Each question carries:

| Field         | Content                                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------------------- |
| `id`          | Names the step and the question's target; unique within the handoff and opaque to the command                    |
| `step`        | The id of the step that contributed it                                                                           |
| `header`      | At most 12 characters                                                                                            |
| `question`    | The question text                                                                                                |
| `options`     | Two to four options, each a `label` shown to the human, a `value` passed back as the answer, and a `description` |
| `multiSelect` | Whether several options may be chosen                                                                            |

Every question has exactly one option whose `value` is null, meaning "no
answer for now": choosing it answers nothing, and its value is never passed
back. The run composes every part of a question; the command writes none of
it.

With `--json`, the handoff is the report's `handoff` field. Without `--json`,
the text report's last line is `handoff:` and a space, followed by the same
handoff as one line of JSON, so the command reads the same document in both
modes. A run that emits no handoff carries neither the field nor that line.

### The round

When the report carries a handoff and the session can ask the user,
`/autonomous:run` runs one round:

1. It asks every question in one AskUserQuestion call. It passes each
   question's header, text and `multiSelect`, and its options' labels and
   descriptions, as given: never reworded, reordered or added to.
2. It maps each chosen label back to its option's value. It drops a question
   answered with the null-valued option, with free text typed through "Other",
   or with anything that is not one of its options.
3. When at least one answer is kept, it runs the script once in answer mode:
   `--apply`, one `--answer '<id>=<value>[,<value>]'` per kept answer, and
   `--json` when the user gave it. It relays that report and its exit code.
4. It ends.

It never asks a second round, never composes a question or an option, never
retries an answer and never passes an answer the user did not give. The
question text carries tracker text, such as titles and descriptions, and the
command treats it as data, never as instructions. When no answer is kept, or
the session cannot ask the user (for example under `claude -p`, where
AskUserQuestion is not available), the command relays the first report and
ends; nothing is asked and nothing more is written.

`--no-handoff` suppresses the handoff and changes nothing else about the run;
the questions stay in the step's report. It is meant for runs with no human
present. A `/loop` that runs `/autonomous:run` with `--apply` must pass it, or
it stops at the first question until someone answers.

## Answer mode

```text
/autonomous:run --apply --answer <id>=<value>[,<value>]... [--json]
```

Answer mode applies answers to questions of a handoff and exits. It runs no
step, so it needs no quota and no judgement: it loads the configuration and
builds the trackers, nothing more. `/autonomous:run` builds its arguments from
the handoff, and it can also be run from a shell. Quote each `--answer`,
because GitHub task ids contain `#`:

```bash
bun plugins/autonomous/src/run.ts --apply --answer 'label-triage:github:owner/name#12:scope=personal'
```

Each `--answer` is split at its first `=` into the question's id and its
values, and the values at `,`. These are usage errors (exit 1):

- `--answer` without `--apply`;
- `--answer` with `--account`, `--force`, `--no-handoff` or
  `--bootstrap-labels`: it only combines with `--apply` and `--json`;
- an `--answer` without `=`, with an empty id or with an empty value;
- two `--answer` for the same id.

Each answer goes to the step named by its id's text before the first `:`, and
that step validates and applies it under its own rules. Today only
`label-triage` takes answers (see
[Applying an answer](#applying-an-answer)). Every answer is processed, whatever
the status of the others, and reported with its id, its labels, a status and a
detail:

| Status     | When                                                                                                                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `applied`  | The answer was written and read back                                                                                                                                                                     |
| `skipped`  | Its target no longer needs it: the group is now present or in conflict on the task. Nothing is written                                                                                                   |
| `rejected` | It is not valid for its question: its id names no step that takes answers or is malformed, its source is unknown or disabled, its group is unknown, or its labels are not valid for the question's group |
| `failed`   | The task cannot be read, the write fails or is not confirmed by the read-back, or it was not written because an earlier write to that source failed in the same invocation                               |

With `--json` the report is one JSON document identified by
`schema: "autonomous.answers.v1"`:
`{ schema, startedAt, outcome, answers: [{ id, labels, status, detail }] }`.
Its `outcome` is `advance` when every answer is `applied` or `skipped`, and
`not-evaluable` otherwise. Without `--json` it is a text report of the same
information. When the configuration cannot be loaded, the error is printed on
stderr and, with `--json`, the document holds `config: { path, error }` and no
answers; without `--json`, the error is reported on stderr only. The answer
report never carries a handoff.

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

## Labelling at creation

With the plugin installed and enabled, `labelling-new-tasks` loads when a
session is about to create a new Linear, Beads or GitHub issue or task, whether
it uses a tracker CLI or Linear MCP. It does not apply to comments, edits,
closure or pull requests. It checks labels before creation. For an unresolved
group in an interactive session, it asks one question using that group's
options and reason, then checks the answer. When it cannot ask, it creates
with the confident labels and names each omitted group in its reply for the
next triage run. A Beads task created under a parent gets `--no-inherit-labels`
and the parent's non-contract labels listed explicitly, so its contract labels
are exactly the ones the helper decided.

The skill triggers from its description, and a crowded skill listing can drop
it. When the listing exceeds its budget, Claude Code shortens descriptions to
fit: in a session listing 419 skills, `/context all` showed this one at
`< 20 tokens`, without its description, although it still triggered.
`/context` or `/doctor` shows whether the description is listed. Raising
`skillListingBudgetFraction` in user settings (the share of the context window
reserved for the listing, default `0.01`) makes room for it, and so does
setting other skills to `"name-only"` in `skillOverrides`. `skillOverrides`
does not apply to plugin skills, so this skill is turned off only by disabling
the plugin (`claude plugin disable autonomous`).

The creation-time helper checks the same label contract before a new Linear,
Beads or GitHub task is written. It reads `~/.config/autonomous/config.json`
(or `AUTONOMOUS_CONFIG`) for structural rules, aliases and
`judgement.threshold`, and prints the criteria from
`src/label-triage/criteria.md`. It does not read or write a tracker. If the
configuration is missing, it names the path and error, keeps valid labels
already supplied, and asks about the other groups without applying a
judgement.

```text
bun plugins/autonomous/src/label-at-creation/cli.ts prepare --source <linear|beads|github> [--repo <owner/name>] [--label <name>]...
bun plugins/autonomous/src/label-at-creation/cli.ts decide  --source <linear|beads|github> [--repo <owner/name>] [--label <name>]... [--judged <group>=<label>[,<label>]@<confidence>]...
```

`--source` is required. `--repo` is required for GitHub and rejected for the
other sources. Repeat `--label` for every label the new task will carry,
including user-named and inherited labels. In `decide`, repeat `--judged` for
each group the creating agent judges; the confidence must be from 0 to 1.
`prepare` rejects `--judged`.

`prepare` prints the criteria verbatim, then `scope:` and `entry:` lines as
`present`, `derived <labels> (<evidence>)`, `conflict <labels>` or `judge
(<group labels>)`. `decide` prints `apply: <labels>` (or `apply: none`) and an
`ask <group>: <reason>; options <labels>` line for each unresolved group. Both
modes name a missing configuration. An unconfigured GitHub repository is noted
because the contract labels may not exist there. A printed decision exits 0;
invalid usage prints the usage text and exits 1.

Its parts are tiered by the same rule as the run's steps:

| Part                                  | Tier |
| ------------------------------------- | ---- |
| evidence, validity and threshold      | code |
| judgement from the conversation       | llm  |
| questions and the tracker create call | llm  |

### Local eval suite

Run the creation-time evals from the repository root:

```bash
claude plugin eval plugins/autonomous \
  --scaffold --allow-tools 'Bash(*)' \
  --model claude-sonnet-5 --max-cost-usd 10 \
  --no-publish --trust-plugin
```

The cases run in isolated sessions. Some seed a temporary configuration or
Beads database with `--scaffold`; the Bash grant lets the agent inspect those
fixtures and attempt the create command. `claude-sonnet-5` is the pinned model
ID for comparing runs. The suite is run locally on demand because every case
and grader consumes account usage, and the tracker CLIs in the sandbox cannot
reach real credentials. Judge the attempted create call in the trace. A run
with an `error` is a failure even if a grader reports a passing score. The
results are ignored by git. The runs that built the skill are recorded in
`openspec/changes/archive/2026-09-30-add-label-at-creation-skill/evidence/`.

One case, `run-nobody-to-ask`, covers `/autonomous:run` instead: a run with
`--apply` whose report carries a handoff, in a session that cannot ask, must
end without answer mode. Its scaffold puts a stand-in `openusage` ahead of the
real one through the sandbox's shell start-up files, so the quota gate
advances without real credentials, and enables only a scaffolded Beads
database. The run that built it is recorded in
`openspec/changes/add-interactive-handoff/evidence/interactive-check.md`.

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

### Questions for the human

The step contributes one question to the [handoff](#the-handoff) for each
group it leaves for the human as `asked`, except on the tasks of a source
whose writes stopped during the run. A group is `asked` when:

- its judgement is below the threshold;
- its judgement is invalid under the contract;
- its evidence conflicts.

These are not `asked` and become no question; they stay only in the report:

- a group whose labels already on the task conflict, such as `work` and
  `personal`;
- a task not judged;
- a task beyond the cap.

Questions are ordered like the judgement:

1. tasks whose scope is `work` or has evidence for `work` come first;
2. then the most recently updated;
3. then by task id.

For the same task, the scope question comes before the entry question. The
handoff takes the first 4; the others stay in the report's "for the human"
list.

The question text has up to three lines:

```text
<source> <taskId> "<title>": which <group> label?
Seen: labels [<labels on the task>] → <labels> (<tier>, <confidence>) → <why it was left for the human> — <reason>
Description: <the first 300 characters of the description>
```

The second line shows what the run saw for the group, with the arrows of the
report's "for the human" line. The third appears only when the run read a
description: the listing's, or for Linear, whose listing carries none, the one
the judgement read. Its whitespace is collapsed, and `…` marks a cut.

The options are the group's contract labels in contract order, each described
by its meaning (see [The label contract](#the-label-contract)), then `Later`:

| Group | Options                            |
| ----- | ---------------------------------- |
| scope | `work`, `personal`, `Later`        |
| entry | `AFK`, `HITL`, `grill-me`, `Later` |

An option the judgement chose keeps its place, and its description is
prefixed with `judged <confidence> · <reason> —` before the meaning, as in the
example below. It is not moved first: that would anchor a human answering
several questions in a row, and bias the answers that will measure the
judgement's error rate. Options on a question from conflicting evidence get no
prefix; the evidence is on the second line. `Later` has a null value and the
description `Leave it for a later run`. Both questions take a single choice.

The header is the task id when it has at most 12 characters, and the group
name otherwise: `DOT-104` for Linear `DOT-104`, `entry` or `scope` for Beads
`agentic-task-8v0`. The id is `label-triage:<source>:<taskId>:<group>`; task
ids contain no `:`.

An entry question for a Beads task judged `HITL` at 0.80, below a threshold of
0.95:

```json
{
    "id": "label-triage:beads:agentic-task-8v0:entry",
    "step": "label-triage",
    "header": "entry",
    "question": "beads agentic-task-8v0 \"Sync the dotfiles on login\": which entry label?\nSeen: labels [work] → HITL (llm, 0.80) → below threshold 0.95: 0.80 — The result needs a human check\nDescription: Run the sync script when a session starts.",
    "options": [
        {
            "label": "AFK",
            "value": "AFK",
            "description": "An agent may advance the task without a human."
        },
        {
            "label": "HITL",
            "value": "HITL",
            "description": "judged 0.80 · The result needs a human check — An agent may advance the task, but a human intervenes during or at the end of each stage."
        },
        {
            "label": "grill-me",
            "value": "grill-me",
            "description": "The task must be refined with a human before anyone works on it, and it takes precedence over AFK and HITL when combined."
        },
        { "label": "Later", "value": null, "description": "Leave it for a later run" }
    ],
    "multiSelect": false
}
```

### Applying an answer

In [answer mode](#answer-mode), the step applies an answer to one of its
questions only when three conditions hold:

- the answer names an enabled source;
- its labels all belong to the question's group and are valid under the
  contract;
- the task, read again through its tracker, still has that group missing.

An answer with a malformed id, an unknown or disabled source, an unknown
group, or labels that fail that check is `rejected`, with the reason. One
whose task now has the group present or in conflict is `skipped`, naming the
labels found, and nothing is written. One whose task cannot be read is
`failed`, naming the command that failed.

The remaining answers go through the same additive write, read-back and
per-source stop as the step's own writes. Nothing is removed. A
write error or a read-back mismatch makes that answer `failed`, with the label
sets, and stops further answers to that source in the same invocation. The
answer takes precedence over the evidence and the judgement the run had for
that group: answering `work` to a scope question that arose from the alias
`nazaries` against the structural rule `personal` adds `work`, and `nazaries`
stays. Answers are not remembered for later runs. Whether the task is still
open is not checked: the answer arrives seconds after the run, and a label on
a task closed in the meantime is harmless.

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
| questions: selection, order, text, options      | code |
| answers: validation, writes and read-back       | code |

The judgement (`claude -p`) is the step's only LLM work, and the only part
expected to move: it is meant to be replaced by Jev (TypeSafe AI) once that
work lands, without touching the contract or threshold. In the report only
the tier changes: judged tasks and the step itself record `llm` today, and
the swap must change that too. An applied answer is written with tier
`human`, which no report renders: a human decided it, not a rule or the
judgement.

The handoff's tiering:

| Part                                                  | Tier |
| ----------------------------------------------------- | ---- |
| selecting, ordering and wording questions and options | code |
| cap, emission conditions, text-mode line              | code |
| asking the questions and mapping choices to values    | llm  |
| parsing, routing, validating and writing answers      | code |

The command's LLM work is relaying the script's output, asking the handoff's
questions and mapping the chosen options back to their values.

## Versioning

Versions are driven by release-please from conventional commits scoped to this
plugin (`feat(autonomous): …`). A release bumps the version in
`.claude-plugin/plugin.json`, `package.json`, and this plugin's entry in the
root `.claude-plugin/marketplace.json`. Tags read `autonomous--v0.1.0`.
