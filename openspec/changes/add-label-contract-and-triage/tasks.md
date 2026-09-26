## 1. Shared validation and configuration

- [x] 1.1 Move the primitive validators of `src/quota-gate/parse.ts` (object, string, number, boolean, path-carrying errors) to `src/validate.ts` and import them back; verify the existing quota-gate tests pass unchanged
- [x] 1.2 Implement `src/config.ts`: path resolution (`~/.config/autonomous/config.json`, `AUTONOMOUS_CONFIG` override) and the strict `autonomous.config.v1` parser (sources with enabled, aliases, structural scope, Beads directory, GitHub repos; judgement model, effort, threshold, cap, batch; unknown fields rejected); verify with tests for a valid file, a missing file whose error names the path and the example, a missing field, a mistyped field and an unknown field
- [x] 1.3 Add `plugins/autonomous/config.example.json` with placeholder aliases and repos; verify with a test that the example parses

## 2. Label contract

- [x] 2.1 Implement `src/label-contract/contract.ts` (labels, groups, colours, meanings) and `src/label-contract/detect.ts` (per-group presence, missing, conflict, with evidence from aliases and structural rules); verify with tests for complete, missing entry, both scopes, `AFK`+`HITL`, alias evidence, structural evidence and near-miss spelling (`Grill Me`)
- [x] 2.2 Write `src/label-triage/criteria.md` with the meaning of each label in the words the judgement prompt and the future creation-time skill share; verify with a test that the judgement prompt embeds it verbatim

## 3. Tracker modules

- [x] 3.1 Implement `src/label-triage/trackers/beads.ts` over an injected exec (`bd -C <dir> list --json`, `bd show <id> --json`, `bd label add`, `bd label list-all --json`; no label creation) with a strict parser keeping id, title, description, labels, status and updated time, and status filtering to open and in progress; verify with tests on fixture output, `ENOENT`, non-zero exit, timeout and invalid JSON
- [x] 3.2 Implement `src/label-triage/trackers/github.ts` (`gh issue list --repo … --state open --json`, `gh issue view --json`, `gh issue edit --add-label`, `gh label list --json`, `gh label create --color`) per configured repo; verify with tests as in 3.1 plus a multi-repo listing
- [x] 3.3 Implement `src/label-triage/trackers/linear.ts` (`linear issue query --all-teams --json`, `linear issue view --json`, `linear issue update --add-label`, `linear label list --json`, `linear label create -n -c`) excluding completed, canceled and duplicate states, with the missing-credentials error mapped to a reason naming `linear auth login`; verify with tests as in 3.1 plus the unauthenticated case
- [x] 3.4 Add `bd`, `gh`, `linear` and `claude` to `ignoreBinaries` in `knip.config.ts`; verify `bun run lint:knip` passes

## 4. Arguments and bootstrap mode

- [x] 4.1 Extend `src/args.ts` with `--apply` and `--bootstrap-labels` (the latter combinable only with `--json`) and update `USAGE`; verify with tests for each flag, the `--bootstrap-labels --apply` usage error and the unknown-flag error
- [x] 4.2 Implement `src/label-contract/bootstrap.ts` (per enabled source: list labels, create missing ones with colour, leave existing ones including differing colour, keep processing other sources on failure, report created/present/failed) and its text and JSON rendering; verify with tests on fake trackers for label missing on Linear, present with another colour on GitHub, Beads not applicable and an unauthenticated CLI
- [x] 4.3 Short-circuit `--bootstrap-labels` in `src/run.ts` before the steps with exit codes 0 / 3 / 1; verify with a `run.test.ts` case that no step runs and the bootstrap report is printed

## 5. Triage step

- [x] 5.1 Implement `src/label-triage/rules.ts` (evidence → derived group, confidence 1, tier `code`); verify with tests for structural rule, alias, no evidence and conflicting evidence
- [x] 5.2 Implement `src/label-triage/judgement.ts`: prompt from `criteria.md` plus a batch, the JSON schema, the `claude -p --model --effort --output-format json --json-schema` exec with a 300 s timeout, strict parsing of the envelope and the payload, discarding tasks missing from the answer or naming labels outside the vocabulary; verify with tests for a valid batch, a missing task, an out-of-vocabulary label, invalid JSON and a failed call
- [x] 5.3 Implement `src/label-triage/decide.ts`: threshold per group, validity under the contract, ordering (`work` evidence first, then updated time descending), cap and remainder; verify with tests for one group above and one below, a confident-but-invalid judgement (`AFK`+`HITL`), cap reached and deterministic ordering
- [x] 5.4 Implement `src/label-triage/write.ts`: no-op reporting `proposed` without `--apply`; with it, one additive `addLabel` per label, `readTask` and superset check, stop-per-source on the first mismatch; verify with tests for read-only, additive write keeping the alias, mismatch reported with both sets and no further write to that source
- [x] 5.5 Implement `src/label-triage/step.ts` wiring read (fail-closed) → detect → rules → judgement (degrading) → decide → write → data, never returning `wait`; verify with tests for `bd` missing → `not-evaluable`, judgement failure → `advance` with tasks reported as not judged, run without `--apply` → everything proposed, run with `--apply` → applied records
- [x] 5.6 Implement `src/label-triage/render.ts` (counts per source and group, applied/proposed lines `source → task → labels → reason` with tier and confidence, tasks for the human, remainder, write failures); verify with a string test, and verify with a `--json` test that every derived group appears with status, confidence and reason
- [x] 5.7 Extend `RunContext.io` with the three trackers and the judgement exec, add `config` to the context, load it once in `src/run.ts` (`null` when absent), and append `labelTriageStep` after `quotaGateStep`; verify with `run.test.ts` cases that the quota gate still runs without a configuration file and that the triage step reports the missing file

## 6. Command and documentation

- [x] 6.1 Update `commands/run.md`: argument hint with `--apply` and `--bootstrap-labels`, rules unchanged (relay only, no reinterpretation); verify the documented command lines match `USAGE`
- [x] 6.2 Update the plugin README: requirements (`bd` 1.3.0, `gh`, schpet/linear-cli 2.6.0 with `linear auth login`, `claude` ≥ 2.1.283) and the dotfiles note, configuration file and example, flags and exit codes, the label contract summary with colours, the triage tiering table with the `claude -p` judgement marked as the LLM tier to be replaced by Jev, and the active-account caveat; verify `bun run lint:markdown` passes

## 7. Verification

- [x] 7.1 Run `bun run lint:oxfmt`, `lint:eslint`, `lint:markdown`, `lint:knip`, `lint:fallow`, `lint:marketplace`, `lint:types` and `bun run test`; all pass
- [x] 7.2 Run `openspec validate add-label-contract-and-triage --strict`; it passes
- [ ] 7.3 Create the real configuration from the example, run `--bootstrap-labels` and check on each tracker that the five labels exist with their colour (Linear only once the CLI is installed and authenticated; before that, expect Linear `not-evaluable` naming `linear auth login` with the other sources processed)
- [ ] 7.4 Run `/autonomous:run --account <key>` without `--apply` and check the counts per source and group by hand against the trackers, then run once with `--apply`, pick three applied labels per source and confirm the read-back by opening the tasks; keep the JSON report as the first judgement baseline
