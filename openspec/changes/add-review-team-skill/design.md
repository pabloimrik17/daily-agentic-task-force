## Context

See proposal.md, "Why". The current state that shapes the approach:

- **Plugin skills.** The plugin ships `adversarial-review`, which applies only when asked for by name and has eval cases for that, and `labelling-new-tasks`, which calls a deterministic CLI of the plugin through `allowed-tools: Bash(bun ${CLAUDE_PLUGIN_ROOT}/src/label-at-creation/cli.ts *)`. That is the pattern this change follows: a skill for the judgement, a CLI for everything code can decide.
- **Configuration.** `src/config.ts` validates the user file strictly with the helpers of `src/validate.ts`. The optional blocks (`sessions`, `workspace`, `naming`, `runner`) take shipped values from `config.defaults.json` key by key (ADR 0003). The plugin has no runtime dependencies, so it has no schema library.
- **Teammates.** Stages already have their orchestrator start Claude teammates with a model and effort of its choice. The review team's Claude reviewers are teammates of whichever session runs the skill.
- **The external tools**, as installed on the user's machine on 2026-11-22:
    - `codex exec review` (codex-cli 0.169) takes `--base`, `-m`, `-c model_reasoning_effort=…`, `-o` and `--ephemeral`, and posts nothing. It accepts `--output-schema` and ignores it.
    - `coderabbit review --agent` (0.9.5) emits NDJSON with severities `critical`…`none`, and takes `--base` and `--base-commit`.
    - The built-in `/code-review` takes `[low|medium|high|xhigh|max] [<revision range>]`, posts nothing without `--comment`, fixes nothing without `--fix`, and reports `important`, `pre_existing` and `nit`.
    - The built-in `/security-review` reports `High`, `Medium` and `Low` and drops findings with a confidence below 8.
    - `fallow:fallow-review` reports the actions `block`, `address`, `consider` and `fyi`.
    - `plannotator guide export --guide <g> --patch <p>` validates an authored guide against its patch and fails when a file is misplaced.
- **Shadowing.** A user or project skill named `code-review` silently replaces the built-in. The dotfiles install CodeRabbit's skill under that name today, and DOT-162 removes it.
- **Gates.** The fallow audit runs on commit and in CI: functions of a module stay at cyclomatic complexity 4 or less, and internal source at 9 or less.

## Goals / Non-Goals

**Goals:**

- Put every decision code can make in code: the subject, the tier, the team, availability, running the CLI reviewers, severity mapping, validation, grouping and the report. Leave only reviewing itself to the teammates.
- Make adding a reviewer one registry entry, its fixtures or brief, and one row of the tier table.
- Make the output of the review team the same whether a person runs it by hand or the code review stage runs it.

**Non-Goals:**

- Judging the findings in any way: merging by root cause, refuting, ranking. That is the finding triage's job.
- Anything that writes outside the report directory.
- Supporting a subject other than a local branch, such as a pull request with no local checkout.

## Decisions

### D1. A skill for the teammates, a CLI for the rest

`skills/review-team/SKILL.md` drives the review in four steps:

1. `cli.ts plan` measures the diff, sets the tier, checks every reviewer's availability and writes `plan.json`. The plan holds the team, the skipped reviewers with their reasons, and one brief per Claude reviewer, already filled in.
2. The session starts one fresh, read-only teammate per Claude reviewer with the plan's model and effort. At the same time it runs `cli.ts run <id>` in the background for each CLI reviewer.
3. Each reviewer writes `reviewers/<id>.json`.
4. `cli.ts collect` validates, maps, groups and writes the report.

*Alternatives:* everything in the prompt, rejected because thresholds and severity tables applied by a model drift between runs. Running the Claude reviewers through `claude -p` from the CLI was also rejected: their free-text output still needs a model to put it into the schema, and teammates of the running session cost no extra process or login.

### D2. Two kinds of engine in the registry

Each reviewer is one entry in `src/review-team/registry.ts`, as plain data: `id`, angle, engine kind (`cli` or `teammate`), invocation or brief file, availability check, severity table, and whether it is required. The entries are:

- **`cli`**, which code runs and parses: `codex` and `coderabbit`.
- **`teammate`**, where a Claude teammate follows a brief in `skills/review-team/reviewers/<id>.md` and writes the schema itself: `walkthrough`, `tests-lens`, `code-review`, `security-review` and `fallow-review`. The built-ins and `fallow-review` are teammates because their output is free text or needs judgement to place.

Tier rows only name entries. A new reviewer is a new entry, its brief or parser, and a row.

