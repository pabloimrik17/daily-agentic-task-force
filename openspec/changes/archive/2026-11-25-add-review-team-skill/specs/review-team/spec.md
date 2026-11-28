## Purpose

The review team: several reviewers, each judging a change from its own angle, whose findings and doubts are pooled into one report of a fixed shape without being judged. It ships as a skill of the autonomous plugin, usable by hand and as the procedure of the report of a code review.

## ADDED Requirements

### Requirement: The review team skill

The autonomous plugin SHALL ship a skill named `review-team`. Its description SHALL make it apply only when a review team is asked for by name, or when a stage or another skill says to follow it, never to a request to review something in general.

#### Scenario: Asked by name

- **WHEN** a person asks a session to run the review team on their branch
- **THEN** the skill `autonomous:review-team` applies

#### Scenario: General review request

- **WHEN** a person asks a session to review a pull request, without naming the review team
- **THEN** the skill's description does not claim the request

### Requirement: The subject of a review

The subject SHALL be the current branch's changes against a base: the merge base of `HEAD` with the base ref the caller gives or, when none is given, with the base of the branch's open pull request or, when there is none, with the repository's default branch.

#### Scenario: Branch with an open pull request

- **WHEN** no base is given and the branch has an open pull request against `develop`
- **THEN** the subject is the diff from the merge base with `develop` to `HEAD`

#### Scenario: Branch with no pull request

- **WHEN** no base is given and the branch has no open pull request
- **THEN** the subject is the diff from the merge base with the default branch to `HEAD`

### Requirement: The review team only reports

The review team SHALL only report. No reviewer SHALL change a file of the subject, and the review SHALL triage nothing, merge no findings by root cause, refute nothing, fix nothing and publish nothing to a pull request or a tracker.

#### Scenario: A review ends

- **WHEN** a review of a branch ends
- **THEN** the working tree is as it was before the review, and nothing was posted to the pull request or any tracker

#### Scenario: Already changed file edited again

- **WHEN** a file that was already modified or untracked when the plan was made is edited before `collect` runs
- **THEN** `collect` reports that the contents of the working tree changed since the plan

### Requirement: The review tier is measured from the diff

Code SHALL measure the subject's diff and set its review tier: `S` when it changes at most 150 lines and 5 files, else `M` when it changes at most 600 lines and 20 files, else `L`. Changed lines SHALL count added and deleted lines. Lockfiles and OpenSpec change directories SHALL not count. The thresholds SHALL come from the configuration.

#### Scenario: Small change

- **WHEN** the diff changes 90 lines in 3 files
- **THEN** the tier is `S`

#### Scenario: Many files

- **WHEN** the diff changes 200 lines in 25 files
- **THEN** the tier is `L`

#### Scenario: Lockfile excluded

- **WHEN** the diff changes 100 lines of source in 2 files and 3,000 lines of `bun.lock`
- **THEN** the tier is `S`

### Requirement: A tier can be raised, never lowered

A caller MAY ask for a tier above the measured one, giving a reason. A request for a tier below the measured one SHALL be refused with an error, and nothing SHALL run. The report SHALL record the measured tier, the tier used and the reason.

#### Scenario: Raised with a reason

- **WHEN** the measured tier is `S` and the caller asks for `L` because the change touches the label contract
- **THEN** the review runs at `L` and the report records `S`, `L` and the reason

#### Scenario: Lowering refused

- **WHEN** the measured tier is `L` and the caller asks for `M`
- **THEN** the request is refused with an error naming both tiers and no reviewer runs

### Requirement: Reviewers per tier

Each tier SHALL take the reviewers its configuration lists, with their model, effort and level. The shipped table SHALL be the one set by the calibration:

- `S`: the walkthrough, `/code-review` at level `medium`, and Codex at `medium` effort.
- `M`: `S`'s reviewers and the CodeRabbit CLI, with `/code-review` at `high`.
- `L`: `M`'s reviewers and the tests lens, with `/code-review` at `xhigh` and Codex at `high`.

`fallow-review` SHALL run only when a configuration lists it.

#### Scenario: Tier M

- **WHEN** a review runs at tier `M` with the shipped table and every reviewer is available
- **THEN** the walkthrough, `/code-review` at `high`, Codex and the CodeRabbit CLI report, and neither the tests lens nor `fallow-review` runs

### Requirement: Teammates run on a named model

Every teammate reviewer of the shipped table SHALL name its model and effort: the walkthrough `opus` at `medium`, `/code-review` and the tests lens `opus` at `high`. The plan SHALL record a teammate's model and effort in its engine, and the skill SHALL start the teammate with them. The shipped team SHALL name no Codex model.

#### Scenario: Teammate model

