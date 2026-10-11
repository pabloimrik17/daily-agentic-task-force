# Tasks

## 1. Branch

- [x] 1.1 Rebase the branch on `origin/main`, which carries the `autonomous` 1.2.0 release, and keep this change's commits on top. Verify that `git log --oneline origin/main..HEAD` shows only this change's commits and that `bun run test` passes before any code change.

## 2. Label contract and configuration

- [x] 2.1 Add `taken` to the contract (design D8):
    - `ContractLabel`, `LABELS`, `COLOURS` (`#95a2b3`) and `MEANINGS`, with `GROUPS` unchanged;
    - `MEANINGS.work` and `label-triage/criteria.md` become "Nazaries work.";
    - the alias parser in `config.ts` rejects the key `taken`.

    Verify with `contract.test.ts`, `detect.test.ts`, `config.test.ts` and `bootstrap.test.ts`, one test per scenario of the label-contract delta:
    - a task without `taken` is complete;
    - an alias for `taken` is rejected with its path;
    - the bootstrap creates `taken` on GitHub with `#95a2b3`;
    - `Taken` is not `taken`;
    - the triage option for `work` no longer claims priority.

    The existing triage and label-at-creation tests must pass unchanged, apart from the `work` meaning.

- [x] 2.2 Add the required `selection: { model, effort }` block to `AutonomousConfig` and `config.example.json` (design D7). Verify with `config.test.ts`:
    - a config without `selection` is rejected with the path `selection`;
    - an unknown key inside `selection` is rejected;
    - the shipped example parses.
- [x] 2.3 Document `taken` and the `selection` block in `plugins/autonomous/README.md`: the label table (with the new `work` meaning), the configuration section, and the rule "add `taken` to a task you work on by hand; remove a forgotten one by hand". Verify that `bun run lint:markdown` passes and that the README's example config matches `config.example.json`.

## 3. Runner and shared print-mode call

- [x] 3.1 Add `results: readonly StepResult[]` to `RunContext` (design D1). `runSteps` passes each step the results of the steps before it. Verify with `runner.test.ts`: a second fake step sees the first step's result, and the first step sees none.
- [x] 3.2 Extract the `claude -p` invocation and envelope check from `label-triage/judgement.ts` into `src/claude-print.ts`, with `PRINT_TIMEOUT_MS` (design D6). Verify that `judgement.test.ts` passes unchanged and that `bun run lint:fallow` reports no duplicate between the two modules.

## 4. Readers for selection

- [x] 4.1 Implement the Beads `WorkReader` in `src/select/readers/beads.ts` (design D2):
    - `bd list` over `open,in_progress,blocked,deferred` plus `bd blocked --json`;
    - tasks are the `open` and `in_progress` entries;
    - children are the non-closed entries with that `parent`;
    - `blockedBy` comes from `blocked_by`, and `blocks` is its inverse;
    - `priority` is set.

    Verify with `beads.test.ts` on recorded `bd` output (captured from `bd` 1.3.0 into fixtures): a blocked task, a parent with an open child, a parent whose only child is closed, and a failing `bd blocked` that names the command.

- [x] 4.2 Implement the Linear `WorkReader` in `src/select/readers/linear.ts`:
    - `list` from `issue query` with `priority` and the open `blocks` inverse relations;
    - `detail` from `issue view` with the description and non-closed children.

    Verify with `linear.test.ts` on recorded output:
    - the `DOT-111` blocked by `DOT-108` scenario;
    - a completed blocker that does not block;
    - a parent with an open child;
    - an unauthenticated CLI naming `linear auth login`.

- [x] 4.3 Implement the GitHub `WorkReader` in `src/select/readers/github.ts`: the triage listing, with `priority`, `blockedBy` and `children` set to null. Verify with `github.test.ts` that every task reports null for all three.

## 5. Selection core

- [x] 5.1 Implement `src/select/machine-scope.ts` (design D5). Verify with `machine-scope.test.ts`:
    - `personal`;
    - `work`;
    - missing `machineType`;
    - another value;
    - invalid JSON;
    - a failing exec.

    Every failure must give a reason starting with `chezmoi data:`.