### D3. The finding keeps its native severity; code sets the severity

A teammate or parser writes `nativeSeverity` in the reviewer's own words. `collect` derives `severity` from the entry's table, and an unknown native value fails validation. A model therefore never chooses a severity on our scale, and the native value stays in the trace for the triage and for calibration. The plugin's own reviewers have an identity table onto `CRITICAL`, `WARNING` and `SUGGESTION`.

### D4. The schema without a schema library

`autonomous.finding.v1` and `autonomous.review-report.v1` are TypeScript types validated with `src/validate.ts`, as the configuration is. No JSON Schema file ships. The first design gave Codex one through `--output-schema`, but `codex exec review` ignores that flag (codex-cli 0.169.0, checked with a real run on 2026-11-22), and `--json` carries the same text inside an event. Codex's review therefore reaches the schema through a parser of its text, like any other tool output.

Locations are `{ scope: "line", file, startLine, endLine, side }`, `{ scope: "file", file }` or `{ scope: "change" }`, with repository-relative paths. Ids are `<reviewer>-<n>`.

### D5. What "the diff" is

The subject is `merge-base(HEAD, base)..HEAD`, committed work only. Uncommitted changes are left out of the review, and the plan records that the tree was dirty so the summary says so. The measure is `git diff --numstat`, with these left out of both the line count and the file count:

- the lockfiles of the usual package managers (`bun.lock`, `bun.lockb`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `Cargo.lock`, `mise.lock`);
- `openspec/changes/**`, because a change's planning documents are verification's subject, not code review's.

A binary file counts as one file and zero lines. The base is resolved in the order the spec gives, through `gh pr view --json baseRefName` and then `git symbolic-ref refs/remotes/origin/HEAD`.

### D6. Raising the tier

`plan --tier <S|M|L> --reason <text>` raises the tier. A tier below the measured one exits 2 with an error naming both tiers, before anything runs. A raise without a reason exits 2 as well. The plan and the report keep the measured tier, the tier used and the reason.

### D7. Availability is checked by code, before anything runs

Each check is a read-only command or a file check, with a short timeout:

| Reviewer | Check |
| --- | --- |
| `codex` | `codex` is on the PATH and `codex login status` exits 0 |
| `coderabbit` | `coderabbit auth status --agent` reports authenticated |
| `code-review`, `security-review` | no skill directory with that name in `~/.claude/skills` or the repository's `.claude/skills` (shadowing) |
| `security-review` | also: the subject's base is the repository's default branch, because the built-in takes no base and always reviews against `origin/HEAD` |
| `fallow-review` | a `package.json` at the root, `fallow` on the PATH, and the `fallow` plugin installed (through `stages/skills.ts`) |
| `walkthrough`, `tests-lens` | always available; the walkthrough's guide also needs `plannotator` on the PATH |

A failure that only shows at run time also makes a reviewer skipped, with its reason: CodeRabbit's rate-limit message, a non-zero exit, a timeout (15 minutes per CLI reviewer), or a teammate that ends without writing its file.

### D8. The CLI reviewers

`run codex` calls `codex exec review --base <merge-base> -c model_reasoning_effort=<effort> -o <dir>/raw/codex.last-message.txt --ephemeral`, and adds `-m` only when the plan names a model. The last message is text of a fixed form: a summary, then one entry per finding, `- [P<n>] <title> — <absolute path>:<start>-<end>` followed by an indented paragraph. The parser reads those entries, makes each path relative to the repository, and skips the reviewer when an entry does not fit the form. `run coderabbit` calls `coderabbit review --agent --committed --base-commit <merge-base>` and keeps the NDJSON; `--committed` keeps uncommitted changes out, as the subject does. Each run saves the tool's version (`--version`), its stdout and its stderr under `raw/` for diagnosis, then parses into `reviewers/<id>.json`. A parse failure turns into the reviewer's skip reason. `run <id>` refuses to start when `HEAD` moved since the plan ("HEAD moved since the plan, from X to Y") and writes no reviewer file, so `collect` reports that reviewer as not having written its output. Before implementing, the exact flags are checked against each tool's `--help`, and any that differ are recorded in this design.

Checked on 2026-11-22 against `codex-cli 0.169.0` and `coderabbit 0.9.5`. Every flag above exists under that name. `-o` is the short form of `--output-last-message`, and `--base` is documented as taking a branch, and the fixture run confirmed that it takes the merge base's commit. A model that the account does not support makes Codex exit 1 with its own message, which becomes the skip reason; the shipped team names no model.

