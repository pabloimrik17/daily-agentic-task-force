# autonomous

Entry point of the autonomous loop: an orchestrator that discovers previously
defined work and delegates it to other agents. It runs a fixed list of five
steps, in this order:

1. `reconcile` brings the attempts of earlier runs up to date: it resolves,
   observes, finalises or retains each one (see
   [The `reconcile` step](#the-reconcile-step)).
2. `quota-gate` decides whether the Claude account has quota to spend.
3. `label-triage` reports the tasks missing a label of the contract and, with
   `--apply`, writes the labels it is confident about.
4. `select` chooses the next work unit and explains the choice (see
   [The `select` step](#the-select-step)).
5. `launch` starts one managed session for the selected unit (see
   [The `launch` step](#the-launch-step)).

With `--apply`, a run can also end with questions for the human, which
`/autonomous:run` asks and applies in one round (see
[The handoff](#the-handoff)). `--apply` can now also create sessions and
worktrees and write the `taken` label. A separate mode, `--transition`, runs no
step: it reads a task in `grill-me` and hands off the question that moves it to
`proposal` (see [Transition mode](#transition-mode)).

**The contracts are provisional.** The step contract, the run report and the
runner shape are a first iteration and are expected to change as further steps
are added. The JSON report is versioned (`autonomous.run.v2`) so consumers can
detect a change: version 2 names the label groups `scope`, `autonomy` and
`stage` in the triage and selection data.

## Domain language

The plugin's terms (step, stage, work unit, machine scope, taken task,
candidate, attempt, managed session, stage contract, workspace, result marker,
retained attempt, pending cleanup, run lock, handoff, question, round, answer
mode) are defined in [`GLOSSARY.md`](GLOSSARY.md).
[ADR 0001](docs/adr/0001-properties-persist-stages-replace.md) records the
label model of DOT-110: properties persist, stages replace. The
[label contract](#the-label-contract) implements it; the grill-me stage that
uses it is change 2 of DOT-110 and is not implemented yet.
[ADR 0002](docs/adr/0002-remove-taken-on-finalisation.md) records why the
runner removes `taken` when an attempt is finalised or discarded.
[ADR 0003](docs/adr/0003-optional-config-blocks-with-shipped-defaults.md)
records why the new configuration blocks are optional and the old ones are not.

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
- [`chezmoi`](https://www.chezmoi.io) on `PATH`. The `select` step reads the
  machine scope from `chezmoi data`; without it, that step is `not-evaluable`.
- [`claude`](https://claude.com/product/claude-code) 2.1.283 or later, for
  `-p`, `--model`, `--effort`, `--output-format json`, `--json-schema`,
  `--safe-mode`, `--tools`, `--strict-mcp-config` and
  `--no-session-persistence`.
- `aoe` (Agent of Empires) on `PATH`, verified against 1.14.0. It creates,
  observes and removes the managed sessions.
- `wt` (worktrunk) on `PATH`, verified against 0.77.0. It prepares and
  releases the workspaces.

`aoe` and `wt` are needed only when a run reaches `reconcile` with attempts to
observe, or `launch` with something to launch. With no attempt on disk and
nothing selected, neither is called.

Every CLI's output is validated by hand; there are still no runtime
dependencies. Each call is bounded by a 120 s timeout, except the LLM
judgement batch and the LLM comparison of the `select` step, which allow
300 s, and the session naming of `launch`, which allows 10 s. Preparing a
workspace is bounded by 120 s. A call that exceeds its limit counts as failed.
A missing CLI is installed through the user's dotfiles (`BREW_PACKAGES`);
adding the Linear CLI there is tracked as DOT-82 sub-issue 7.

## Usage

```text
/autonomous:run [--account <provider-key>] [--force] [--json] [--apply] [--no-handoff]
/autonomous:run --task <source>:<id> [--stage <stage>] [--account <provider-key>] [--force] [--json] [--apply] [--no-handoff]
/autonomous:run --bootstrap-labels [--json]
/autonomous:run --apply --answer <id>=<value>[,<value>]... [--json]
/autonomous:run --apply --discard <attempt-id|source:id> [--release-workspace] [--json]
/autonomous:run --apply --transition <source>:<task> [--json]
```

| Flag                                | Effect                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--account <provider-key>`          | Claude account to evaluate (`claude` or `claude@<id>`). Required when several Claude accounts are present                                                                                                                                                                                                                                                                                                       |
| `--force`                           | Ask OpenUsage to bypass its shared cache                                                                                                                                                                                                                                                                                                                                                                        |
| `--json`                            | Print one `autonomous.run.v2` JSON document instead of the text report; with `--bootstrap-labels`, one `autonomous.bootstrap.v1` document; with `--answer`, one `autonomous.answers.v1` document; with `--discard`, one `autonomous.discard.v1` document; with `--transition`, one `autonomous.transition.v1` document                                                                                          |
| `--apply`                           | Let steps write. Without it a run has no side effects beyond the CLIs' own caches and the run lock. Required by `--answer`, `--discard` and `--transition`                                                                                                                                                                                                                                                      |
| `--no-handoff`                      | Emit no handoff; the questions stay in the step's report. For runs with no human present, such as a `/loop`. Not combined with `--bootstrap-labels`, `--answer` or `--transition`                                                                                                                                                                                                                               |
| `--answer <id>=<value>[,<value>]`   | [Answer mode](#answer-mode): apply the answer to the question `<id>` and exit, running no step. Repeat it once per question. Only combines with `--apply` and `--json`                                                                                                                                                                                                                                          |
| `--bootstrap-labels`                | Run only the label bootstrap and exit. Only combines with `--json`                                                                                                                                                                                                                                                                                                                                              |
| `--task <source>:<id>`              | Give that task to `launch` instead of running `label-triage` and `select`. `<source>` is `linear`, `beads` or `github`, split at the first `:`. Given once. Not combined with `--bootstrap-labels`, `--answer`, `--discard` or `--transition`. See [The supplied task](#the-supplied-task)                                                                                                                      |
| `--stage <stage>`                   | The stage `launch` runs for the supplied task. Requires `--task`. Given once. Its name is checked when the arguments are parsed: a stage that is not registered is a usage error (exit 1) that names the registered stages                                                                                                                                                                                      |
| `--discard <attempt-id\|source:id>` | [Discard mode](#discard-mode): discard that attempt, or the one open attempt of that task, and exit, running no step. Requires `--apply`. Only combines with `--apply`, `--json` and `--release-workspace`. Given once                                                                                                                                                                                          |
| `--release-workspace`               | With `--discard`, also release the attempt's worktree. Requires `--discard`                                                                                                                                                                                                                                                                                                                                     |
| `--transition <source>:<task>`      | [Transition mode](#transition-mode): read the task, which must carry `grill-me`, and hand off the question that moves it to `proposal`, running no step. `<source>` is `linear`, `beads` or `github`, split at the first `:`. Requires `--apply`. Only combines with `--apply` and `--json`. Given once. Not combined with `--no-handoff`, `--answer`, `--task`, `--stage`, `--discard` or `--bootstrap-labels` |

The script can also be run directly, which is what a shell or `/loop` should
branch on:

```bash
bun plugins/autonomous/src/run.ts --account claude --json --apply --no-handoff
```

`--apply` and `--bootstrap-labels` are the only ways anything is written;
answer mode, discard mode and transition mode require `--apply`. They are
separate write paths that cannot be combined, and each must be typed
explicitly: nothing adds either on its own. With `--apply`, `reconcile` and
`launch` write attempt records, sessions, worktrees and the `taken` label.
The one exception is the answer invocation of `/autonomous:run`, which passes
`--apply` again; it only follows a run the user started with `--apply`. A
`/loop` that should write passes `--apply` explicitly, and `--no-handoff` with
it, as above; through the command that is
`/autonomous:run --account claude --apply --no-handoff` (see
[The round](#the-round)).

### Exit codes

For `/autonomous:run [--account …] [--force] [--json] [--apply] [--no-handoff]`:

| Code | Outcome                                                                                                                                                                                        |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | `advance` — every step advanced                                                                                                                                                                |
| 2    | `wait` — a step says to wait (for example, a window exhausted, or no task is selectable)                                                                                                       |
| 3    | `not-evaluable` — no decision possible: account absent, ambiguous or unknown, data missing, incomplete, invalid, outdated, stale or failed, or another run holds the [run lock](#the-run-lock) |
| 1    | Invalid arguments or a failure of the runner itself                                                                                                                                            |

The same codes apply with `--task`. A run that finds the lock held runs no
step: it prints a report with no steps, outcome `not-evaluable` and, after the
header, the line `lock: <error>` (in JSON, the report's `lock` field,
`{ "error": "<error>" }`), and exits 3.

For `/autonomous:run --bootstrap-labels [--json]`:

| Code | Outcome                                                                                                         |
| ---- | --------------------------------------------------------------------------------------------------------------- |
| 0    | Every label is present, was created or was recoloured on every enabled source                                   |
| 3    | The configuration could not be loaded, a source could not be evaluated, or a label failed to create or recolour |
| 1    | Invalid arguments or a failure of the runner itself                                                             |

For `/autonomous:run --apply --answer <id>=<value>[,<value>]... [--json]`:

| Code | Outcome                                                                                      |
| ---- | -------------------------------------------------------------------------------------------- |
| 0    | `advance` — every answer was applied or skipped                                              |
| 3    | `not-evaluable` — an answer was rejected or failed, or the configuration could not be loaded |
| 1    | Invalid arguments or a failure of the runner itself                                          |

For `/autonomous:run --apply --transition <source>:<task> [--json]`:

| Code | Outcome                                                                                                                                 |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | `advance` — the task is in `grill-me` and a handoff was emitted                                                                         |
| 3    | `not-evaluable` — the task is not in `grill-me`, its source is disabled, it could not be read, or the configuration could not be loaded |
| 1    | Invalid arguments or a failure of the runner itself                                                                                     |

For `/autonomous:run --apply --discard <attempt-id|source:id> [--release-workspace] [--json]`:

| Code | Outcome                                                                                                                                                   |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | `advance` — the attempt was discarded                                                                                                                     |
| 3    | `not-evaluable` — it could not be: the attempt was not found or is ambiguous, a removal failed, the configuration could not be loaded or the lock is held |
| 1    | Invalid arguments or a failure of the runner itself                                                                                                       |

## The handoff

The handoff is the part of the run report addressed to the agent that ran the
command: what the run asks it to do next. Its only kind today is a list of
questions for the human. `label-triage` contributes them (see
[Questions for the human](#questions-for-the-human)), and so does
[transition mode](#transition-mode), which emits a handoff with one question
through the same mechanism.

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

| Field         | Content                                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------------------------- |
| `id`          | Names the step, or the transition, and the question's target; unique within the handoff and opaque to the command |
| `step`        | The id of the step that contributed it, or `transition`                                                           |
| `header`      | At most 12 characters                                                                                             |
| `question`    | The question text                                                                                                 |
| `options`     | Two to four options, each a `label` shown to the human, a `value` passed back as the answer, and a `description`  |
| `multiSelect` | Whether several options may be chosen                                                                             |

Every question has exactly one option whose `value` is null, meaning "no
answer for now": choosing it answers nothing, and its value is never passed
back. The run composes every part of a question; the command writes none of
it.

With `--json`, the handoff is the report's `handoff` field. Without `--json`,
the text report's last line is `handoff:` and a space, followed by the same
handoff as one line of JSON, so the command reads the same document in both
modes. A run that emits no handoff carries neither the field nor that line.
Transition mode renders its handoff with the same functions, so the command
reads its report exactly like a run report.

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
- `--answer` with `--account`, `--force`, `--no-handoff`,
  `--bootstrap-labels` or `--transition`: it only combines with `--apply` and
  `--json`;
- an `--answer` without `=`, with an empty id or with an empty value;
- two `--answer` for the same id.

Each answer goes to the step or the transition named by its id's text before
the first `:`, and that step or the transition validates and applies it under
its own rules. Two take answers: the `label-triage` step (see
[Applying an answer](#applying-an-answer)) and the transition, whose ids start
with `transition:` (see [The transition answer](#the-transition-answer)). An
answer whose id names neither is `rejected` with the detail
`no step <name> takes answers`, as in `no step foo takes answers` for the id
`foo:x`. Every answer is processed, whatever the status of the others, and
reported with its id, its labels, a status and a detail:

| Status     | When                                                                                                                                                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `applied`  | The answer was written and read back                                                                                                                                                                                   |
| `skipped`  | Its target no longer needs it: the group is now present or in conflict on the task, a `grill-me` answer finds a stage label, or a transition answer finds the task no longer in `grill-me`. Nothing is written         |
| `rejected` | It is not valid for its question: its id names no step or transition that takes answers or is malformed, its source is unknown or disabled, its group is unknown, or its labels are not valid for the question's group |
| `failed`   | The task cannot be read, the tracker lacks a label to write, the write fails or is not confirmed by the read-back, or it was not written because an earlier write to that source failed in the same invocation         |

With `--json` the report is one JSON document identified by
`schema: "autonomous.answers.v1"`:
`{ schema, startedAt, outcome, answers: [{ id, labels, status, detail }] }`.
Its `outcome` is `advance` when every answer is `applied` or `skipped`, and
`not-evaluable` otherwise. Without `--json` it is a text report of the same
information. When the configuration cannot be loaded, the error is printed on
stderr and, with `--json`, the document holds `config: { path, error }` and no
answers; without `--json`, the error is reported on stderr only. The answer
report never carries a handoff.

## Transition mode

```text
/autonomous:run --apply --transition <source>:<task> [--json]
```

A grill ends by moving its task from `grill-me` to `proposal`, on a human's
answer. Transition mode starts that move: it reads the task and hands off one
question, the task's autonomy. It runs no step, so it needs no quota and no
judgement, and it takes no [run lock](#the-run-lock): it writes labels, not
attempts. The answer comes back through [answer mode](#answer-mode), which does
the writing (see [The transition answer](#the-transition-answer)). The grill
stage, change 2 of DOT-110, runs it at its end; it can also be run by hand. It
reads labels only: it does not check that a grill took place.

`<source>` is `linear`, `beads` or `github`, split at the first `:`. These are
usage errors (exit 1):

- `--transition` without `--apply`;
- `--transition` with any flag other than `--apply` and `--json`;
- a value without `:` or with an unknown source;
- `--transition` given twice.

`/autonomous:run` relays the report's handoff exactly like a run report's, asks
the question and runs answer mode once with the answer, so
`/autonomous:run --apply --transition <source>:<task>` moves a task in one
round (see [The round](#the-round)). From a shell, quote the answer, because
GitHub task ids contain `#`:

```bash
bun plugins/autonomous/src/run.ts --apply --transition linear:DOT-110
bun plugins/autonomous/src/run.ts --apply --answer 'transition:linear:DOT-110=AFK'
```

### The transition report

The report holds the start time, the outcome, the task (its source, id, title
and labels, or null when it was not read), the reasons and the handoff. The
outcome is `advance` exactly when a handoff is emitted, and `not-evaluable`
otherwise, with the reason:

| Reason                                                 | When                                      |
| ------------------------------------------------------ | ----------------------------------------- |
| `<source> is not enabled`                              | The source is disabled; no task is read   |
| The tracker's error                                    | The task cannot be read; the task is null |
| `<source> <id> is not in grill-me (labels [<labels>])` | The task does not carry `grill-me`        |

A task in `grill-me` has no reasons and one question in its handoff. A task
that is not in `grill-me`, from a disabled source or unreadable has no handoff.
The exit codes are in [Exit codes](#exit-codes). A configuration that cannot be
loaded is reported as in answer mode: the error is printed on stderr and, with
`--json`, the document holds `config: { path, error }`, a null task and no
reasons.

With `--json` the report is one document identified by
`schema: "autonomous.transition.v1"`. For a Linear task `DOT-110` carrying
`work`, `HITL` and `grill-me`:

```json
{
    "schema": "autonomous.transition.v1",
    "startedAt": "2026-11-01T09:00:00.000Z",
    "outcome": "advance",
    "task": {
        "source": "linear",
        "id": "DOT-110",
        "title": "Grill-me stage",
        "labels": ["work", "HITL", "grill-me"]
    },
    "reasons": [],
    "handoff": {
        "questions": [
            {
                "id": "transition:linear:DOT-110",
                "step": "transition",
                "header": "DOT-110",
                "question": "linear DOT-110 \"Grill-me stage\": the grill is over. Which autonomy does the task keep?\nLabels: [work, HITL, grill-me]",
                "options": [
                    {
                        "label": "AFK",
                        "value": "AFK",
                        "description": "An agent may advance the task without a human."
                    },
                    {
                        "label": "HITL",
                        "value": "HITL",
                        "description": "current · An agent may advance the task, but a human intervenes during or at the end of each stage."
                    },
                    {
                        "label": "Later",
                        "value": null,
                        "description": "Leave the task in grill-me"
                    }
                ],
                "multiSelect": false
            }
        ],
        "remaining": 0
    }
}
```

Without `--json` the same report is text and, when a handoff is emitted, its
last line is `handoff:` and a space followed by the handoff as one line of
JSON, as in a run report. Here that line is shortened:

```text
autonomous transition — started 2026-11-01T09:00:00.000Z
outcome: advance
task: linear DOT-110 → "Grill-me stage" → labels [work, HITL, grill-me]
handoff: {"questions":[{"id":"transition:linear:DOT-110","step":"transition", …}],"remaining":0}
```

For a task that is not in `grill-me`, the text report names the reason and
carries no handoff line:

```text
autonomous transition — started 2026-11-01T09:00:00.000Z
outcome: not-evaluable
task: linear DOT-110 → "Grill-me stage" → labels [personal, AFK, proposal]
reasons:
  - linear DOT-110 is not in grill-me (labels [personal, AFK, proposal])
```

### The transition question

The question has the id `transition:<source>:<task>`, the step `transition` and
a single choice. The task is everything after the second `:`; task ids contain
no `:`. The header is the task id when it has at most 12 characters, and
`autonomy` otherwise. The text has two lines:

```text
<source> <taskId> "<title>": the grill is over. Which autonomy does the task keep?
Labels: [<labels on the task>]
```

The options are `AFK` and `HITL`, each described by its meaning (see
[The label contract](#the-label-contract)), then `Later`. An option the task
already carries is prefixed with `current ·` in its description, so a task that
carries `HITL` shows `HITL` as current, and a task with no autonomy label shows
none. `Later` has a null value and the description `Leave the task in
grill-me`. The question never asks for scope: scope is a property, and the
grill does not change it.

### The transition answer

The answer is a single `AFK` or `HITL`, passed to answer mode as
`--apply --answer 'transition:<source>:<task>=<value>'`. The transition
validates it and reports one status for it:

| Status     | When                                                                                                                                                                        |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `applied`  | The transition was written and read back                                                                                                                                    |
| `skipped`  | The task, read again, no longer carries `grill-me`. Nothing is written                                                                                                      |
| `rejected` | The value is not a single `AFK` or `HITL`, the id is malformed, or the source is unknown or disabled                                                                        |
| `failed`   | The task cannot be read, the tracker lacks `proposal` or the answered autonomy (the detail names `--bootstrap-labels`; nothing is written), or a write or a read-back fails |

`Later` has a null value, which the command never passes back, so it writes
nothing and the task stays in `grill-me`.

The transition runs in phases, and reads the task back after each write phase:

1. **Check.** The tracker must have the answered autonomy and `proposal`, as in
   [Labels the tracker lacks](#labels-the-tracker-lacks): one listing, Linear
   in any scope, GitHub in the task's repository, Beads unchecked. This happens
   before any write.
2. **Add.** The answered autonomy and `proposal` are added, each only when the
   task lacks it. The task is read back and must hold exactly its earlier
   labels plus the added ones.
3. **Remove.** Every other autonomy label is removed, and then `grill-me`. The
   task is read back.
4. **Verify.** The final labels must equal the earlier labels, plus the added
   ones, minus the removed ones.

Labels are added before any is removed. The transition removes only the stage it
leaves, `grill-me`, and the autonomy labels the answer replaces. It never
removes scope, `taken`, an alias or any other label: a Beads task that carries
`nazaries`, `work` and `grill-me` ends with `nazaries`, `work`, the answered
autonomy and `proposal`. This is the first exception to the rule that the loop
never removes a label; the second is `taken`.

A transition cut short reports `failed` with the label sets. A failure while
adding removes nothing. `grill-me` is removed last, so a failure while removing
always leaves it on the task, possibly beside `proposal`, which the contract
reports as a stage conflict. Answering the transition again completes it: the
task still carries `grill-me`, so only the labels not yet added or removed are
written. An applied answer lists only what it did:

```text
autonomous answers — started 2026-11-01T09:00:00.000Z
outcome: advance
  applied   transition:linear:DOT-110 → AFK → added AFK, proposal, removed HITL, grill-me on linear DOT-110, read back
```

Answering a task that has moved on is `skipped`, with the detail
`already moved on: stage [proposal]`. A `grill-me` answer to the transition
question is `rejected`, with `invalid for the transition: expected one of AFK,
HITL`.

## Configuration

Per-user settings live outside the plugin, in one JSON file validated as
strictly as the OpenUsage document: a missing file, a missing required field,
a mistyped field or an unknown field is an error naming the path, never a
default. The one exception is the three [optional blocks](#optional-blocks)
below, whose missing keys take a shipped default. No credentials are stored in
it.

- Path: `~/.config/autonomous/config.json`, overridable with
  `AUTONOMOUS_CONFIG` (mainly for tests and machines with several roles).
- Schema: `autonomous.config.v1`.
- A missing file's error names the path and points to the example at
  `plugins/autonomous/config.example.json`.
- Without a configuration file the quota gate still runs, but a run it lets
  through then exits 3 (`not-evaluable`), because `label-triage` cannot be
  evaluated. This changes the outcome for users who ran only the quota gate.

```json
{
    "schema": "autonomous.config.v1",
    "sources": {
        "linear": {
            "enabled": true,
            "scope": "personal",
            "aliases": { "grill-me": ["Grill Me"] }
        },
        "beads": {
            "enabled": true,
            "directory": "/path/to/beads/repo",
            "aliases": {
                "work": ["project:example"],
                "personal": ["project:personal"],
                "HITL": ["human"]
            }
        },
        "github": {
            "enabled": true,
            "repos": ["owner/repo"],
            "scope": "personal"
        }
    },
    "judgement": {
        "model": "claude-sonnet-5",
        "effort": "medium",
        "threshold": 0.95,
        "cap": 25,
        "batch": 20
    },
    "selection": {
        "model": "sonnet",
        "effort": "high"
    },
    "sessions": {
        "tool": "claude",
        "profile": null,
        "binary": null
    },
    "workspace": {
        "root": "~/WebstormProjects"
    },
    "naming": {
        "model": "haiku",
        "effort": "low"
    }
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

`selection` configures the LLM comparison of the `select` step: `model` and
`effort` passed to `claude -p`. It is required. A configuration file without
it is rejected with the path `selection`, so a file written for an earlier
version must gain the block. The rejection also reaches the
[labelling at creation](#labelling-at-creation) helper: until the block is
there, tasks created through it get no alias or structural evidence and no
judged labels, and `/autonomous:run` is not evaluable.

### Optional blocks

`sessions`, `workspace` and `naming` are optional. The plugin ships
`plugins/autonomous/config.defaults.json`, and a key missing from the user's
file, or a whole missing block, takes the shipped value for that key. A
mistyped or unknown key is still an error naming its path, so a file written
for an earlier version keeps working unchanged. ADR 0003 records why these
blocks have defaults while `selection` stayed required. The shipped defaults:

| Key                | Default              | Meaning                                                                             |
| ------------------ | -------------------- | ----------------------------------------------------------------------------------- |
| `sessions.tool`    | `claude`             | The agent each session runs: `claude` or `codex`. Any other value is rejected       |
| `sessions.profile` | `null`               | The `aoe` profile passed to every `aoe` command; `null` leaves `aoe`'s default      |
| `sessions.binary`  | `null`               | The agent binary or wrapper, passed as `--cmd-override`; `null` uses the tool's own |
| `workspace.root`   | `~/WebstormProjects` | The directory whose git repositories a task is inferred against; `~` uses `HOME`    |
| `naming.model`     | `haiku`              | `--model` of the `claude -p` call that names a session                              |
| `naming.effort`    | `low`                | `--effort` of that call                                                             |

When a run used a default, the text report's header gains a third line,
`defaults: sessions.tool, naming.model`, listing the dotted keys in the order
of the table; with `--json` the report holds `config.defaulted`, the same list.
A run whose configuration sets every key shows neither.

## The label contract

Every task carries labels from three groups:

| Group    | Labels                 | Rule                                                                |
| -------- | ---------------------- | ------------------------------------------------------------------- |
| scope    | `work`, `personal`     | Exactly one. `work` is Nazaries work                                |
| autonomy | `AFK`, `HITL`          | Exactly one. It may be absent only while the stage is `grill-me`    |
| stage    | `grill-me`, `proposal` | Exactly one. Two stage labels are a conflict, for a human to settle |

Two labels of one group are a conflict, reported for a human to settle: neither
detection, triage nor the bootstrap removes or replaces either label. A task in
`grill-me` with no autonomy label is complete: the contract reports its autonomy
as deferred, because the grill decides it, and triage, selection and the
creation helper count a deferred autonomy as present. A task in `proposal` with
no autonomy label is missing its autonomy. `HITL` with `grill-me` is valid: the
autonomy was decided ahead of the grill.

Scope and autonomy are properties, kept for the whole life of a task. The stage
says where the task is, and a transition replaces it (see
[Transition mode](#transition-mode)).

`taken` belongs to no group. It is never required, never missing and never
in conflict, and triage neither derives it nor asks about it. The runner writes
it, at launch (see [The `taken` label](#the-taken-label)).

`personal` is the user's own work. No scope has priority over the other in the
contract: which scope to prefer is the job of the
[`select` step](#the-select-step), by machine. `AFK` means an agent may
advance the task without a human; `HITL` means an agent may advance it, but a
human intervenes during or at the end of each stage; `grill-me` means the task
must be refined with a human in a grill before anyone works on it, and its
autonomy, when it has one, is provisional until the grill confirms it.
`proposal` means the task is ready for proposal preparation, its autonomy
decided and any grill it needed over. `taken` means an agent or a person is
advancing the task now.

Add `taken` to a task you work on by hand. It is the only evidence that a task
is taken: a tracker status such as Beads `in_progress` does not count, so work
done by hand without `taken` can still be selected. A configuration that
declares aliases for `taken` is rejected. The runner adds and removes `taken`
only for the attempts it launches (see [The `taken` label](#the-taken-label));
`label-triage` never does, and a `taken` you added by hand stays until you
remove it.

The loop never removes a label, with two exceptions: a transition removes the
stage it leaves and the autonomy labels its answer replaces, and the runner
removes `taken`. Triage and its answers stay additive. Nothing removes an alias
or any other label outside the contract.

Spelling is exact and case-sensitive: `Grill Me` is not `grill-me`, and
`Proposal` is not `proposal`. Colours, applied where the tracker supports them:

| Label      | Colour    |
| ---------- | --------- |
| `AFK`      | `#5e6ad2` |
| `HITL`     | `#eb5757` |
| `grill-me` | `#f2994a` |
| `proposal` | `#bb87fc` |
| `work`     | `#2f80ed` |
| `personal` | `#27ae60` |
| `taken`    | `#95a2b3` |

The loop never creates labels on its own. `--bootstrap-labels` does, `proposal`
and `taken` included: at workspace level on Linear (a same-name label in any
team counts as present), per repo on GitHub, and not at all on Beads, where
labels exist only by use.

The bootstrap also recolours. It changes every same-name contract label whose
colour differs from the table, in each scope where it appears. On Linear that
is the workspace and every team that has the label, each recoloured and
reported as its own `recoloured` entry. On GitHub it is one scope per
configured repository. Linear is recoloured through `linear api` with the
`issueLabelUpdate` mutation, because `linear-cli` 2.6.0 has no label update;
GitHub through `gh label edit --color`. Beads has no colours. Each recoloured
label is reported with the status `recoloured`, which the text report prints as
`recoloured AFK (was #000000)`. A recolour that fails counts as failed, which
makes the bootstrap exit 3, and the other labels are still processed. The
bootstrap never touches a label outside the contract, and never renames or
deletes one. Its JSON report keeps the schema `autonomous.bootstrap.v1`:
`recoloured` is one more value of a label's `status`.
Legacy names configured as `aliases` are evidence for a rule and are never
removed.

## Labelling at creation

With the plugin installed and enabled, `labelling-new-tasks` loads when a
session is about to create a new Linear, Beads or GitHub issue or task, whether
it uses a tracker CLI or Linear MCP. It does not apply to comments, edits,
closure or pull requests. It checks labels before creation. For an unresolved
group in an interactive session, it asks one question using that group's
options and reason, then checks the answer. When it cannot ask, it creates
with the confident labels and names each omitted group in its reply for the
next triage run. It writes each contract label in its exact spelling (`work`,
`personal`, `AFK`, `HITL`, `grill-me`, `proposal`), so `afk` becomes `AFK` and
`Grill Me` becomes `grill-me`. A Beads task created under a parent gets
`--no-inherit-labels` and the parent's non-contract labels listed explicitly, so
its contract labels are exactly the ones the helper decided.

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
bun plugins/autonomous/src/label-at-creation/cli.ts decide  --source <linear|beads|github> [--repo <owner/name>] [--label <name>]... [--judged <scope|autonomy>=<label>[,<label>]@<confidence>]...
```

`--source` is required. `--repo` is required for GitHub and rejected for the
other sources. Repeat `--label` for every label the new task will carry,
including user-named and inherited labels. In `decide`, repeat `--judged` for
each group the creating agent judges, `scope` or `autonomy`: the stage is never
judged, because it follows the autonomy. The confidence must be from 0 to 1.
`prepare` rejects `--judged`.

`prepare` prints the criteria verbatim, then `scope:`, `autonomy:` and `stage:`
lines. The scope and autonomy lines read `present <labels>`,
`derived <labels> (<evidence>)`, `conflict <labels>` or
`judge (<group labels>)`. The autonomy to judge lists `AFK, HITL, grill-me` for
a task with no stage label, and the autonomy of a task that will carry
`grill-me` reads `not needed (grill-me)`. The stage line reads:

- `present <labels>`, when the task will carry a stage label;
- `conflict <labels>`, when it will carry two;
- `derived proposal (autonomy <label>)`, when the autonomy is present or
  derived;
- `derived grill-me (<evidence>)`, when an alias for `grill-me` decides the
  autonomy;
- `follows autonomy`, when the autonomy is still to be judged.

`decide` prints `apply: <labels>` (or `apply: none`) and an
`ask <group>: <reason>; options <labels>` line for each unresolved group. An
applied `AFK` or `HITL` brings `proposal` with it when the task carries no stage
label, and a `grill-me` judgement applies `grill-me` alone, with no autonomy
label. `grill-me` judged for a task that will carry a stage label is invalid, so
the autonomy is asked about. Both modes name a missing configuration. An
unconfigured GitHub repository is noted because the contract labels may not
exist there. A printed decision exits 0; invalid usage prints the usage text and
exits 1.

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
end without answer mode and with the relayed report as its last text. The
grader for that last part, `no-own-text`, fails in most runs (see the
evidence file). Its scaffold puts a stand-in `openusage` ahead of the
real one through the sandbox's shell start-up files, so the quota gate
advances without real credentials, and enables only a scaffolded Beads
database. The run that built it is recorded in
`openspec/changes/archive/2026-10-04-add-interactive-handoff/evidence/interactive-check.md`.

## The `label-triage` step

Third in the run, after `reconcile` and `quota-gate`. It reads the open tasks of every
enabled source — Linear across all teams except completed, canceled and
`Duplicate` issues, Beads issues that are `open` or `in_progress`, GitHub open
issues per configured repo — and reports every task missing a label group or
carrying a group conflict.

Each missing group is first derived by a deterministic rule from its evidence
(aliases, the source's structural `scope`), and a group whose evidence
conflicts is listed for a human. A group with no evidence — usually autonomy,
and scope on a source without a structural rule — is derived by an LLM
judgement, batched and capped, ordered with `work` evidence first and then by
most recently updated. Only a group at or above the
configured `threshold`, and valid under the contract, is written, and only
with `--apply`: writes are additive, read back to confirm, and a source stops
writing on the first mismatch — nothing is ever removed. An unreadable source
makes the whole run `not-evaluable`; a failed judgement only drops the LLM's
contribution, and the step itself never blocks the run (`advance`) —
everything else is still listed for a human.

The report carries, per source and group, counts and
`source → task → labels → reason` lines (whether applied or only proposed,
the tier, the confidence), the tasks left for a human, and any write failure.
The counts are keyed by group, `scope`, `autonomy` and `stage`, and each JSON
record names its group. A source's line in the reasons reads
`<source>: N read, N complete, N missing scope, N missing autonomy, N missing stage, N in conflict`.
A deferred autonomy counts as complete. The JSON form carries one record per
derived group with its status, so an error rate can be measured from reports
alone, with no other state kept between runs.

A first `--apply` over an existing backlog can write hundreds of labels by
rule, and rule writes are uncapped. Each write is one add and one read-back, so
such a run issues over 1,000 CLI calls and exceeds the command's timeout. Run
without `--apply` first and read the report. Then run the `--apply` from a shell
(`bun plugins/autonomous/src/run.ts --account <key> --apply`), not through
`/autonomous:run`. The current example is the first `--apply` after the upgrade
that introduced `proposal`, which writes it to every open task that has an
autonomy label and no stage label (see
[Labels the tracker lacks](#labels-the-tracker-lacks)).

### The stage and the autonomy decision

Scope and autonomy are decided; the stage is never judged or asked on its own.
It follows the autonomy (see [The label contract](#the-label-contract)):

- A task with an autonomy label and no stage label gets `proposal` by rule: tier
  `code`, confidence 1, reason `autonomy AFK is present`.
- An eligible autonomy decision of `AFK` or `HITL` for a task with no stage
  label also brings a `proposal` derivation, with tier `code`, confidence 1 and
  reason `follows autonomy AFK`.
- An eligible `grill-me` becomes a stage derivation. It keeps the decision's
  tier, confidence and reason, and no autonomy label and no `proposal` is
  written.
- While the autonomy is undecided, the stage stays missing. A task in `grill-me`
  without autonomy needs no autonomy decision.

The autonomy decision offers `AFK`, `HITL` and `grill-me` ("decide it in a
grill") only for a task with no stage label. For a task with a stage label it
offers `AFK` and `HITL`, so a `grill-me` judged for a task in `proposal` is
invalid and is asked. The question and the validity check take their options
from the same function, so they cannot disagree.

Each decision is recorded in the group of the label it writes. The writes for a
task are ordered scope, autonomy, stage, so a write cut short leaves at worst an
autonomy without a stage, which the next run completes by rule. A run without
`--apply` lists every `proposal` it would write as proposed.

### Labels the tracker lacks

The step never writes a label the tracker lacks. With or without `--apply`, it
lists a source's labels once, the first time the source has something to write,
and checks each label against the listing:

| Source | A label is available when                       |
| ------ | ----------------------------------------------- |
| Linear | the workspace or any team has it                |
| GitHub | the task's own repository, `owner/name`, has it |
| Beads  | never checked: labels exist by use              |

A label the tracker lacks is not written. Its derivation stays `proposed`, with
the detail `<label> is missing on <source>; run --bootstrap-labels`, and the
step's reasons name the label. A run without `--apply` makes the same check and
reports the same detail, so a dry run previews what `--apply` would skip. The
task's other labels and the source's other writes continue. With `--apply`, a
listing that fails stops the source, as a failed write does; in a dry run it
adds a reason and stops nothing. A derivation skipped this way was never
attempted, so `select` does not count its task as labelled this run. After an
upgrade, run `--bootstrap-labels` to create `proposal`; until then its
derivation stays proposed on Linear and on GitHub. The first `--apply` after
that adds `proposal` to every open task that has an autonomy label and no stage
label. That first run writes several hundred labels, each write being one add
plus one read-back. Read the list of proposed `proposal` writes in the dry run
first, then run that `--apply` from a shell
(`bun plugins/autonomous/src/run.ts --account <key> --apply`), because the
command's timeout cannot hold it.

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

For the same task, the scope question comes before the autonomy question. The
handoff takes the first 4; the others stay in the report's "for the human"
list. `Later` is not remembered and the order does not depend on earlier
answers, so a question left for `Later` comes back at the same place in the
next round, and the questions after it wait until those ahead are answered or
labelled some other way.

The question text has up to three lines:

```text
<source> <taskId> "<title>": which <group> label?
Seen: labels [<labels on the task>] + written [<labels this run added>] → <labels> (<tier>, <confidence>) → <why it was left for the human> — <reason>
Description: <the first 300 characters of the description>
```

The second line shows what the run saw for the group, with the arrows of the
report's "for the human" line. `+ written [...]` names the labels this run has
already added to the task, such as a scope written by an alias rule, and is
left out when there are none. Only a judgement (`llm`) shows a confidence; a
rule's record (`code`) computes none and shows the tier alone. The third appears only when the run read a
description: the listing's, or for Linear, whose listing carries none, the one
the judgement read. Its whitespace is collapsed, and `…` marks a cut.

The options are the group's contract labels in contract order, each described
by its meaning (see [The label contract](#the-label-contract)), then `Later`:

| Group    | Options                            |
| -------- | ---------------------------------- |
| scope    | `work`, `personal`, `Later`        |
| autonomy | `AFK`, `HITL`, `grill-me`, `Later` |

`grill-me` is an autonomy option only for a task with no stage label; for a task
carrying `grill-me` or `proposal`, the autonomy question offers `AFK`, `HITL`
and `Later`. Only scope and autonomy are asked: the stage never becomes a
question.

An option the judgement chose keeps its place, and its description is
prefixed with `judged <confidence> · <reason> —` before the meaning, as in the
example below. It is not moved first: that would anchor a human answering
several questions in a row, and bias the answers that will measure the
judgement's error rate. Options on a question from conflicting evidence get no
prefix; the evidence is on the second line. `Later` has a null value and the
description `Leave it for a later run`. Both questions take a single choice.

The header is the task id when it has at most 12 characters, and the group
name otherwise: `DOT-104` for Linear `DOT-104`, `autonomy` or `scope` for Beads
`agentic-task-8v0`. The id is `label-triage:<source>:<taskId>:<group>`, with
`scope` or `autonomy` as the group; task ids contain no `:`.

An autonomy question for a Beads task with no stage label, judged `HITL` at
0.80, below a threshold of 0.95:

```json
{
    "id": "label-triage:beads:agentic-task-8v0:autonomy",
    "step": "label-triage",
    "header": "autonomy",
    "question": "beads agentic-task-8v0 \"Sync the dotfiles on login\": which autonomy label?\nSeen: labels [work] → HITL (llm, 0.80) → below threshold 0.95: 0.80 — The result needs a human check\nDescription: Run the sync script when a session starts.",
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
            "description": "The task must be refined with a human in a grill before anyone works on it."
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
- its labels are options of the question's group and are valid under the
  contract for the task's stage;
- the task, read again through its tracker, still has that group missing, and
  for a `grill-me` answer still has no stage label.

An `AFK` or `HITL` answer for a task without a stage label writes the autonomy
and `proposal`. A `grill-me` answer writes only `grill-me`.

An answer with a malformed id, an unknown or disabled source, an unknown
group, or labels that fail that check is `rejected`, with the reason. One
whose task now has the group present or in conflict is `skipped`, naming the
labels found, and nothing is written; so is a `grill-me` answer once the task
carries a stage label, naming it. One whose task cannot be read is `failed`,
naming the command that failed.

The remaining answers go through the same additive write, read-back and
per-source stop as the step's own writes, with the same check that the tracker
has each label (see [Labels the tracker lacks](#labels-the-tracker-lacks)).
Nothing is removed. A label the tracker lacks makes that answer `failed`, naming
the label and `--bootstrap-labels`, without stopping the source. A
write error or a read-back mismatch makes that answer `failed`, with the label
sets, and stops further answers to that source in the same invocation. The
answer takes precedence over the evidence and the judgement the run had for
that group: answering `work` to a scope question that arose from the alias
`nazaries` against the structural rule `personal` adds `work`, and `nazaries`
stays. Answers are not remembered for later runs. Whether the task is still
open is not checked: the answer arrives seconds after the run, and a label on
a task closed in the meantime is harmless.

### Active-account caveat

The judgement, and the comparison of the `select` step, run `claude -p` on the
active Claude account, through the subscription the quota gate already
checked. `--account` must name that same
account; `claude-swap` integration is deferred. Both run in safe
mode with no tools, no hooks, no MCP servers and no session persistence,
because the prompt carries issue text anyone can write.

## The `select` step

Fourth in the run, after `reconcile`, `quota-gate` and `label-triage`, so it
runs only when all three advanced. It chooses the next work unit: a task
together with its next stage, which [`launch`](#the-launch-step) then takes. It
writes nothing to any tracker, asks the human nothing and contributes no
questions to the [handoff](#the-handoff), with or without `--apply`.

Its outcomes:

| Outcome         | Exit | When                                                                                                                       |
| --------------- | ---- | -------------------------------------------------------------------------------------------------------------------------- |
| `advance`       | 0    | A work unit was selected                                                                                                   |
| `wait`          | 2    | No task is a candidate. The reasons give the count of excluded tasks per exclusion                                         |
| `not-evaluable` | 3    | The machine scope or a task could not be read, the LLM failed, or its answer was rejected. It never falls back to an order |

In order, the step:

1. Reads the machine scope from the `machineType` value of `chezmoi data`:
   `personal` or `work`. When `chezmoi` cannot be executed, exits non-zero,
   prints output that fails validation, or the value is missing or another
   string, the step is `not-evaluable` and its reason names `chezmoi data`.
   This happens before any tracker is read.
2. Reads the open tasks of every enabled source again, with the same sources,
   open states, strict validation and 120 s limit that `label-triage` uses. A
   read that fails makes the step `not-evaluable`, naming the source and the
   command. A Linear read is incomplete when the blocker relations of an open
   task (from `linear issue query --all-teams`) reach 100 or its children (from
   `linear issue view <id>`) reach 250, the most `linear-cli` v2.6.0 returns;
   it counts as a failed read and the reason names that command. A completed or
   canceled issue never reaches selection, so its relations are not checked.
3. Excludes tasks, each reported once, under the first reason that applies:

    | Order | Exclusion         | When                                                                                                              |
    | ----- | ----------------- | ----------------------------------------------------------------------------------------------------------------- |
    | 1     | classification    | A scope, autonomy or stage group is missing or in conflict; autonomy is not missing while the stage is `grill-me` |
    | 2     | taken             | The task carries `taken`                                                                                          |
    | 3     | labelled this run | `label-triage` applied a label to it in this run, or a write to it failed in this run                             |
    | 4     | unsupported stage | Its next stage is not supported                                                                                   |
    | 5     | blocked           | It has an open blocker                                                                                            |
    | 6     | split             | It has an open child                                                                                              |

    Classification counts present contract labels only: an alias or a
    structural rule does not rescue a task here. A task in `grill-me` without an
    autonomy label is classified: its autonomy is deferred to the grill. A task
    labelled in this run is left for the next run, and so is a task whose
    `label-triage` write failed, because some labels may have landed. A task
    `label-triage` only proposed or asked about is not excluded, and neither is
    one whose label was skipped because its tracker lacks it. Tracker status does
    not exclude a task; only `taken` does.

4. Chooses among the candidates. A task of either scope is a candidate. With
   one candidate, it is selected without an LLM and the report says it was the
   only one; when it is outside the machine scope, the report marks it as a
   machine-scope exception for that reason. With two or more, an LLM compares
   them.

The next stage of a task is the stage label it carries, `grill-me` or
`proposal`. A task without one has no next stage and is excluded under
classification. Only `grill-me` is supported, so a task in `proposal` is
reported as waiting for an unsupported stage. `launch` keeps its own list: a
stage runs only when an implementation is registered for it, and only the test
stage is.

The autonomy of a selected unit is `AFK`, `HITL` or, for a task in `grill-me`
without one, none: `none` in the text report and `null` in the JSON data.

Blockers, the tasks a task blocks, its open children and its tracker priority
are read for Beads and Linear. A blocker or child is open unless it is closed:
in Beads, unless its status is `closed`; in Linear, unless its state is
completed or canceled. Beads decides which tasks are blocked by its own
dependency rules. GitHub tasks are treated as having no blockers and no
children, and the report says that dependencies and children were not
evaluated for GitHub.

### The comparison

The LLM runs as `claude -p` with a JSON schema and no tools, with the
`selection` model and effort of the configuration and a 300 s limit. It is
given the machine scope and, per candidate, its source, id, title,
description, labels, status, tracker priority, scope, autonomy, next stage,
and the tasks it blocks and the tasks blocking it. The prompt treats task
fields as untrusted data, never as instructions. The LLM may weigh urgency,
impact, effort and the ability to unblock other work; no fixed formula
applies. It returns the chosen source and id, a brief explanation, and an
exception reason when the choice is outside the machine scope.

Code rejects the answer when it does not match the schema, when the chosen
source and id are not one of the candidates, when the explanation is empty, or
when a candidate outside the machine scope is chosen without an exception
reason. An exception reason for a candidate within the machine scope is
dropped. A failed call or a rejected answer makes the step `not-evaluable`
with the reason.

### The selection report

The text report shows:

- the machine scope;
- the selected work unit: source, id, title, next stage, autonomy (`none` for a
  task in `grill-me` without one), scope and the explanation;
- the machine-scope exception reason, when there is one;
- the candidates compared;
- the excluded tasks, grouped by reason, each with its source, id and title;
- the note that GitHub dependencies and children were not evaluated, when
  GitHub is enabled.

With `--json`, the step's data carries the same information, plus the
selection model and effort when the LLM was called.

## The `reconcile` step

First in the run, before `quota-gate`, so a stage that completed is recorded
and its session removed even when no quota is left. It reads the attempts on
disk, brings each one forward as described below and reports all of them. It
never returns `wait`. It writes only with `--apply`; without it, it observes
and reports what it would do.

### Attempts

An attempt is one launch of a managed session for one stage of one task,
identified as `<source>:<task>:<stage>:<n>`, where `n` counts the attempts of
that task and stage from 1: the second attempt of the `test` stage for Linear
`DOT-109` is `linear:DOT-109:test:2`. Its record lives in the state directory,
outside every tracker and outside the workspace the agent works in. An attempt
is in exactly one state:

| State       | Meaning                                                               |
| ----------- | --------------------------------------------------------------------- |
| `pending`   | The record is written; no session exists yet                          |
| `created`   | The session exists and has not been started                           |
| `started`   | The session was started                                               |
| `completed` | Both proofs held and the session was removed (it may carry a cleanup) |
| `retained`  | Its session exited without completing the stage                       |
| `aborted`   | No session was ever created                                           |
| `discarded` | It was discarded with `--discard`                                     |

Every state change is written to the record, with its time, before the next
action that depends on it, so an interruption anywhere leaves a state the next
run resolves.

The state directory is `$XDG_STATE_HOME/autonomous`, or
`~/.local/state/autonomous` when `XDG_STATE_HOME` is unset, and
`AUTONOMOUS_STATE` overrides both (mainly for tests). Each attempt has its own
directory, nested by source, task, stage and attempt number:

```text
<state>/attempts/<source>/<task id>/<stage>/<n>/
    record.json    the attempt record, schema autonomous.attempt.v1
    prompt.md      what the agent is asked to do
    result.json    the result marker, written by the agent
    capture.txt    the last lines of the session, when one was taken
```

A GitHub id contains a `/`, so its directory nests one level deeper:
`<state>/attempts/github/owner/name#12/test/1/`. Writes go through a temporary
file and a rename, so a reader never sees a partial record. A record that
cannot be parsed, because a key is unknown or its state or stage is outside the
schema, makes `reconcile` `not-evaluable`, naming the file; `--discard` cannot
resolve such a record either, so its directory is removed by hand. The run lock
lives in the same directory (see [The run lock](#the-run-lock)).

### What it does to each attempt

In order of attempt id, by state:

- `pending` is resolved first (recovery, below).
- `created` is started, with `--apply`, and becomes `started`.
- `started` is observed, its two proofs are checked, and it is then finalised,
  retained or only reported.
- `completed` with a pending cleanup has its cleanup retried.
- `retained`, `aborted`, `discarded` and `completed` without a cleanup are
  only listed. A retained attempt is listed on every run until it is
  discarded.

The runner acts only on sessions whose id is recorded in an attempt. A session
made by hand is never removed, started, stopped or renamed, even when it shares
a worktree path with an attempt.

**Observed state.** The session integration reduces what it sees to `open`,
`exited` or `gone`, and for `open` whether a person is needed. For Agent of
Empires:

| AoE status                        | State    | Needs a person | Busy |
| --------------------------------- | -------- | -------------- | ---- |
| `running`, `starting`, `creating` | `open`   | no             | yes  |
| `idle`, `unknown`                 | `open`   | no             | no   |
| `waiting`                         | `open`   | yes            | no   |
| `stopped`, `error`, `deleting`    | `exited` | no             | no   |
| not found                         | `gone`   | no             | no   |

An observed state never completes an attempt by itself. An idle agent, an
exited process or a closed window is not success: a session that is `idle` and
has no valid result marker stays `started` and is reported as idle without a
result, and a `waiting` one is reported as open and needing a person, with
nothing changed.

**The two proofs.** A stage counts as completed only when both hold:

1. A valid result marker exists. The agent writes `result.json` in the
   attempt's directory. It is valid when it parses, has the schema
   `autonomous.result.v1`, names that attempt's id and reports the outcome
   `completed`. A missing marker, a malformed one, or one that names another
   attempt counts as absent, and the report gives the reason.
2. The stage's own check against the task's tracker holds. The task is read
   again for it.

A tracker changed by hand without a marker is not completion, and neither is a
marker without the tracker check.

**Finalisation.** An attempt whose proofs hold is finalised only when its
session is `open` without being busy, `exited` or `gone`. A session that is
`running`, `starting` or `creating` is left alone and the attempt is reported
as `completing`. Finalising, in this order:

1. Save the agent's conversation id in the record and a capture of the session
   (200 lines) in the attempt's directory.
2. Remove the session.
3. Mark the attempt `completed`.
4. Remove `taken` from the task, read back to confirm.

The attempt's directory and the workspace are kept. A session that is already
`gone` needs neither the capture nor the removal.

**Retention.** A `started` attempt whose session is `exited` or `gone` while
the proofs do not hold becomes `retained`, with the reason and the time; the
last lines of the session are captured first when it still exists. A retained
attempt keeps its session and `taken`, and no run retries it, relaunches it or
removes it. The user discards it with `--discard` (see
[Discard mode](#discard-mode)).

**Pending cleanup.** When the session cannot be removed after both proofs hold,
or `taken` cannot be removed afterwards, the attempt is marked `completed` with
a pending cleanup that names the error. `taken` stays on the task, the stage
does not run again for that task while the cleanup is pending, and every later
`reconcile` with `--apply` retries the removal and then removes `taken`.

**Recovery of a pending attempt.** A `pending` attempt is resolved before
anything else, by looking for sessions that have the attempt's worktree path:

| Sessions found | Result                                                                                |
| -------------- | ------------------------------------------------------------------------------------- |
| One            | The attempt adopts it, records its id and becomes `created`; nothing is created again |
| None           | `taken` is removed from the task and the attempt becomes `aborted`                    |
| Several        | The attempt is retained with that reason, and neither session is touched              |

### Outcome and report

The step is `advance` when nothing failed, with reasons that summarise the
counts: attempts observed, adopted, aborted, retained as ambiguous, started,
finalised, newly retained, cleanups cleared, then the totals retained,
cleanups pending and attempts needing a person, and `nothing changed` when no
attempt changed. With no record on disk the reason is `nothing to reconcile`
and no session manager command is run. Without `--apply` the counts read
`would-finalise`, `would-retain` and so on, and the attempt's `action` in the
data is what would be done.

The step is `not-evaluable` when the configuration did not load, a record
cannot be parsed, or a session manager or tracker command fails for an attempt.
That attempt keeps its state, the error is listed prefixed with the attempt's
id, and the attempts already written stay written. A failed session removal or
`taken` removal during finalisation is not one of these: it is a pending
cleanup and the step stays `advance`.

The text report prints one line per attempt, then the lists that need a
person, then the reasons:

```text
[reconcile] advance (code)
  linear:DOT-109:test:1  started → started  session waiting/open, needs a person  marker no result marker  observed
  needs a person:
    linear:DOT-109:test:1
  reasons:
    - 1 attempt observed
    - 1 attempt needs a person
    - nothing changed
```

Each line holds the id, the state before and after, the session's status and
state with the flags `needs a person` and `busy`, the marker (`marker ok`, or
the reason it is absent) and the action, with its detail after a colon.

With `--json`, the step's `data` carries the same information:

| Field        | Content                                                                                   |
| ------------ | ----------------------------------------------------------------------------------------- |
| `attempts`   | Every record, sorted by id, each `{ id, before, state, session, marker, action, detail }` |
| `retained`   | The ids in state `retained` after the step                                                |
| `cleanups`   | The ids `completed` with a cleanup still pending after the step                           |
| `needsHuman` | The ids whose session is open and needs a person                                          |
| `errors`     | The failed manager or tracker commands, one per attempt that hit one                      |

In an attempt, `before` is the state read from disk and `state` the state
after the step (the same without `--apply`). `session` is
`{ state, status, busy, needsHuman }`, or `null` when the session was not
observed. `marker` is `{ ok: true }`, `{ ok: false, reason }`, or `null` when
it was not checked. `action` is one of `none`, `adopted`, `aborted`,
`ambiguous`, `started`, `observed`, `completing`, `finalised`, `retained`,
`cleanup-pending` and `cleanup-cleared`. `detail` is free text: the retention
reason, the cleanup error, the adopted session id, or `null`.

## The `launch` step

Last in the run, after `select`. It takes the selected work unit, or the task
given with `--task` (see [The supplied task](#the-supplied-task)), reads the
task again through its source and applies the exclusions of the `select` step,
so a task that carries `taken`, lacks a scope, autonomy or stage label, is
blocked or is split is reported as excluded. With `--stage`, the
unsupported-stage exclusion is skipped. It then checks, in this order, and a failed check makes the step
`wait` with that reason:

1. The stage has an implementation registered. Only `test` is, so a selected
   `grill-me` unit waits until DOT-110 registers its stage.
2. The task read again carries no `taken`.
3. No attempt of the task, at any stage, is `pending`, `created`, `started` or
   `retained`, or `completed` with a pending cleanup.
4. A repository is inferred (see
   [Sessions and workspaces](#sessions-and-workspaces)).

A task that cannot be read, a workspace root that cannot be listed, a record
that cannot be parsed, or a failed `aoe group list` makes the step
`not-evaluable`.

Without `--apply` the step stops there. It also reads the AoE groups and names
the session, which calls `claude -p`, so the report shows the group and the
title it would use, and it is `advance`. It writes nothing and creates
nothing.

With `--apply` it then does, in this order:

1. Prepare the workspace.
2. Write the attempt record as `pending`, with the workspace path.
3. Add `taken` to the task, read back to confirm.
4. Write `prompt.md` in the attempt's directory.
5. Create the session and record its id: the attempt becomes `created`.
6. Start the session: the attempt becomes `started`.

A failure at any point makes the step `not-evaluable` and leaves the record in
the last state reached. A workspace that cannot be prepared leaves no record
and no `taken`. A failure to add `taken` creates no session and leaves the
attempt `pending`. A failure to create the session after `taken` was added
leaves the attempt `pending`, and the next `reconcile` resolves it by
[recovery](#what-it-does-to-each-attempt). The attempt number is the highest
existing number for that task and stage, plus one.

**The prompt.** The session is created with an initial instruction that names
the absolute path of `prompt.md` and tells the agent to read it and follow it:
no task text reaches the shell. The file carries the attempt id, the task
(source, id, title, description), the stage's instructions, and the absolute
path and exact content of the result marker. It is written before the session
exists, beside the record and never in the workspace.

**The stage contract.** A stage declares its id, its emoji, its prompt for a
task, its agent arguments and its completion check against the task's tracker.
Registering one needs no change to `reconcile` or `launch`. This change ships
one, the test stage 🧪, whose prompt asks the agent only to write the result
marker and stop, and whose tracker check always holds. It is never a task's
next stage and runs only with `--task <source>:<id> --stage test`. Its agent
arguments are `--model haiku --effort low` for `claude` and
`-c model_reasoning_effort=low` for `codex`.

The text report prints a header like the `select` step's, then the lines that
apply:

```text
[launch] advance (llm)
  task        linear → DOT-109 → Stage session manager
  stage       test
  input       supplied
  repository  /home/me/WebstormProjects/dotfiles (from Dotfiles)
  branch      feature/DOT-109-stage-session-manager
  group       Dotfiles
  title       auto 🧪 Stage sessions (DOT-109) (llm)
  workspace   /home/me/WebstormProjects/dotfiles-worktrees/feature-DOT-109-stage-session-manager (created)
  attempt     linear:DOT-109:test:1 started, session 336c83018fca4d13
  reasons:
    - launched linear:DOT-109:test:1 as "auto 🧪 Stage sessions (DOT-109)" in /home/me/WebstormProjects/dotfiles-worktrees/feature-DOT-109-stage-session-manager
```

Lines with nothing to show are left out. The title line says whether the name
came from the LLM or the fallback, and the fallback's error when there was one.
With `--json`, the step's `data` carries:

| Field        | Content                                                                                               |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| `task`       | `{ source, id, title }`, or `null` when nothing was selected                                          |
| `stage`      | The stage launched, or `null`                                                                         |
| `input`      | `selected`, `supplied`, or `null`                                                                     |
| `excluded`   | The `select` exclusion that stopped the unit, or `null`                                               |
| `repository` | `{ path, inferredFrom }`, the repository and the signal that matched, or `null`                       |
| `branch`     | The branch, or `null`                                                                                 |
| `group`      | The AoE group, or `null`                                                                              |
| `title`      | `{ value, source, error }`: the session title, `llm` or `fallback`, and the fallback's reason         |
| `workspace`  | `{ path, created }` with `--apply`, otherwise `null`                                                  |
| `attempt`    | `{ id, state, session }` with `--apply`: the record's last state and the session id, otherwise `null` |

The step's tier is `llm` when the LLM named the session and `code` otherwise.

### The supplied task

```text
/autonomous:run --task <source>:<id> [--stage <stage>] [--account <provider-key>] [--force] [--json] [--apply] [--no-handoff]
```

With `--task`, only `reconcile`, `quota-gate` and `launch` run; `label-triage`
and `select` do not. The task is given to `launch`, with `input` `supplied`,
and the stage is `--stage`, or the task's next stage when it is omitted.
`launch` applies every precondition as usual: a supplied task without a scope
label waits with the exclusion's reason, and a task that is not an open task of
an enabled source waits too.

To validate the cycle end to end, launch the test stage, then run the same
command again once the session has finished writing the marker; the second run
finalises it:

```bash
bun plugins/autonomous/src/run.ts --account <key> --apply --task <source>:<id> --stage test
```

### The run lock

A run holds `<state>/run.lock` for its whole duration. The file holds the
process id and the start time. It is held even without `--apply`, because
`reconcile` reads records that `--apply` runs rewrite, and discard mode holds it
too. `--bootstrap-labels`, answer mode and transition mode do not take it.

A run that finds the lock held by a live process runs no step: it is
`not-evaluable`, exits 3, and names the other run, as in
`another run holds <state>/run.lock (pid 1234, started 2026-10-17T10:00:00.000Z)`.
Nothing is written. A lock left by a process that no longer exists is
reclaimed, and the run goes on. A run does not wait and does not retry.

### The `taken` label

The runner writes `taken` for the attempts it launches:

- It adds `taken` at launch, after the workspace is prepared and the `pending`
  record is written, and before the session is created. The write is read back.
- It removes `taken` when the attempt is finalised, after its session is gone;
  when it is discarded; and when a `pending` attempt is aborted because no
  session was ever created. The removal is read back too.
- It keeps `taken` while the attempt is `retained`, and while a completed
  attempt's cleanup is pending.

A forgotten `taken` is removed by hand.
[ADR 0002](docs/adr/0002-remove-taken-on-finalisation.md) records why the
runner removes it.

## Discard mode

```text
/autonomous:run --apply --discard <attempt-id|source:id> [--release-workspace] [--json]
```

Discard mode discards an attempt and exits. It runs no step. It needs
`--apply` and only combines with `--json` and `--release-workspace`. Quote the
value when a GitHub id contains a `#`.

`--discard` names an attempt by its id, `<source>:<task>:<stage>:<n>`, or a
task as `<source>:<task>`. A task resolves to its single attempt that is not
`completed`, `aborted` or `discarded`; when there is none or there are several,
nothing changes and the report lists the attempt ids found. An attempt that is
already `discarded`, `aborted` or `completed` without a pending cleanup, or that
does not exist, is reported and nothing changes: only an attempt that still
holds the task can be discarded, so a closed one never removes a `taken` that a
later attempt holds.

It does these, in this order, and stops at the first failure:

1. Removes the attempt's session, when it has one and it still exists.
2. Removes `taken` from the task, read back to confirm.
3. Marks the attempt `discarded`, keeping its directory.
4. With `--release-workspace`, releases the worktree. The branch is kept.

Without `--release-workspace` the worktree is kept, so the next attempt of that
task reuses it. A failure stops the run with exit 3 and names the error. What
was already removed stays removed and is reported: when the session cannot be
removed, nothing changes and `taken` stays; when `taken` cannot be removed
after the session was, the reason says so.

With `--json` the report is one document identified by
`schema: "autonomous.discard.v1"`:

```json
{
    "schema": "autonomous.discard.v1",
    "startedAt": "2026-10-17T10:00:00.000Z",
    "outcome": "advance",
    "attempt": "linear:DOT-109:test:1",
    "task": { "source": "linear", "id": "DOT-109" },
    "found": [],
    "removed": { "session": true, "taken": true, "workspace": false },
    "reasons": [
        "session 336c83018fca4d13 removed",
        "taken removed from linear:DOT-109",
        "attempt linear:DOT-109:test:1 discarded"
    ]
}
```

`outcome` is `advance` when the attempt was discarded and `not-evaluable`
otherwise. `attempt` and `task` are `null` when nothing was resolved; `found`
holds the attempt ids a task reference matched when it resolved to none or to
several; `removed` says which of the session, `taken` and worktree were
removed; `reasons` says what was done or why it stopped. When the configuration
cannot be loaded, the error is printed on stderr and, with `--json`, the
document also holds `config: { path, error }` and removes nothing. Without
`--json` the text report holds the same information:

```text
autonomous discard — started 2026-10-17T10:00:00.000Z
outcome: advance
attempt: linear:DOT-109:test:1
task: linear:DOT-109
removed: session yes, taken yes, workspace no
reasons:
  session 336c83018fca4d13 removed
  taken removed from linear:DOT-109
  attempt linear:DOT-109:test:1 discarded
```

When another run holds the [run lock](#the-run-lock), nothing changes: the
report is `not-evaluable` with the lock's error as its only reason.

The exit code is 0 for `advance` and 3 otherwise.

## Sessions and workspaces

Sessions and workspaces sit behind two contracts, each with one implementation:
replacing one touches one module and its tests, not the steps or the stages.

**`SessionManager`.** It creates a session without starting it, starts it,
observes it (reduced to `open`, `exited` or `gone`, with whether it needs a
person and whether it is busy), finds the sessions that have a worktree path
(only to recover a `pending` attempt), lists the groups, captures the session's
last lines, and removes it permanently with the worktree kept. Agent of Empires,
through the `aoe` CLI, is the one implementation. A session is identified by
the id `aoe add` prints, confirmed by reading the session back; the title never
identifies one, and the worktree path is only the recovery key. The tool is
`claude` or `codex`; any other `sessions.tool` is rejected by the configuration.

**`WorkspaceManager`.** It prepares a worktree for a repository and a branch,
and says whether it created it, and it releases one. worktrunk, through `wt`,
is the one implementation. When the branch already has a worktree, it is
reused; otherwise the branch is created from the repository's default branch.
Releasing removes the worktree and keeps the branch. The runner does not wait
for the background hooks of `wt`, such as a dependency install, so a stage that
needs dependencies says so in its prompt.

**The title.** A managed session is titled `auto <emoji> <name> (<task id>)`,
where the emoji is the stage's and the name is at most four English words that
an LLM infers from the task's title, description and labels, treated as
untrusted data. It uses `naming.model` and `naming.effort`, through the same
`claude -p` helper as the judgement and the comparison, with a 10 s limit. When
the inference fails, times out or returns something invalid, the name is the
first words of the task title instead, and the report says the fallback was
used and why.

**The group.** The session gets the project's AoE group, derived from the
repository directory's name as `ghd-aoe` does: an existing group whose last
path segment compares equal wins, otherwise the humanised directory name
(`dotfiles` becomes `Dotfiles`). Names compare case-insensitively with
`/`, `_` and `-` read as spaces. The groups come from `aoe group list --json`.

**The branch.** `feature/<task id>-<slug>`, where the slug is the task title
lower-cased, with runs of other characters collapsed to `-` and cut to 40
characters. In a GitHub id the `/` and `#` become `-`. A task has one branch,
and its worktree is reused across attempts and stages.

**The repository.** It is inferred from the task against the git repositories
directly under `workspace.root`. The signals are, by source:

| Source | Signal                                                         |
| ------ | -------------------------------------------------------------- |
| GitHub | The repository name in the task id (`name` in `owner/name#12`) |
| Linear | The project name, read by the Linear reader; none when unset   |
| Beads  | Every label that is not a contract label                       |

Names compare as for the group. Exactly one repository must match: with none or
several, the task is not launched and the reason lists the signals and the
matches. The report says which signal matched.

**What the runner never does.**

- It never trashes a session: it removes it with `aoe remove --purge`, because
  AoE's trash keeps a removed session listed as `error`. The agent's
  conversation id and a capture are saved first, and the conversation itself
  stays where the agent keeps it.
- It never removes a worktree except on `--discard --release-workspace`, never
  asks AoE to delete one, and never deletes a branch.
- It never creates a session with a permission bypass: there is no `--yolo`,
  whatever the tool.
- It never touches a session whose id is not recorded in an attempt.

## The quota gate

Second in the run, after `reconcile`, so a stage that completed is recorded even
when the gate says to wait. For the selected account the gate reads OpenUsage and evaluates the `session`
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

| Part                                               | Tier |
| -------------------------------------------------- | ---- |
| read and validate the three sources                | code |
| detect missing groups and conflicts                | code |
| scope and autonomy by rule (evidence)              | code |
| the stage from the autonomy, by rule               | code |
| autonomy (and scope without evidence) by judgement | llm  |
| threshold, validity, ordering, cap                 | code |
| writes, label check and read-back                  | code |
| report                                             | code |
| questions: selection, order, text, options         | code |
| answers: validation, writes and read-back          | code |

The judgement (`claude -p`) is the step's only LLM work, and the only part
expected to move: it is meant to be replaced by Jev (TypeSafe AI) once that
work lands, without touching the contract or threshold. In the report only
the tier changes: judged tasks and the step itself record `llm` today, and
the swap must change that too. An applied answer is written with tier
`human`, which no report renders: a human decided it, not a rule or the
judgement.

The `reconcile` and `launch` steps' tiering:

| Part                                                                           | Tier                      |
| ------------------------------------------------------------------------------ | ------------------------- |
| records, lock, recovery, observation, proofs, finalisation, retention, cleanup | code                      |
| preconditions, inference, branch, workspace, `taken`, creation, start          | code                      |
| session name                                                                   | llm, with a code fallback |
| discard                                                                        | code                      |

The `select` step's tiering:

| Part                                                               | Tier |
| ------------------------------------------------------------------ | ---- |
| machine scope, reading, exclusions, next stage, single candidate   | code |
| comparing two or more candidates                                   | llm  |
| validating the choice, the exception rule, the outcome, the report | code |

The handoff's tiering:

| Part                                                  | Tier |
| ----------------------------------------------------- | ---- |
| selecting, ordering and wording questions and options | code |
| cap, emission conditions, text-mode line              | code |
| asking the questions and mapping choices to values    | llm  |
| parsing, routing, validating and writing answers      | code |

The command's LLM work is relaying the script's output, asking the handoff's
questions and mapping the chosen options back to their values. Transition mode
is code throughout: reading the task, composing the question, and validating
and writing the answer.

## Versioning

Versions are driven by release-please from conventional commits scoped to this
plugin (`feat(autonomous): …`). A release bumps the version in
`.claude-plugin/plugin.json`, `package.json`, and this plugin's entry in the
root `.claude-plugin/marketplace.json`. Tags read `autonomous--v0.1.0`.
