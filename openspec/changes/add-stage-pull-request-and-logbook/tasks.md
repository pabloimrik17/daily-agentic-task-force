# Tasks

## 1. Baseline

- [x] 1.1 Verify the starting point: `bun run test`, `bun run typecheck` and `bun run lint:fallow` pass before any code change, and `git status` shows only the glossary and ADR edits of the grill that produced this change.
- [x] 1.2 Split those edits: keep Logbook, Logbook entry and Cover in `plugins/autonomous/GLOSSARY.md` for this change, and set aside Proposal preparation, Proposal, the `implement` and transition wording and `docs/adr/0004-…` for `add-proposal-stage`. Verify with `git diff plugins/autonomous/GLOSSARY.md`, which shows only the three logbook terms.

## 2. What the attempt remembers

- [x] 2.1 Add `agentArgs: string[] | null` to the attempt record (design D5): `launch.ts` stores what the stage declares, and the strict parser reads a record without the key as `null`. Document the field in the README's attempts section. Verify with `record.test.ts`, `state.test.ts` and `launch.test.ts`, one test per scenario of "The attempt keeps its agent arguments", and `bun run lint:markdown`.
- [x] 2.2 Write `transition.json` in the open attempt's directory after a transition answer is applied and read back (design D5), and note it in the README's transition answer section. Verify with `transition.test.ts`, one test per scenario of "An applied transition leaves a record in the open attempt", plus a write failure that leaves the answer `applied` with the failure in its detail.

## 3. Task links

- [x] 3.1 Add the optional `url` and `parent` to the work task, filled by `detail` in the three readers (design D4), from recorded CLI outputs. Verify with `linear.test.ts`, `github.test.ts` and `beads.test.ts` under `select/readers/`: a task with a URL and a parent, a task with neither, and that no selection test changes.

## 4. The cover

- [x] 4.1 Implement `cover(task, parent)` as a pure function in `src/pull-request/cover.ts` (design D4). Verify with `cover.test.ts`, one test per scenario of "The cover" and "Cover of a task without a definition", plus a first paragraph longer than 500 characters and a task with no URL.

## 5. Pull-request mode

- [x] 5.1 Add the `PullRequests` port and its `git`/`gh` implementation in `src/pull-request/` (design D2). Verify with a test of the exact arguments of each command on a fake `Exec`, the parsing of recorded `gh repo view` and `gh pr list` outputs, and an error that names the failed command.
- [x] 5.2 Add `--pull-request <attempt-id>` and `--title <text>` to `args.ts` with their flag rules. Verify with `args.test.ts`: the valid forms; a malformed id; `--pull-request` without `--apply`; `--title` without `--pull-request`; `--pull-request` with `--persist`, `--transition` and `--discard`.
- [x] 5.3 Implement the mode and dispatch it from `run.ts` without the run lock (design D1, D3): preconditions, reuse of an open pull request, the split-parent case, the empty commit, the push, the draft pull request, the title rule, the cover on every run, and the `autonomous.pull-request.v1` report in text and JSON. Verify with `pull-request.test.ts` on fakes, one test per scenario of "One pull request per workspace branch", "A branch with nothing to show", "Pull request title", "Pull-request mode", "Pull-request mode preconditions" and "Pull-request report".
- [x] 5.4 Document the mode, the cover (including that code owns the description), its report and exit codes in the README and in `commands/run.md`. Verify with `bun run lint:markdown`.

## 6. Log mode

- [x] 6.1 Implement `checkBody` in `src/logbook/body.ts` (design D7). Verify with `body.test.ts`, one test per scenario of "Logbook entry body", plus a body that breaks two rules and reports both.
- [x] 6.2 Implement the header rendering in `src/logbook/header.ts` (design D6). Verify with `header.test.ts`, one test per scenario of "Logbook entry header", plus a record with no `transition.json`.
- [x] 6.3 Add `--log <attempt-id>` to `args.ts`, implement the mode in `src/logbook/` and dispatch it from `run.ts` without the run lock: preconditions, the marker check, the publish, the read-back with `readUntil`, the atomic `logbook.json` and the `autonomous.log.v1` report. Verify with `args.test.ts` and `logbook.test.ts`, one test per scenario of "A logbook entry per attempt", "The entry is read back and leaves a receipt", "Log mode" and "Log report".
- [x] 6.4 Document the logbook in the README: what an entry is for, the body's sections and limits, the header, the receipt, the mode's report and exit codes; add the mode to `commands/run.md`. Verify with `bun run lint:markdown`.

## 7. Discard and reconcile

- [x] 7.1 Publish the discard entry at the end of `discard` (design D9) and describe it in the README's discard section. Verify with `discard.test.ts`, one test per scenario of "A discarded attempt leaves an entry", plus an attempt that already has a receipt.
- [x] 7.2 Add reconcile's note for a finalised attempt without `logbook.json` (design D8) and mention it in the README's reconcile section. Verify with `reconcile.test.ts`, one test per scenario of "A completed attempt without a logbook entry is noted", and that the step's outcome does not change.

## 8. The grill-me stage

- [x] 8.1 Change the grill-me prompt (design D10): the nine-step closing with the two new commands, the description of `logbook-entry.md`, the closed-task exception, the reworded pull-request constraint, and the machine-details rule for every source. Verify with `grill-me.test.ts`, one test per scenario of the four modified grill-me-stage requirements.
- [x] 8.2 Update the README's grill-me section: the closing order, documentation commits, a confirmed split and a "Later" answer. Verify with `bun run lint:markdown` and that the README no longer says the grill opens no pull request.

## 9. Integration checks

- [x] 9.1 Run the full toolchain and the strict validation: `bun run test`, `bun run typecheck`, `bun run lint:oxfmt`, `bun run lint:eslint`, `bun run lint:markdown`, `bun run lint:knip`, `bun run lint:fallow`, `bun run lint:marketplace` and `openspec validate add-stage-pull-request-and-logbook --strict`. Verify that every command passes and that `bun.lock` is not modified.

## 10. End-to-end verification

Results go to `openspec/changes/add-stage-pull-request-and-logbook/evidence/logbook-verification.md`. Every tracker or repository write here needs the user's go-ahead first.

- [ ] 10.1 In the sandbox repository used for the grill-me verification, run a grill on a throwaway Beads task with no documentation change. Record the empty commit, the draft pull request with its cover, the 🔥 entry with its header, and the reconcile run that finalises the attempt without a note.
- [ ] 10.2 In the same sandbox, record three more cases: a grill that commits a glossary change (no empty commit); a confirmed split with no documentation change (no pull request, reconcile's note); and a retained attempt discarded after a pull request exists (the discard entry). Clean up the sandbox tasks and pull requests afterwards.

## Workflow follow-up

- Commit as `feat(autonomous): …`, a minor with no `BREAKING CHANGE` footer, excluding `bun.lock`.
- Run `/opsx:verify` on this change and archive it before `add-proposal-stage` is archived, since that change's deltas build on the grill-me closing order as this one leaves it.
- Propose `add-proposal-stage` next, from the decisions of the same grill: the `implement` label and its transition (ADR 0004), the context a run gathers for the stage, and proposal preparation itself.
