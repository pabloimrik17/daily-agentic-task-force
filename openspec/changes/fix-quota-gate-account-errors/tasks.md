# Tasks

## 1. Baseline

- [x] 1.1 Verify the starting point before any code change. `bun run test`, `bun run typecheck` and `bun run lint:fallow` pass. The worktree's only uncommitted change outside this change and `plugins/autonomous/GLOSSARY.md` is the pre-existing `bun.lock`, which stays out of this change's commits.

## 2. Exit output in the shared exec

- [x] 2.1 In `src/exec.ts`, add the `keepOutputOnExit` option to `execCommand` and the optional `exit: { code: number; stdout: string }` to `ExecResult`'s failure branch (design D3). `toExecResult` sets `exit` only when the option is on and `error.code` is a number. Verify with `src/exec.test.ts`:
    - a non-zero exit with the option on carries `exit` with the code and stdout, and the same `error` as today;
    - with the option off, the results equal today's exactly;
    - a timeout, `ENOENT`, a `maxBuffer` overflow and a kill by signal carry no `exit`, even with the option on.

## 3. Reading the document after a non-zero exit

- [x] 3.1 Add a fixture to `src/quota-gate/test-fixtures.ts` shaped like the DOT-104 observation (design D4), plus a fake exec that returns it as a failure with `exit` code 4 and the `openusage: warning: claude@12101920: …` stderr. Verify it is used by the tests in 3.2 and 3.3, and that `bun run lint:knip` reports no unused export.
- [x] 3.2 In `src/quota-gate/openusage.ts`, turn `keepOutputOnExit` on for `execOpenUsage` and make `readOpenUsage` follow design D1 and D2. Verify with `src/quota-gate/openusage.test.ts`:
    - a valid document with an account error after exit 4 is read;
    - a valid document with empty `errors` after a non-zero exit fails with the exec error followed by `(exit <code>, no account error in the output)`;
    - empty stdout, invalid JSON and a contract violation after a non-zero exit each fail with the exec error, not the parse error;
    - a failure without `exit` is returned unchanged;
    - the existing exit-0 tests still pass.
- [x] 3.3 Cover the four scenarios of "Read output after a non-zero exit" in `src/quota-gate/step.test.ts`, one test each, plus the modified "Malformed data outside the evaluated windows", which now applies after exit 0:
    - another account's error: `advance`, and no reason mentions `claude@12101920`, the exit code or stderr;
    - the selected account's error: `not-evaluable` with the Claude Swap message;
    - empty `errors`: `not-evaluable` naming the exit code;
    - unusable output: `not-evaluable` with `openusage failed: …`.

    Verify that `bun run test` passes and that `bun run lint:fallow` stays within the complexity budget.

## 4. Documentation and evidence

- [x] 4.1 In `plugins/autonomous/README.md`, record OpenUsage 0.7.16 as the verified version. Add that a non-zero exit is read when its output is a valid document with an account error, so another account's error does not block the selected one, and that any other non-zero exit is `not-evaluable`. Verify with `bun run lint:markdown` and by checking that the text matches the delta spec.
- [x] 4.2 Check that the **Quota** section of `plugins/autonomous/GLOSSARY.md` (Claude account, Account error) contains no implementation detail and fits the glossary format. Verify with `bun run lint:markdown`.
- [x] 4.3 Write `openspec/changes/fix-quota-gate-account-errors/evidence/openusage-0.7.16.md`. It records the exit-code table from design.md with its source references at tag `v0.7.16`, and the two slow reads of 2026-11-07: more than 120 s and 55 s, both exit 0. The first read showed three accounts and `errors: []`. The second read's output was discarded. Verify with `bun run lint:markdown` (the scaffolding is excluded, so also check the file renders) and by checking that each claim cites its source.

## 5. Integration

- [x] 5.1 Run the full gate set and confirm each passes: `bun run lint:oxfmt`, `bun run lint:eslint`, `bun run lint:markdown`, `bun run lint:knip`, `bun run lint:fallow`, `bun run lint:marketplace`, `bun run typecheck`, `bun run test` and `openspec validate fix-quota-gate-account-errors --strict`.
- [x] 5.2 Run `/autonomous:run --account claude` once against the live OpenUsage, without `--apply`. With no account error present, the quota gate's outcome and reasons match a run on `main`. Record the result in the evidence file from 4.3.

## Workflow follow-up

- Commit as `fix(autonomous): …` with a DOT-112 reference, and open the pull request when asked.
- Archive the change after review, so that `openspec/specs/quota-gate/spec.md` takes the delta.
- Move DOT-112 and its Board card when the pull request merges.
