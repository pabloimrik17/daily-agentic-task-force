# Tasks

## 1. Baseline

- [ ] 1.1 Verify the starting point on top of `exclude-stuck-tasks-from-selection`: `bun run test` and `bun run typecheck` pass before any code change.

## 2. Times

- [ ] 2.1 Verify under Bun whether `Intl.DateTimeFormat(undefined, { timeStyle: "short" })` follows `LC_ALL`, `LC_TIME` and `LANG` and the local time zone (run it with `LANG=es_ES.UTF-8` and with `LANG=en_US.UTF-8`), and record the result in design D5.
- [ ] 2.2 Add the time formatter to `LoopIo`, with the locale fallback of design D5 when 2.1 shows it is needed. Verify with a new test file: one test per scenario of "Notice times", with the locale and the zone fixed.

## 3. Lines

- [ ] 3.1 Build the summary line from the run report (design D3), with the stage emoji from the registry, the stuck count and the next time. Verify with `notices.test.ts`: one test per scenario of "Iteration summary line" and "Stuck count in the summary line".
- [ ] 3.2 Turn the finalised, retained, `triage-me` and stuck notices into indented detail lines with their symbols, after the summary line. Verify with `notices.test.ts`: one test per scenario of "Detail lines", "Notice symbols" and the modified "Stuck task notices".
- [ ] 3.3 Give the stop line its time and symbol. Verify with `loop.test.ts`: the scenario of "Stop line", for a stop request and for a runner error.
- [ ] 3.4 Record the summary and its detail lines in one append and pass the next time from `loop.ts`. Verify with `loop.test.ts` and `wait-notices.test.ts`: the scenario of "An iteration's lines are recorded together" and "Between iterations", and that `next: <m>` counts every line.

## 4. Command and docs

- [ ] 4.1 Update `commands/loop.md`: a notice now arrives for every iteration, lines keep their indentation inside the code block, and the instruction to say nothing while no notice arrives stays. Update the README's loop section with the format, the symbols and an example. Verify with `bun run lint:markdownlint` and the scenarios of "The command relays only notices".

## 5. Checks

- [ ] 5.1 `bun run test`, `bun run typecheck`, `bun run lint:eslint`, `bun run lint:oxfmt`, `bun run lint:knip`, `bun run lint:fallow` and `bun run lint:marketplace` pass, and `openspec validate one-notice-per-iteration --strict` passes.
- [ ] 5.2 Run the loop with `--apply` for two iterations with a 1-minute interval and show the person the real notices before the pull request is marked ready (the task is `HITL` for this reason).
