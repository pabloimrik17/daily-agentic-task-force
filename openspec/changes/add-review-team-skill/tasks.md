# Tasks

## 1. Baseline

- [x] 1.1 Check the starting point.
    - `bun run test`, `bun run typecheck` and `bun run lint:fallow` pass before any code change.
    - The branch already holds the grill's glossary terms (**External review**, **Reviewer**, **Review team**, **Review tier**, **Doubt**, **Finding thread**, **Walkthrough**, and the sharpened **Code review**) and ADR 0008.
    - Record whether DOT-162 is done. Calibration (9.2) waits for it.

    Verify by running the three commands and `bun run lint:markdownlint`.

    Recorded on 2026-11-22: the four commands pass (3,019 tests), the glossary terms and ADR 0008 are on the branch, and DOT-162 is not done (Backlog), so 9.2 waits.

    Later on 2026-11-22 the DOT-162 changes were applied by hand on the personal Mac: no skill named `code-review` shadows the built-in, and `plan` skips no reviewer. Its dotfiles pull request is still open.

## 2. Schemas and severity

- [x] 2.1 Add the types and validators of `autonomous.finding.v1` and `autonomous.review-report.v1` in `src/review-team/` on `src/validate.ts` (design D3, D4): the finding and doubt kinds, the three location scopes, the engine with its version, the label, the native severity and the optional suggested fix. Verify with tests for each scenario of "The finding schema" and "Doubts are reported apart", and for a finding missing its location being rejected with its path.
- [x] 2.2 Add the severity tables of the registry's reviewers and the identity table of the plugin's own reviewers (design D3). Verify with tests for each scenario of "Severity comes from fixed tables", including an unknown native severity failing validation.
- [x] 2.3 ~~Ship `src/review-team/codex-output.schema.json` for Codex's `--output-schema`.~~ Withdrawn on 2026-11-22: `codex exec review` ignores `--output-schema` (design D4), so no JSON Schema ships. The file written for this task is removed in 6.2, whose contract test covers the parser of Codex's text.

## 3. Configuration

- [x] 3.1 Add the optional `review` block: its shipped values in `config.defaults.json`, an example in `config.example.json`, and the key-by-key overlay and strict validation in `src/config.ts` (design D12). Add a loader for the review CLI that falls back to the shipped `review` block when no configuration file exists. Update the README's configuration section. Verify with:
    - `config.test.ts`, for the label-contract delta's scenario "Review block omitted" and for a mistyped `review` key being rejected with its path;
    - tests for the review-team scenarios "No configuration file" and "Invalid threshold";
    - `bun run lint:markdownlint`.

## 4. Subject, tier and security

- [x] 4.1 Resolve the subject (design D5): the base given, else the open pull request's base, else the default branch, then the merge base, with a dirty tree recorded. Verify with tests on temporary repositories that drop the hook's `GIT_*` variables, and with fakes for `gh`. There is one test per scenario of "The subject of a review".
- [x] 4.2 Measure the diff and set the tier (design D5): `git diff --numstat`, the lockfiles and `openspec/changes/**` left out, and a binary file counted as one file and zero lines. Verify with tests for "Small change", "Many files" and "Lockfile excluded", and for a tier exactly at each threshold.
- [x] 4.3 Raise the tier with a reason, and refuse to lower it (design D6). Verify with tests for "Raised with a reason" and "Lowering refused", and for a raise with no reason exiting 2.
- [x] 4.4 Run the security trigger on changed paths and added lines with the configured patterns, naming each match and where it is. Verify with tests for "Shell execution added" and "Nothing sensitive".

## 5. Registry and availability

- [x] 5.1 Write the registry as data (design D2): the seven reviewers with their angle, engine kind, invocation or brief, availability check, severity table and whether they are required, and the tier rows that resolve to a team with model, effort and level. Verify with a test for "Tier M" and one that every tier row names a registry entry.
- [x] 5.2 Add the availability checks (design D7) with injected command execution, so no real tool runs in a test. Verify with tests for "Codex not logged in", "Built-in shadowed" and "Not a JavaScript repository", and that a check that times out skips the reviewer with that reason.

