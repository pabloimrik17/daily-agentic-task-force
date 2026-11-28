# Tasks

## 1. The workflow check

- [x] 1.1 Add a shared check under `plugins/autonomous/src/stages/` that tells, for a repository and a workflow (`propose`, `apply`, `update`), whether it is provided as its skill (`openspec-propose`, `openspec-apply-change`, `openspec-update-change`, following links) or as its command (`/opsx:propose`, `/opsx:apply`, `/opsx:update`), preferring the skill (design D1, D2). Verify with a test on temporary repositories: skill only, linked skill, command only, both, neither.

## 2. Proposal preparation

- [x] 2.1 Add the propose workflow to the proposal prerequisites, after the OpenSpec root check, and pass its name to the prompt through the stage context. Verify with `proposal.test.ts`, one test per new scenario of "Proposal prerequisites".
- [x] 2.2 Write the workflow's name in every place the proposal prompt names it (the AFK section, step 1 and step 2 of the Proposal section). Verify with `proposal.test.ts`, one test per new scenario of "The proposal prompt", and that the existing assertions now hold for both names.
- [x] 2.3 Name the workflow by both forms in the README's proposal stage sections. Verify with `bun run lint:markdown`.

## 3. The verify-runner teammate

- [x] 3.1 Make `.claude/agents/verify-runner.md` follow `.claude/skills/openspec-verify-change/SKILL.md` instead of `.claude/commands/opsx/verify.md` (design D3). Verify with `grep -rn "commands/opsx" .claude/agents` returning nothing.

## 4. Checks

- [x] 4.1 Run `bun run test`, `bun run typecheck`, `bun run lint:oxfmt`, `bun run lint:eslint`, `bun run lint:markdown`, `bun run lint:knip`, `bun run lint:fallow`, `bun run lint:marketplace` and `openspec validate support-openspec-skills --strict`. Verify that every command passes and that `bun.lock` is not modified.

## Workflow follow-up

- Commit as `fix(autonomous): …` for the plugin and `chore(agents): …` for `verify-runner`, with no `BREAKING CHANGE` footer.
- Run `/opsx:verify` on this change (or the `openspec-verify-change` skill), then archive it.
