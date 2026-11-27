# Tasks

## 1. Baseline

- [x] 1.1 Verify the starting point: `bun run test` and `bun run typecheck` pass, and reading the real state with `listRecords` fails on `linear:DOT-121:code-review:1` before any code change.

## 2. The stage labels

- [x] 2.1 Add `qa`, `external-review`, `wrap-up` and `ready-to-merge` to the contract's stage labels, colours and meanings (design D4), and to `label-triage/criteria.md`. Verify with `contract.test.ts`, `detect.test.ts`, `bootstrap.test.ts` and `check.test.ts`, one test per new scenario of the label-contract and label-triage deltas.

## 3. The stage ids

- [x] 3.1 Add `code-review`, `qa`, `external-review` and `wrap-up` to `STAGE_IDS`, and not `ready-to-merge` (design D2). Verify with `state.test.ts`: a record of each parses, and one naming `ready-to-merge` does not; and that reading the real state with `listRecords` now succeeds.
- [x] 3.2 Verify, with no code change expected, that nothing is launched: `candidates.test.ts` excludes a task in each new label as an unsupported stage, and `launch.test.ts` waits as excluded for a supplied task labelled `qa`, and with `stage <id> has no implementation` for a declared stage that reaches `launch`.

## 4. Docs

- [x] 4.1 Glossary: add **Wrap-up**, update **Stage label** with the nine labels and what `ready-to-merge` is. README: the label contract section (groups, meanings, colours, bootstrap), selection's unsupported stages, and an upgrade note naming the labels to bootstrap. Verify with `bun run lint:markdownlint`.

## 5. Checks

- [x] 5.1 `bun run test`, `bun run typecheck`, `bun run lint:eslint`, `bun run lint:oxfmt`, `bun run lint:knip`, `bun run lint:fallow` and `bun run lint:marketplace` pass, and `openspec validate declare-remaining-stages --strict` passes.
