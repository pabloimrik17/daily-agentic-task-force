# Tasks

## 1. Contract

- [x] 1.1 Establish the `openusage.limits.v2` contract from read-only probes of OpenUsage 0.8.0 and its source at tag `v0.8.0`: fields, exit codes, account ids, staleness, and how a failing account is reported. Record it, with display names redacted, in `evidence/openusage-0.8.0.md`.

## 2. Reading v2

- [x] 2.1 In `src/quota-gate/parse.ts`, validate `openusage.limits.v2` over the whole document, with no `errors` list, and the v1 reason that names OpenUsage 0.8 or later (design D1). Verify with `parse.test.ts` and `openusage.test.ts`: the observed 0.8.0 document parses; a v1 document gets the D1 reason; mistyped `remaining`, `utilization`, `available` and `expiresAt` name their path.
- [x] 2.2 In `src/quota-gate/openusage.ts`, always run `openusage claude`, never `--force`, and read no output after a non-zero exit (design D2, D4). Verify with `openusage.test.ts`: exit 4 and exit 2 give the CLI failure with the exit code; a valid document after a non-zero exit is not read.
- [x] 2.3 In `src/quota-gate/select.ts`, `decide.ts` and `step.ts`, count accounts only from `providers` and read a failing account as stale (design D3, D5). Verify with `select.test.ts` and `step.test.ts`: another account's staleness does not affect the selected one; the selected account's staleness is `not-evaluable` with both causes; `--account claude` is an unknown account.
- [x] 2.4 Replace `refresh with --force` in the outdated-window reason (design D4), and list a balance with its available amount (design D6). Verify with `step.test.ts` and `render.test.ts`.
- [x] 2.5 Move the test fixtures to v2: `limits()` has no `errors`, accounts are `claude@<8 hex digits>`, and the exit-4 fixture is the "nothing fetched yet" envelope. Verify that `bun run lint:knip` reports no unused export.

## 3. Documentation

- [x] 3.1 In `plugins/autonomous/README.md`, record 0.8.0 as the verified version and the v1 reason; describe account ids, `--force`, staleness and non-zero exits; update the `--account` examples. Verify with `bun run lint:markdownlint` and against the delta spec.
- [x] 3.2 Rewrite **Claude account** and **Account error** in `plugins/autonomous/GLOSSARY.md` for v2, with no implementation detail. Verify with `bun run lint:markdownlint`.
- [x] 3.3 Move the hand-run `run-nobody-to-ask` eval to OpenUsage 0.8: its stand-in `openusage` in `scaffold.sh` prints `openusage.limits.v2` with the account `claude@1a2b3c4d`, and `prompt.md` passes `--account claude@1a2b3c4d`. Verify by running the stand-in once and feeding its output to the quota gate with that account: it advances.

## 4. Integration

- [x] 4.1 Run the full gate set and confirm each passes: `bun run typecheck`, `bun run test`, `bun run lint:eslint`, `bun run lint:knip`, `bun run lint:fallow`, `bun run fallow audit`, `bun run lint:oxfmt`, `bun run lint:markdownlint`, `bun run lint:marketplace` and `openspec validate read-openusage-limits-v2 --strict`.
- [x] 4.2 Run `bun plugins/autonomous/src/run.ts` without `--apply` against the live OpenUsage 0.8.0, reading only the `[quota-gate]` section. With `--account claude@ec02e918` it advances. Record the redacted section in the evidence file.
- [x] 4.3 Run `/autonomous:run --account <id>` on this machine as the loop runs it, and confirm the quota gate passes with OpenUsage 0.8. Done on 2026-11-15 by the real loop of `add-autonomous-loop-and-slot-limits` (`evidence/7.3-real-loop.md`, "One real grill") and the dry run of `add-triage-me-label` (`evidence/8.3-dry-run.md`, `[quota-gate] advance`).

## Workflow follow-up

- Commit as `fix(autonomous): …` with a DOT-137 reference, and open the pull request when asked.
- Archive the change after review, so that `openspec/specs/quota-gate/spec.md` takes the delta.
