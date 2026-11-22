---
name: review-team
description: Use only when a request names the review team, or a stage or another skill says to follow the review team. Never use it for a request to review a pull request, change or code that does not name the review team.
allowed-tools: Bash(bun ${CLAUDE_PLUGIN_ROOT}/src/review-team/cli.ts *)
---

# Review team

You run the review team on the current branch: several reviewers, each from
its own angle, report findings and doubts on the branch's committed changes,
and code pools them into one report without judging them. A tool of this
plugin plans the team, runs the reviewers that are command line tools and
collects the report. You start the reviewers that are Claude teammates, wait
for every reviewer and summarise the report. You do not review the change
yourself.

The tool is run as:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/src/review-team/cli.ts <command> [options]
```

It exits 0 when it is done, 1 on an error and 2 when it refuses a request.

## The rules

The review team only reports. Never triage a finding, merge findings by root
cause, refute a finding or fix one, and post nothing to a pull request or a
tracker. Those are the finding triage's work, which comes after the report,
in the code review stage or with the person. The report must come out the same
whether a person or a stage runs the review team, and a report judged by the
session that pools it is no longer the reviewers' report.

- Never write or edit a reviewer's file, never re-rate a severity, and never
  drop or reword a finding in those files. Code derives each finding's
  severity from the reviewer's own word for it, through a fixed table, and
  validates every file; a file you touched would no longer be the reviewer's.
- A skipped reviewer is reported, not replaced. Do not start another reviewer,
  or review from its angle yourself, in its place: the configured team decides
  who reviews, and the report names who did not run and why.
- A teammate that ends without writing its file is not retried and not written
  for: `collect` records it as skipped, or as an error when the reviewer is
  required.
- The subject is committed work only: the merge base of `HEAD` with the base,
  to `HEAD`. Uncommitted changes are left out of the review.

## 1. Plan

```bash
bun ${CLAUDE_PLUGIN_ROOT}/src/review-team/cli.ts plan [--base <ref>] [--tier <S|M|L> --reason <text>] [--dir <dir>]
```

- Pass `--base` when the person or your caller names the base. Without it,
  the tool takes the base of the branch's open pull request or, when there is
  none, the repository's default branch.
- Pass `--tier` with `--reason` when the person or your caller asks for a
  tier, with the reason they give. The tool measures the tier from the diff;
  a request can raise it, never lower it.
- Pass `--dir` when the person or your caller names the report directory.
  Without it, the tool makes a new directory outside the repository.

`plan` prints the report directory, called `<dir>` below, and writes
`<dir>/plan.json` and a filled brief for each teammate under `<dir>/briefs/`.

Exit 2 is a refused request, such as a tier below the measured one: tell the
person the tool's message as it is and stop. Do not retry with other options
or work around the refusal. Exit 1 is an error, such as an invalid
configuration file: tell the person the error and stop. Either way, no
reviewer runs.

## 2. Start the reviewers

Read `<dir>/plan.json`. Its `team` lists the reviewers that run, and its
`skipped` lists those that cannot, each with its reason. For each `team`
entry:

- Of kind `teammate`: start one fresh, read-only teammate, with the model and
  effort the entry's `engine` names. Give it the content of the entry's
  `brief` file, `<dir>/<brief>`, as its whole task, and nothing else. A
  read-only teammate changes no file of the repository; it writes only the
  files its brief names.
- Of kind `cli`: run, in the background,

    ```bash
    bun ${CLAUDE_PLUGIN_ROOT}/src/review-team/cli.ts run <reviewer> --dir <dir>
    ```

Start all of them at the same time.

## 3. Wait

Wait until every teammate has ended and every `run` has exited. Each reviewer
writes its file, `<dir>/<output>` from its entry. You need not check them:
`collect` validates every file.

## 4. Collect

```bash
bun ${CLAUDE_PLUGIN_ROOT}/src/review-team/cli.ts collect --dir <dir>
```

`collect` validates each reviewer's file, derives each finding's severity,
groups exact duplicates, validates the walkthrough's guide, and writes
`<dir>/report.json` and `<dir>/report.md`. When it exits 1, tell the person
its error as it is.

## 5. Summarise

Read `<dir>/report.md` and summarise it in the chat:

- the tier: the measured one, the one used, and why;
- who ran, and who was skipped and why;
- the findings by severity, `CRITICAL` first, each with its location;
- the doubts, apart from the findings;
- the walkthrough's guide, or why there is none;
- the report's errors, if it has any;
- the path of the report directory;
- when `plan.json`'s `subject.dirty` is `true`, that uncommitted changes were
  left out of the review.

The summary repeats the report. It adds no judgement of a finding.

## How the built-in reviewers are run

Three reviewers run a skill someone else wrote. Their briefs tell the teammate
to invoke that skill, then transcribe each finding it reports into the
review team's file shape, with the skill's own severity word, without adding,
dropping or re-rating any:

- `code-review` invokes Claude Code's built-in `/code-review`, which takes
  `[low|medium|high|xhigh|max] [<branch>|<path>]` and reports `important`,
  `pre_existing` and `nit`. It posts nothing without `--comment` and fixes
  nothing without `--fix`, and the brief passes neither.
- `security-review` invokes Claude Code's built-in `/security-review`, which
  reports `High`, `Medium` and `Low`.
- `fallow-review` invokes the `fallow:fallow-review` skill, which reports the
  actions `block`, `address`, `consider` and `fyi`.

When a user or project skill of the same name shadows a built-in, `plan`
skips that reviewer and names the skill that shadows it.