Checked on 2026-11-22 against Claude Code 2.1.330, in the calibration: the built-in `/code-review` reads a lone commit id as the commit to review, not as a base. Given the merge base alone, it reviewed that commit in the three first runs and never the subject. The brief therefore passes the subject as a revision range, `<merge-base>..<head>`, which the skill's documentation lists as a target and which a run on #97's commit confirmed.

### D9. The walkthrough writes a Plannotator guide

The walkthrough's brief asks for the authored guide format:

- `title`;
- `intent`;
- `sections[{ title, overview, diffs[{ file, summary }] }]`;
- `unplacedFiles`;
- an optional mermaid `diagram` per section, `{ kind: "mermaid", source }`.

It also asks for the findings and doubts the walkthrough meets while explaining the change. `collect` writes the patch (`git diff <merge-base> HEAD`) and validates the guide with `plannotator guide export --guide … --patch … --out <dir>/walkthrough.html`, which leaves an HTML page as a by-product. Checked against plannotator 0.29.2: it keeps a section's `diagram` and silently drops a top-level `overview`; it fails on a file placed twice or absent from the patch, but accepts a changed file that no section and no `unplacedFiles` entry names. `collect` therefore checks itself that every changed file is placed, and records a guide that leaves one out as invalid. The format is Plannotator's because the code review stage imports the guide into `plannotator review` and sends it through the Inbox (DOT-164). Findings are added as notes only there, after the fixes.

### D10. Grouping is mechanical

`collect` groups findings located on lines with the same file, side (old or new), start line, end line and title, after lower-casing the title and collapsing its whitespace. It keeps the first one's text and lists every reviewer and id in `reporters`. A finding located on a file or on the whole change is never grouped: it has no range to compare, and its title is often generic ("No tests"), so grouping it would keep one reviewer's text for what may be different claims. Doubts are never grouped. Anything less exact is left to the finding triage, which merges by root cause and names what it merged.

### D11. The report directory

The default directory is `<os tmpdir>/review-team/<repo>-<short head>-<UTC timestamp>`, outside the repository so that nothing in it can be committed. `--dir` names another. When that directory already holds a `plan.json` of a review, the plan first removes that review's generated files (`briefs/`, `reviewers/`, `raw/`, `walkthrough.{json,patch,html}` and `report.{json,md}`) and keeps anything else, so no file an earlier run left passes for this run's output. A directory that holds any of those names, or a `plan.json` that is not a valid review plan, but no valid `plan.json`, is refused without deleting or writing anything: it must be emptied or another directory named. A new or empty directory, or one with only other files, is written as before. When the directory is inside the repository, every tree check leaves it out with a pathspec (`:(exclude,literal)<dir>`): `subject.dirty`, the plan's recorded `git status --porcelain` and `collect`'s comparison. The files the review writes there are never taken for a change of the tree, so a `--dir` inside the repository works. The plan also records a fingerprint of the tree's contents: the diff of tracked files against `HEAD` and the content of the untracked files, with the report directory left out. `collect` compares it too, so editing a file that was already modified or untracked at plan time is reported as a change ("the contents of the working tree changed since the plan"). `report.json` and `report.md` hide the home and temp directories in every text they carry: the reasons and errors, and the title, statement and evidence of findings and doubts. The directory holds:

- `plan.json`;
- `reviewers/<id>.json`;
- `raw/`;
- `walkthrough.json`, `walkthrough.patch` and `walkthrough.html`;
- `report.json`;
- `report.md`.

The summary in `report.md` is short: tier and why, who ran and who was skipped and why, the findings by severity with their location, and the doubts.

### D12. The `review` configuration block

`config.defaults.json` gains `review`:

- `tiers: { S: { maxLines, maxFiles }, M: { maxLines, maxFiles } }`;
- `team: { S: [...], M: [...], L: [...] }`, each entry `{ reviewer, model?, effort?, level? }`;
- `security: { pathPatterns: [...], linePatterns: [...] }`.

The overlay is key by key, as for the other optional blocks, so a user who sets `review.team` replaces the whole team table. The CLI loads the user file through `loadConfig`. When the file does not exist, it uses the shipped `review` block alone. This is the one consumer that tolerates a missing file, because a person may run the review team in a repository that never set up the loop. An existing file is still validated as a whole.

### D13. Our own lens text

The tests-and-silent-failures brief is written for this plugin. It takes its angles from `pr-review-toolkit` (pr-test-analyzer, silent-failure-hunter) and PostHog's review-hog perspectives without copying their text. That keeps licensing and wording ours, and keeps the brief in the plugin's voice and schema.