- **WHEN** a review is planned with the shipped table
- **THEN** the walkthrough's engine names model `opus` and effort `medium`, and its teammate is started with that model and effort

### Requirement: The security trigger

The security reviewer SHALL join the team at any tier when a changed path, or an added line, matches one of the configured security patterns. Its model and effort SHALL come from the security configuration, shipped as `opus` at `high` effort. The report SHALL name the patterns that matched and where.

#### Scenario: Shell execution added

- **WHEN** a tier `S` change adds a line that calls `execFile`
- **THEN** `/security-review` joins the team, and the report names the pattern and the file and line

#### Scenario: Nothing sensitive

- **WHEN** no changed path or added line matches a security pattern
- **THEN** `/security-review` does not run

### Requirement: A reviewer that cannot run is skipped and recorded

A reviewer SHALL be skipped, never failing the review, when it cannot run. That covers a missing tool, a missing login, a rate limit, a skill shadowed by a same-named one, a repository or a base it does not apply to, or output that fails the finding schema. The report SHALL name every skipped reviewer and its reason.

#### Scenario: Codex not logged in

- **WHEN** `codex login status` reports no login
- **THEN** the Codex reviewer is skipped with the reason "not logged in", and the other reviewers still run

#### Scenario: Built-in shadowed

- **WHEN** a user skill named `code-review` is installed
- **THEN** the `/code-review` reviewer is skipped with the reason that a same-named skill shadows the built-in

#### Scenario: Not a JavaScript repository

- **WHEN** the repository has no `package.json`
- **THEN** `fallow-review` is skipped as not applicable

#### Scenario: Security review on another base

- **WHEN** the security trigger fires and the subject's base is not the repository's default branch
- **THEN** `/security-review` is skipped as not applicable, because it always reviews against the default branch

### Requirement: The plugin's own reviewers are required

The walkthrough and the tests lens SHALL run whenever their tier calls for them, because they need only Claude and the plugin. A built-in reviewer of Claude Code MAY be skipped like any other, for instance when a same-named skill shadows it. A review in which a required reviewer fails SHALL report the failure as an error instead of producing a partial report silently.

#### Scenario: Required reviewer fails

- **WHEN** the walkthrough's teammate ends without writing its output
- **THEN** the review reports an error naming the walkthrough

### Requirement: The finding schema

Every finding SHALL follow `autonomous.finding.v1`: an id unique in the report, its kind, its reviewer, its engine (tool and version, plus model, effort or level when set), a one-line title, a statement of one to three sentences, its location (a line range, a file or the whole change), its evidence, its Conventional Comments label (`issue` or `suggestion`), its native severity and its severity, and optionally a suggested fix.

#### Scenario: Line finding

- **WHEN** Codex reports a defect at `src/a.ts` lines 10 to 12 with priority `P1`
- **THEN** the report holds a finding with kind `finding`, label `issue`, native severity `P1`, severity `CRITICAL`, location `src/a.ts` 10–12 on the new side, and engine `codex` with its version

### Requirement: Output is validated at run time

Each reviewer's output SHALL be validated against the finding schema when the review collects it. A reviewer whose output fails SHALL count as a reviewer that could not run, and none of its findings SHALL reach the report. One exception: a Codex entry that fits Codex's form but names a path that a finding cannot hold SHALL be dropped alone, and the report SHALL name it under the Codex reviewer with the reason, while Codex's other entries are reported.

#### Scenario: Changed tool output

- **WHEN** the CodeRabbit CLI emits a line that the parser cannot read as a finding
- **THEN** the CodeRabbit reviewer is skipped with a reason quoting the validation error, and its other lines are not reported either

#### Scenario: Codex entry outside the repository

- **WHEN** Codex reports two entries and one names a path outside the repository
- **THEN** the other entry is reported as a Codex finding, and the report names the dropped entry under the Codex reviewer with the path and the reason

#### Scenario: Codex entry with a backslash in its path

- **WHEN** Codex reports two entries and one names a file inside the repository whose POSIX name holds a backslash, which a finding's path, written with forward slashes only, cannot hold
- **THEN** the other entry is reported as a Codex finding, and the report names the dropped entry under the Codex reviewer with the reason

### Requirement: Severity comes from fixed tables

A finding's severity SHALL be set by code from its reviewer's native severity, through that reviewer's fixed table onto `CRITICAL`, `WARNING` and `SUGGESTION`, and never re-rated by judgement. The plugin's own reviewers SHALL report on that scale directly.

#### Scenario: Tables of the external reviewers

