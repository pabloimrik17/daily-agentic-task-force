# Tasks

## 1. Read GitHub blockers in the reader

- [ ] 1.1 Export from `plugins/autonomous/src/label-triage/trackers/github.ts` the listing field list, the listing cap check and the per-issue parser (design D1), leaving `githubTracker.listTasks()` and its `gh` arguments unchanged; verify `src/label-triage/trackers/github.test.ts` passes unchanged.
- [ ] 1.2 Add hand-written fixtures under `src/select/readers/fixtures/` in the gh 2.100 shape (design, Context): a task with an open blocker in its repository, one with closed blockers (one completed, one not planned), one with an open blocker in a repository outside the configuration, one whose `blocking` holds an open and a closed issue from two repositories, and a cut-short `blockedBy` and `blocking` (`totalCount` 51, 50 nodes; `totalCount` 1, no node). Verify each parses as JSON.
- [ ] 1.3 Write failing tests in `src/select/readers/github.test.ts` for the spec scenarios "GitHub open blocker", "GitHub closed blocker", "GitHub blocker in another repository", "GitHub tasks blocked", "Blockers cut short", "Blocked tasks cut short" and "Blocker the token cannot see", plus one asserting a single `gh issue list` call per configured repository asking for `blockedBy,blocking`; verify they fail for the expected reason.
- [ ] 1.4 Make `githubWorkReader.list()` run its own `gh issue list` per repository with the tracker's fields plus `blockedBy,blocking`, fill `blockedBy` and `blocks` from OPEN nodes as `<nameWithOwner>#<number>`, and throw a `ParseError` naming the task when `totalCount` exceeds the nodes (design D1, D3, D4); verify the tests from 1.3 pass and the existing sub-issue tests still pass.
- [ ] 1.5 Make `WorkTask.blockedBy` a plain `string[]` in `src/select/types.ts` and drop the `null` handling in `src/select/candidates.ts` and in the Linear reader's `blocks` derivation; verify `bun run typecheck` passes and a test in `src/select/candidates.test.ts` excludes a GitHub task with an open blocker as `blocked` without calling `detail()`.

## 2. Remove the "not evaluated" note

- [ ] 2.1 Remove `SelectData.notEvaluated`, `GITHUB_NOT_EVALUATED` in `src/select/step.ts` and the `not evaluated:` lines in `src/select/render.ts` (design D5); update `src/select/step.test.ts`, `src/select/render.test.ts`, `src/run.test.ts`, `src/stages/grill-me/grill-me.test.ts` and `src/attempts/launch.test.ts`, and add a render test for the spec scenario "GitHub enabled"; verify `bun run test` passes and `grep -rn notEvaluated plugins/autonomous/src` finds nothing.

## 3. Documentation

- [ ] 3.1 Update `plugins/autonomous/README.md`: the `gh` requirement names `blockedBy` and `blocking` beside `subIssues`; the GitHub paragraph of the selection section describes the blocker read, the open-only and any-repository rules and the cut-short failure; the selection report list drops the GitHub note. Verify `bun run lint:markdownlint` passes and `grep -n "not evaluated for GitHub" plugins/autonomous/README.md` finds nothing.
- [ ] 3.2 Check that `plugins/autonomous/GLOSSARY.md`'s **Open blocker** entry matches the behavior shipped, and that the new code and README use "open blocker" rather than its avoided terms; verify by reading the diff.

## 4. Integration checks

- [ ] 4.1 Run `bun run lint:oxfmt`, `bun run lint:eslint`, `bun run lint:knip`, `bun run lint:fallow`, `bun run typecheck` and `bun run test`; verify all pass.
- [ ] 4.2 Run `/autonomous:run` read-only with GitHub enabled against the configured repositories; verify the select step reads every repository with one `gh issue list` each and its report has no `not evaluated:` line.

## Workflow follow-up

- Verify the change with `/opsx:verify` and archive it after the pull request merges.