### D14. Calibration

The calibration runs once, with the user following it (HITL):

1. Pick five merged pull requests between #94 and #105 that the bots reviewed.
2. For each one, take the head at its `ready_for_review` timeline event or, for a pull request opened ready (#105), its head when it was opened. Check that commit out in a temporary worktree.
3. Build the reference set: the bot findings the user accepted, which are the threads followed by a fix of that place or answered as addressed. The user confirms the list.
4. Run the full team at `L` against the pull request's base.
5. Record per reviewer how many of the reference findings it caught, the findings only it reported, and its time and cost (from the teammates' usage and the CLI durations).
6. Pass the Greptile CLI over the same commits, outside the team. Record how many of the reference findings it caught and whether its use counted against the pull request app's monthly tier.
7. Set the shipped `review` defaults from those numbers.

The numbers and the reasoning go in `calibration.md` in this change.

### D15. Decisions from the calibration

The calibration (`calibration.md`) changed the shipped team and two rules. The user decided each on 2026-11-23:

- **`fallow-review` leaves `M` and `L`.** In five runs it reported 18 findings and none named a defect: each noted that an export or a fixture changed. It stays in the registry, with its severity table and availability check, for a configuration that lists it.
- **The shipped team names each teammate's model and effort.** With no model, the session that runs the skill chose one, and the walkthrough on Sonnet at medium effort wrote an invalid file on 2 of 3 pull requests, which failed the whole report because the walkthrough is required. On Opus it wrote a valid file on all four. The shipped rows are: walkthrough `opus` at `medium`; `/code-review` `opus` at `high`, with its level per tier; tests lens `opus` at `high`. The security reviewer's row is built by code, not listed per tier, so `review.security` gains optional `model` and `effort`, shipped as `opus` at `high`; `/security-review` was not measured, and the values follow `/code-review`'s. Codex still names no model (D8).
- **A doubt with no label is read as `question`.** The label of a doubt can only be `question`, so a missing one carries no information, and failing a required reviewer's whole file for it costs the report. Any other label still fails.
- **A Codex entry with a path outside the repository is dropped alone.** D8 skipped the reviewer when any entry failed to parse, so a format change could not slip findings through. A path outside the repository is the model's mistake, not a format change: on #94 one such entry lost two findings that other reviewers confirmed. The parser drops that entry and keeps the rest; any other unreadable entry still skips the reviewer. The reviewer file of a reported reviewer gains an optional `dropped` list of `{ entry, reason }`, `collect` carries it to the reviewer's outcome in `report.json`, and `report.md` names each dropped entry under the reviewer.

Left as they are: CodeRabbit stays in `M` and `L` although its free plan covers three reviews a month, and is skipped with the rate-limit reason after that; CodeRabbit findings phrased as questions stay findings, as the tool reports them. A reviewer that reads prompts, skills and documents for what they make an agent do is a follow-up task, outside this change.

## Risks / Trade-offs

- **The built-in `/code-review` is shadowed until DOT-162 lands.** The reviewer is skipped with that reason. DOT-162 blocks this task, and calibration must not run before it, or it would measure a team without its strongest reviewer.
- **Built-in skills change their output without notice.** Their teammates write our schema, and validation at run time skips a reviewer whose output no longer fits. The fixtures only guard our parsers against our own regressions, which is why D8 records each tool's version.
- **Tier `L` is expensive**, with `/code-review xhigh` and the rest of the team running at once. The calibration measures the cost, and the tier table may move reviewers between tiers from it.
- **CodeRabbit's CLI and its pull request bot may share a quota.** Running the CLI could then cost the bot's next review. When the CLI is rate limited it is skipped, and the calibration notes whether the bot was rate limited afterwards.
- **A teammate that ignores "change no file".** The brief forbids it. `collect` compares `git status --porcelain` and `HEAD` with the plan's and reports an error when they changed, which the spec requires.
- **The fallow complexity budget.** The registry and the tables are data, and each check is its own small function.

## Migration Plan

None. A minor release with no required configuration change. A user file without `review` takes the shipped block. To roll back, revert the release: nothing else reads the report directories.

## Open Questions

- The shipped security patterns are a starting list (auth, token, secret, credential, crypto and permission paths, `.env` files; added lines calling `exec`, `execFile`, `spawn`, `Bun.spawn`, `eval` and `new Function`, or reading request or user input into the file system). The calibration may widen or narrow it without changing the spec.
