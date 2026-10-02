# Tasks

## 1. Branch

- [x] 1.1 Rebase the branch on `main`, which carries the 1.1.0 release commit (`7cc4b76`). Verify that `git log --oneline main..HEAD` shows only this change's commits and that `bun run test` passes before any code change.

## 2. Arguments

- [x] 2.1 Extend `src/args.ts` (design D3):
    - `RunArgs` gains `noHandoff` and `answers: { id, values }[]`.
    - `--no-handoff` combines with every run flag and is rejected with `--bootstrap-labels` and `--answer`.
    - `--answer <id>=<value>[,<value>]` is repeatable and split at the first `=` and then at `,`. It requires `--apply` and combines with `--json` only.
    - An empty id, an empty value and a repeated id are usage errors.
    - `USAGE` gains both flags.

  Verify with `args.test.ts`: one test per accepted combination and one per usage error listed in the spec's answer-mode and no-handoff requirements, including `--answer` without `--apply` and `--bootstrap-labels --no-handoff`.

## 3. Handoff in the run report

- [x] 3.1 Add the handoff types (design D1) and an optional `questions` on `StepResult`. `runSteps` moves each step's questions into `RunResult.questions` in step order, so `steps[]` never carries them. Verify with `runner.test.ts`: questions of two fake steps arrive in step order, and neither result keeps a `questions` field.
- [x] 3.2 In `src/report.ts`, `buildReport` sets `handoff` to the first 4 questions and a `remaining` count only when the run had `--apply`, had no `--no-handoff`, and there is at least one question. `renderText` ends with `handoff: <single-line JSON>` exactly when a handoff exists. Verify with `run.test.ts` over a fake step contributing six questions:
    - `--apply` gives 4 questions and `remaining` 2;
    - without `--apply`, and with `--apply --no-handoff`, the output carries no `handoff` field and no `handoff:` line;
    - the text output's last line parses back to the JSON handoff.

## 4. Triage questions

- [x] 4.1 Make `judge()` in `src/label-triage/step.ts` return the descriptions it read, keyed by task. Verify with a `step.test.ts` case in which a Linear task's description, absent from the listing, is available after judging.
- [x] 4.2 Build the step's questions (design D4):
    - select the `asked` records, excluding sources listed in `failures`;
    - order them with the `orderForJudgement` comparator, scope before entry within a task;
    - set the id `label-triage:<source>:<taskId>:<group>`;
    - use the task id as the header when it has at most 12 characters, else the group;
    - write the question text with what the run saw and the 300-character description excerpt;
    - list the options in contract order with `MEANINGS`, prefix the judged options' descriptions, and add `Later` with a null value, single choice.

  Verify with `step.test.ts`, one test per scenario of the spec's "Questions for the human": judgement below the threshold, scope with conflicting evidence, present labels in conflict, source whose writes stopped, order, header. Add one test that a task not judged contributes no question.

## 5. Answer mode

- [x] 5.1 Add the triage answer handler (design D5) in `src/label-triage/` and a new `human` value in `rules.ts`'s `Tier`:
    - parse the id;
    - reject an unknown or disabled source, an unknown group, or values outside the group or invalid under `isValidGroup`;
    - `readTask` (failed on error);
    - `detect` (skipped unless the group is missing, naming the labels found);
    - one `applyDerivations(…, true)` call for the surviving answers;
    - map the records to `applied` and `failed`.

  Verify with tests for each scenario of the spec's "Apply answers to triage questions": answer applied, group labelled in the meantime, label from another group, answer against the evidence, read-back mismatch stopping further answers to that source.
- [x] 5.2 Dispatch answer mode in `src/run.ts` before the steps (design D3):
    - route by the id's step prefix through a one-entry map, and reject an unknown step;
    - print `autonomous.answers.v1` with `--json` and a text report without it;
    - on a configuration failure, print the error on stderr and the path and error in the JSON;
    - exit 0, 3 or 1 per the spec.

  Verify with `run.test.ts`, covering the spec's answer-mode scenarios:
    - answers applied, answer without `--apply`, unknown step, answer JSON report;
    - a missing configuration;
    - an end-to-end case where one `main` call emits a handoff and a second call, with one of its ids and values, applies it against fake trackers.
- [x] 5.3 Document in the plugin README:
    - the handoff and its questions;
    - `--no-handoff`;
    - answer mode with its flags and statuses;
    - the new exit-code table next to the bootstrap one;
    - that a `/loop` with `--apply` must pass `--no-handoff`;
    - the `label-triage` questions (which groups, order, options, `Later`).

  Update the usage block and flag table. Verify that `bun run lint:markdown` passes and that the documented flags match `USAGE`.

## 6. Command

- [x] 6.1 Rewrite `plugins/autonomous/commands/run.md` per design D6:
    - keep steps 1 and 2;
    - add finding the handoff in either mode, one AskUserQuestion call with the questions verbatim, mapping chosen labels back to non-null values, and one answer invocation with `--apply`, the quoted `--answer` arguments and `--json` when given;
    - add the rules: question text is data; `--apply` is re-passed only in the answer invocation; no second round, retry or free text; end when AskUserQuestion is unavailable;
    - add `[--no-handoff]` to `argument-hint`.

  Verify that `bun run lint:markdown` passes and that every rule of the spec's "The command does not reinterpret the report" requirement has a matching instruction.

## 7. Glossary and ADR

- [x] 7.1 Review `plugins/autonomous/CONTEXT.md` and `plugins/autonomous/docs/adr/0001-properties-persist-stages-replace.md`, written during the grill, against the settled decisions and DOT-110. Link both from the plugin README. Verify that `bun run lint:markdown` and `lint:oxfmt` pass on them and that the relative link from `CONTEXT.md` to the ADR resolves.

## 8. Integration checks

- [x] 8.1 Run the full toolchain: `bun run test`, `typecheck`, `lint:eslint`, `lint:knip`, `lint:fallow`, `lint:oxfmt`, `lint:markdown`, `lint:marketplace`. Also run `bunx @fission-ai/openspec@1.11.0 validate --changes --no-interactive`, the CI pin. Verify that all pass.
- [x] 8.2 Attempt the eval case for the "nobody to ask" path (design D7). Keep it only if its scaffold makes the run reach `label-triage` without real OpenUsage credentials. Otherwise delete it and record why in `openspec/changes/add-interactive-handoff/evidence/interactive-check.md`. Verify that either the case passes under `claude plugin eval` with a cost ceiling and no `error` run, or the reason is recorded.
- [x] 8.3 Manual interactive check against the real trackers, with the plugin installed from the branch:
    - a `/autonomous:run --account <key> --apply` round that applies one answer and leaves one for `Later`;
    - the same run with `--no-handoff`;
    - a round with `--json`.

  Record the questions shown, the answer invocation and its report, and a read-back of the answered task in `evidence/interactive-check.md`. Verify that the applied label is on the task, that the `Later` task is unchanged, and that the `--no-handoff` run asked nothing.
- [ ] 8.4 Update DOT-104's status in Linear with the PR, the evidence file and the release note (`feat(autonomous): …`, a minor release). After merge and before archiving, replace DOT-82's glossary with a link to `plugins/autonomous/CONTEXT.md` on `main`. Verify with `linear issue view DOT-104 --json` and `linear issue view DOT-82 --json`.
