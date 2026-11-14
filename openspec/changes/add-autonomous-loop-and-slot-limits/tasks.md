# Tasks

## 1. Configuration and arguments

- [ ] 1.1 Add the optional `runner` block (`grills`, `parallel`, `intervalMinutes`) to `config.ts` through the existing overlay, to `config.defaults.json` (1, 2, 10) and to `config.example.json` (design D3). Verify with `config.test.ts`: a file without the block parses with the three keys defaulted and listed; `runner.parallel` `-1` and `runner.intervalMinutes` `2.5` and `0` are rejected with their paths; an unknown `runner` key is rejected.
- [ ] 1.2 Add the function that resolves each limit and the interval with its source `flag`, `file` or `default` (design D3). Verify with a unit test for the three sources of each value.
- [ ] 1.3 Add `--loop`, `--grills`, `--parallel`, `--interval` and `--notices` to `args.ts` with their combination rules and the usage text (design D10). Verify with `args.test.ts`: every scenario of "Loop flags" in `specs/autonomous-loop`, plus `--loop --no-handoff` rejected and `--grills 0` accepted.
- [ ] 1.4 Document the `runner` block and the new flags in `README.md` (configuration table and flag table). Verify with `bun run lint:markdown`.

## 2. Capacity step

- [ ] 2.1 Add the `capacity` step after `reconcile`: count open attempts per kind from the result of `reconcile`, compare with the resolved limits, `wait` only with `--loop` and every kind full (design D1, D2). Verify with a step test for each scenario of `specs/slot-limits`: retained attempt counts, a `test` attempt is a work slot, limit 0 is full, manual run over the limit advances, configuration missing is `not-evaluable`.
- [ ] 2.2 Render the step in text and JSON: occupied, limit, source and attempt ids per kind, and the over-limit note (spec "Capacity report"). Verify with a render test for `3/2` and for the sources `flag` and `default`.
- [ ] 2.3 Register the step in the pipeline and in the steps of a supplied task. Verify with `run.test.ts`: the order is `reconcile`, `capacity`, `quota-gate`, `label-triage`, `select`, `launch`, and with `--task` it is `reconcile`, `capacity`, `quota-gate`, `launch`.
- [ ] 2.4 Describe slots, the two kinds and the `capacity` step in `README.md`. Verify with `bun run lint:markdown`.

## 3. Selection

- [ ] 3.1 Export the stage order from the label contract and add the pure function that keeps the candidates at the most advanced stage and sets the others aside (design D4). Verify with `stage.test.ts`: proposal over grill, same stage keeps all, a single candidate.
- [ ] 3.2 Add the `no-free-slot` exclusion to `selectCandidates`, last in the order and only with `--loop`, from the data of `capacity` (design D4). Verify with `candidates.test.ts`: the three scenarios of "No free slot".
- [ ] 3.3 Pass only the kept candidates to `choose`, add `setAside` to `SelectData`, and render it in text and JSON (spec "Selection report"). Verify with `step.test.ts` and `render.test.ts`: a single kept candidate calls no LLM, the LLM is given the kept candidates only, a kept candidate of the other scope is a machine-scope exception, and a set-aside candidate is listed apart from the excluded tasks.
- [ ] 3.4 Update the selection section of `README.md` with the stage order rule and the new exclusion. Verify with `bun run lint:markdown`.

## 4. Loop

- [ ] 4.1 Make the lock file name a parameter of `attempts/lock.ts` and add the loop lock (design D6). Verify with `lock.test.ts`: a live loop refuses a second one, a dead owner is reclaimed, and a held loop lock does not stop a run.
- [ ] 4.2 Add the loop module: repeat the pipeline with the limits enforced and no handoff, wait the interval, honour a stop request, stop on a thrown error (design D5). Inject the clock, the wait and the stop signal. Verify with tests that drive iterations without real time: `wait` and `not-evaluable` iterations continue, a held run lock continues, a stop request during the wait exits with code 0, an error exits with code 1, the interval comes from the flag over the file.
- [ ] 4.3 Add the dry iteration: `--loop` without `--apply` runs once, prints the report, takes no loop lock and writes no log and no notice (spec "Dry iteration"). Verify with a test that checks the state directory is unchanged.
- [ ] 4.4 Write each iteration's report to `loop.log`, text or one JSON line, and rename the previous log at the start of a loop (design D7). Verify with a test: two iterations give two entries, standard output gains nothing, and a second loop leaves `loop.log.1`.

## 5. Notices and the command

- [ ] 5.1 Add to `ReconciledAttempt` the stage label the task carried when its stage completed, or `closed` (design D7). Verify with `reconcile.test.ts` for a finalised grill attempt whose task now carries `proposal` and for a closed task.
- [ ] 5.2 Record the notices of an iteration in `loop.notices`, emptied at the start of a loop: finalised, newly retained, stopped (spec "Notices"). Verify with a test for each scenario, including that a launch and a session waiting for the person record nothing.
- [ ] 5.3 Add the `--notices <n>` mode (design D8). Verify with tests: it prints the new lines and `next: <m>`, it waits while the loop is alive, and it prints `loop stopped: not running` with code 2 when no loop is alive.
- [ ] 5.4 Add `commands/loop.md` with the dry path and the background path (design D9), and state the two commands in `commands/run.md`. Verify with `bun run lint:markdown` and by reading the command against every scenario of "The command relays only notices".
- [ ] 5.5 Add a loop section to `README.md`: starting and stopping it, the dry iteration, the log and notices files, and running it from a shell. Verify that each documented command runs as written against a temporary state directory.

## 6. Glossary and ADR

- [ ] 6.1 Check that `GLOSSARY.md` carries slot, grill slot, work slot, loop and iteration as the grill wrote them, and update "Unattended run" to name the loop. The `triage-me` entry belongs to DOT-127: keep it out of this change's commit and commit it apart. Verify with `bun run lint:markdown` and `git show --stat` of both commits.
- [ ] 6.2 Write the ADR "Slot limits bind only the loop" with the next free number (design D11), and link it from the glossary entry for slot. Verify with `bun run lint:markdown`.

## 7. Integration

- [ ] 7.1 Run `bun run lint:oxfmt`, `bun run lint:eslint`, `bun run lint:knip`, `bun run lint:fallow`, `bun run lint:marketplace`, `bun run typecheck` and `bun run test`. Verify that all pass.
- [ ] 7.2 On the real machine, run `/autonomous:loop` without `--apply` and check the report against the open sessions: the counts per kind, the limits and their sources, and the unit it would launch. Keep the report as evidence in the change folder.
- [ ] 7.3 On the real machine, with the user's go-ahead, start `/autonomous:loop --apply --parallel 1 --grills 1`, let it launch one grill, start a second loop and check it is refused, then stop the loop. Check the log, the notices and that no second grill was launched. Then start the loop again, close the agent session that started it, and check whether the loop's process and its lock survive; record the answer in the README and close the open question of the design. Keep the evidence in the change folder.

## Workflow follow-up

- Update the description of Linear DOT-111 with the policy of this change, with the user's go-ahead.
- Archive the change after the pull request is merged.