- [x] 5.2 Implement `nextStage` and `SUPPORTED_STAGES` in `src/select/stage.ts` (design D4). Verify with `stage.test.ts`: a `grill-me` task, an `AFK` task, and an `HITL` task that also carries `grill-me`.
- [x] 5.3 Implement the ordered exclusions in `src/select/candidates.ts` (design D3), calling `detail` only for the tasks that survive the first five checks. Verify with `candidates.test.ts`, one test per scenario of the spec's "Candidates and exclusions":
    - unblocking task;
    - taken `grill-me`;
    - `AFK` already taken (reason `taken`);
    - `in_progress` without `taken`;
    - labelled this run;
    - parent split;
    - missing scope with an alias.

    Add one test asserting that `detail` is not called for an excluded task.

- [x] 5.4 Implement the comparison and its validation (`src/select/compare.ts`, `src/select/validate.ts`): the schema, the prompt with machine scope, criteria and the untrusted-data notice, and the four checks of design D6. Verify with tests for:
    - a single candidate (no exec call, tier `code`);
    - another-scope choice with a reason;
    - another-scope choice without a reason (rejected);
    - an id outside the candidates (rejected);
    - an empty explanation (rejected);
    - an exception dropped for an in-scope choice;
    - an exec failure.

## 6. The select step

- [x] 6.1 Implement `src/select/step.ts` and its `render` (design D9):
    - read the machine scope first;
    - then the readers, then the exclusions, then the comparison;
    - outcomes `advance`, `wait` (reasons are the per-reason counts) and `not-evaluable`;
    - the GitHub not-evaluated note.

    Verify with `step.test.ts`, one test per scenario of the spec's "Read the machine scope", "Read the tasks again", "Outcome of the step" and "Selection report". Include the `wait` case with 3 unsupported and 1 taken, and a text report naming source, id, title, stage, autonomy, scope and explanation.

- [x] 6.2 Wire the step into `src/run.ts`:
    - `STEPS = [quotaGateStep, labelTriageStep, selectStep]`;
    - `MainDeps` and `io` gain `chezmoi`, `work` and `selection`, built from `execCommand`.

    Verify with `run.test.ts`:
    - triage `not-evaluable` means `select` does not run;
    - a `--apply` run with a selection writes nothing from `select` and carries no `select` question;
    - the `--json` report holds the step's data.

- [x] 6.3 Update `plugins/autonomous/commands/run.md` (description and steps prose) and the README's run section for the `select` step, its exit codes and its report. Add the selection terms of `CONTEXT.md` to the README's glossary link if it lists terms. Verify with `bun run lint:markdown`, and by checking that `commands/run.md` still relays verbatim and adds no rule.

## 7. Integration checks

- [x] 7.1 Run the full toolchain: `bun run test`, `typecheck`, `lint:eslint`, `lint:knip`, `lint:fallow`, `lint:oxfmt`, `lint:markdown` and `lint:marketplace`. Also run `openspec validate add-autonomous-work-selection --strict`. Verify that everything passes, within the fallow complexity budget.
- [x] 7.2 Run selection by hand against the real trackers on this machine, with `AUTONOMOUS_CONFIG` pointing at a scratchpad copy of the user config plus `selection`. Do one run without `--apply` and one with `--json`. Record in `openspec/changes/add-autonomous-work-selection/evidence/manual-selection.md`:
    - the machine scope;
    - the selected work unit and its explanation, or the `wait` reasons;
    - the exclusion counts per reason;
    - the observed effect of adding `taken` to the selected task, then removing it by hand.

    Verify that the selected id is among the reported candidates, and that the run with `taken` no longer selects that task.

- [x] 7.3 Prepare the dotfiles PR that adds `"selection": { "model": "sonnet", "effort": "high" }` to the encrypted autonomous config. Leave it unmerged and link it from this change's PR, following the migration plan in design.md. Verify with `chezmoi diff` that the PR changes only that block once decrypted.
- [x] 7.4 Update DOT-108 in Linear with the PR, the evidence file and the release note (`feat(autonomous)!:`, a major release). Verify with `linear issue view DOT-108 --json`.