## 6. The CLI reviewers

- [x] 6.1 Check the flags design D8 uses against `codex exec review --help` and `coderabbit review --help` on the installed versions. Record any difference in design.md before writing the runners. Verify that design.md names the versions it was checked against.
- [x] 6.2 Write the Codex runner and parser. Save the version, stdout, stderr and raw output under `raw/`, and treat a timeout, a non-zero exit or a parse failure as a skip with its reason. Record a fixture from one real run on a small throwaway repository. Verify with a contract test on the recorded fixture, and with tests for each skip reason on fakes.
- [x] 6.3 Write the CodeRabbit runner and NDJSON parser, with its rate-limit message as a skip reason. Record a fixture from one real run. Verify with a contract test on the recorded fixture, and with the scenario "Changed tool output": one unreadable line skips the reviewer and reports none of its lines.

## 7. Collect and report

- [x] 7.1 Write `collect` (design D3, D10):
    - validate each `reviewers/<id>.json`;
    - derive each severity;
    - group exact duplicates;
    - report an error when a required reviewer wrote nothing;
    - report an error when the tree or `HEAD` changed since the plan.

    Verify with tests for "Two reviewers, same finding", "Same place, different claim", "Required reviewer fails" and "A review ends".
- [x] 7.2 Validate the walkthrough's guide against the subject's patch with `plannotator guide export`, keeping the HTML page (design D9). Record a missing Plannotator or a failed validation as "no guide" with its reason. Verify with tests on a fake `plannotator` for "Guide written" and "Plannotator missing", and that a guide placing a file twice is recorded as invalid.
- [x] 7.3 Write `report.json` and `report.md`, in the directory the caller names or, by default, a new one under the system temp directory (design D11). Verify with tests for "Run by hand" and "Run for a stage", and that no path in the report is absolute or names the home directory.
- [x] 7.4 Wire `src/review-team/cli.ts`: `plan`, `run <id>` and `collect`, with a usage text and exit codes 0, 1 (an error) and 2 (a refused request). Verify with `cli.test.ts`: every command on fakes, an unknown reviewer, and a lowered tier exiting 2.

## 8. The skill

- [x] 8.1 Write `plugins/autonomous/skills/review-team/SKILL.md` (design D1) and the briefs in `skills/review-team/reviewers/`: `walkthrough.md`, `tests-lens.md` (design D13), `code-review.md`, `security-review.md` and `fallow-review.md`.
    - The description claims only a request that names the review team.
    - `allowed-tools` lets the skill run `bun ${CLAUDE_PLUGIN_ROOT}/src/review-team/cli.ts *`.
    - The body runs `plan`, then one fresh read-only teammate per Claude reviewer with the plan's model and effort, then the CLI reviewers in the background, then `collect`, then the summary.

    Verify with a test that reads the body and the briefs and finds each rule: only report, change no file, report doubts apart, write the schema to the named path, nothing posted. Also run `bun run lint:markdownlint`.
- [x] 8.2 Add the eval cases `evals/review-team-named` and `evals/review-team-negative`, on the model of the adversarial review's. Verify by running both with the local eval suite: the skill fires when named and does not fire on "review this pull request".
- [x] 8.3 Document the review team in the README, in its own section: reviewers, tiers, skipped reviewers, the report and the configuration. Link it from the glossary's **Review team**. Verify with `bun run lint:markdownlint`.

## 9. Integration and calibration

- [x] 9.1 Run the review team by hand on this branch. Check that the report names the tier, who ran and who was skipped and why, that the guide validated, and that the tree and `HEAD` are unchanged. Verify by reading `report.md` and `git status`.

    Run on 2026-11-22 at `e56356b`, tier `L` as measured (9,461 lines in 67 files). The walkthrough, `fallow-review`, the tests lens and `/security-review` reported 25 findings and 8 doubts; the guide validated; the tree and `HEAD` were unchanged. Three reviewers were skipped with their reasons: Codex (the configured model is not supported by the account), CodeRabbit (its review asked for a new login although `auth status` reported one) and `/code-review` (shadowed until DOT-162). So neither CLI parser has read a real run on this repository yet. The findings have not been triaged.