- **WHEN** a native severity is mapped
- **THEN** `/code-review` `important`, `pre_existing` and `nit`; Codex `P0` or `P1`, `P2` and `P3`; CodeRabbit `critical`, `major`, and `minor`, `trivial`, `info` or `none`; `/security-review` `High`, `Medium` and `Low`; and `fallow-review` `block`, `address`, and `consider` or `fyi` map, in that order, to `CRITICAL`, `WARNING` and `SUGGESTION`

#### Scenario: Pre-existing bug

- **WHEN** `/code-review` reports a finding as `pre_existing`
- **THEN** its severity is `WARNING`

#### Scenario: Unknown native severity

- **WHEN** a reviewer reports a native severity its table does not list
- **THEN** the output fails validation and the reviewer is skipped with that reason

### Requirement: Doubts are reported apart

What a reviewer cannot judge without knowing the intent SHALL be reported as a doubt, with kind `doubt`, the Conventional Comments label `question`, a location and a statement, and no severity. A doubt that omits its label SHALL be read as `question`; a doubt with any other label fails validation. Doubts SHALL be listed apart from findings.

#### Scenario: Unexplained removal

- **WHEN** the walkthrough cannot tell whether removing a flag was intended
- **THEN** the report lists a doubt at that line, with no severity, apart from the findings

#### Scenario: Doubt without a label

- **WHEN** a teammate writes a doubt with no `label`
- **THEN** the file passes validation and the report lists the doubt with label `question`

### Requirement: Exact duplicates are grouped

Findings located on lines with the same file, the same side, the same line range and the same title, compared case-insensitively and ignoring whitespace, SHALL be grouped into one entry that names every reviewer that reported it. Findings that differ in any of these SHALL stay separate. A finding located on a file or on the whole change SHALL stay separate.

#### Scenario: Two reviewers, same finding

- **WHEN** `/code-review` and Codex both report "Missing await on save" at `src/a.ts` line 40
- **THEN** the report holds one entry naming both reviewers

#### Scenario: Same place, different claim

- **WHEN** two reviewers report different titles at the same line
- **THEN** the report holds two entries

#### Scenario: Opposite sides

- **WHEN** two reviewers report the same title on the same file and line range, one on the old side and one on the new side
- **THEN** the report holds two entries

#### Scenario: Same file, no line range

- **WHEN** two reviewers report the same title on the same file with no line range
- **THEN** the report holds two entries

### Requirement: The walkthrough draft

The walkthrough SHALL draft the change's walkthrough as a Plannotator guide of the subject's diff: a title, an intent and sections that place every changed file. The guide SHALL be validated against the diff's patch. When Plannotator is not available, or the guide fails validation, the report SHALL record that no guide exists and why, and the walkthrough's findings and doubts SHALL still count.

#### Scenario: Guide written

- **WHEN** the walkthrough runs with Plannotator available
- **THEN** the report directory holds the guide and the patch it was validated against, and the report names the guide

#### Scenario: Plannotator missing

- **WHEN** the `plannotator` command is not found
- **THEN** the report says no guide exists because Plannotator is not available, and lists the walkthrough's findings

### Requirement: The report

A review SHALL write a report directory holding `report.json`, which follows `autonomous.review-report.v1`, and a short `report.md` for a person. The report SHALL hold the subject, the measured and used tiers, every reviewer with its outcome and reason, the engine and duration of each reviewer the plan put in the team, the findings, the doubts and the walkthrough guide. The directory SHALL be the one the caller names or, when none is named, a new directory outside the repository.

#### Scenario: Run by hand

- **WHEN** a person runs the review team on their branch without naming a directory
- **THEN** the report is written outside the repository, its path is printed, and the session summarises it: tier, who ran and who was skipped, findings by severity and doubts

#### Scenario: Run for a stage

- **WHEN** a stage names its attempt's directory
- **THEN** the report is written there

#### Scenario: Directory reused

- **WHEN** a review is planned into the directory of an earlier review, and a reviewer writes nothing this time
- **THEN** the earlier run's generated files are removed first, and that reviewer is reported as not having written its output (failed when required)

#### Scenario: Foreign review files refused

- **WHEN** the named directory holds `reviewers/` but no valid `plan.json`
- **THEN** the plan is refused and the directory is left untouched

### Requirement: The review configuration

The review team SHALL read the optional `review` block of the user configuration file: tier thresholds, reviewers per tier with their model, effort and level, and the security patterns. With no configuration file, it SHALL use the shipped defaults. A configuration file that exists and fails validation SHALL stop the review with the error.

#### Scenario: No configuration file

- **WHEN** a person runs the review team on a machine with no `~/.config/autonomous/config.json`
- **THEN** the review runs with the shipped `review` defaults

#### Scenario: Invalid threshold

- **WHEN** the configuration sets `review.tiers.S.maxLines` to `-1`
- **THEN** the review stops with an error naming that path, and no reviewer runs