- [x] 9.2 Calibrate (design D14, HITL, only after DOT-162).
    - Build the reference set of accepted bot findings for five merged pull requests between #94 and #105, and have the user confirm it.
    - Run the full team at `L` on each pull request's commit before ready-for-review.
    - Pass the Greptile CLI over the same five commits. Record how many reference findings it caught and whether its use counted against the pull request app's monthly tier.
    - Record the coverage, the unique findings and the time and cost per reviewer in `calibration.md`.
    - Set the shipped `review` defaults from the results.

    Verify with `calibration.md` and with `config.test.ts` pinning the new defaults.

    Run on 2026-11-22, not finished. The reference set (20 findings over #94, #96, #97, #100 and #105) is confirmed by the user, the team ran at `L` on the five commits, and `calibration.md` holds the coverage, the unique findings and the time and cost. The team caught 9 of the 20, and 8 of those 9 came from `/code-review`. Greptile's CLI is billed per use and is not on the plan, so it stays unmeasured, as the user chose. The first runs showed that the `/code-review` brief reviewed the wrong code; it now passes a revision range. Still open: the user's decisions on the defaults, then the shipped `review` block and `config.test.ts`.

    Finished on 2026-11-23: the user decided from `calibration.md` (design D15), section 10 set the shipped `review` block from it, and `config.test.ts` pins it.
- [x] 9.3 Run every gate: `bun run test`, `bun run typecheck`, `bun run lint:eslint`, `bun run lint:fallow`, `bun run lint:knip`, `bun run lint:oxfmt`, `bun run lint:markdownlint` and `openspec validate add-review-team-skill --strict`. Verify that each one passes.

    Run on 2026-11-22 at `094f757`: the eight gates exit 0 (3,403 tests in 155 files). Calibration (9.2) has not run, so the gates run again after it changes the shipped defaults.

## 10. Calibration decisions

Decided by the user on 2026-11-23 from `calibration.md` (design D15).

- [x] 10.1 Set the shipped team from the calibration: `fallow-review` out of `M` and `L`; the walkthrough, `/code-review` and the tests lens with their model and effort in every tier; optional `model` and `effort` in `review.security`, shipped as `opus` at `high`, carried into the security reviewer's engine. Update `config.example.json`, the README's tier table and configuration, and `SKILL.md` where it names the team. Verify with `config.test.ts` pinning the new defaults, `team.test.ts` and `plan.test.ts` for "Tier M" and "Teammate model", and an invalid `review.security.effort` failing validation with its path.
- [x] 10.2 Drop a Codex entry whose path is outside the repository, alone: the optional `dropped` list in the reviewer file, carried by `collect` into the reviewer's outcome and named in `report.md`. Verify with tests for "Codex entry outside the repository", for an entry that does not fit the form still skipping Codex, and for a `dropped` entry in `report.json` and `report.md`.
- [x] 10.3 Read a doubt with no `label` as `question`. Verify with a test for "Doubt without a label" and one that a doubt labelled `issue` still fails validation.
- [x] 10.4 File the follow-up task for a reviewer of prose that instructs an agent (prompts, skills, documents), with the eight misses of `calibration.md` as its evidence. Verify by reading the task back in the tracker.

    Filed on 2026-11-23 as DOT-167 under DOT-82, in the Dotfiles project, labelled `personal` and `grill-me` as the user chose, and read back from Linear.
- [x] 10.5 Record the decisions in `calibration.md`, mark 9.2 done, and run every gate of 9.3 again. Verify that each one passes.

    Run on 2026-11-23 on the working tree of section 10: the eight gates and `openspec validate --strict` exit 0 (3,433 tests in 155 files), and `fallow audit` exits 0 with one duplication warning that predates this change (`attempts/state.ts` and `review-team/schema.ts`).

## Workflow follow-up

- Sync the specs and archive the change after the merge.
- The old `~/.claude/commands/review-team.md` is deleted by DOT-165, not here.
- The code review stage (DOT-164) consumes this skill; prepare its proposal after the calibration.
