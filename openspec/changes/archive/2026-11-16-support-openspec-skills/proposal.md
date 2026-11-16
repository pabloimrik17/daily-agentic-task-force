## Why

OpenSpec 2.0.0 removes the `/opsx:*` commands: a repository updated to it keeps only the skills (`.claude/skills/openspec-*`, linked to `.agents/skills/`). Proposal preparation tells its agent to run `/opsx:propose`, so it breaks in every repository on OpenSpec 2.0, including this one once `chore/openspec-2` lands. Task repositories may stay on OpenSpec 1.x for a while, so the stage must work with both.

## What Changes

- **The proposal prerequisites find the propose workflow** in the task's repository, as the skill `openspec-propose` or as the command `/opsx:propose`. A repository with neither makes launch `wait`, with a reason naming both forms.
- **The proposal prompt names the workflow the repository provides**: the skill when it exists, the command otherwise. Every mention in the prompt (the AFK section, the lookup for an earlier change, the propose step) uses that name.
- **The `verify-runner` teammate** of this repository follows the `openspec-verify-change` skill instead of the removed `.claude/commands/opsx/verify.md`.
- **Docs.** The README's proposal stage sections name the workflow by both forms.
- **Release.** A `fix(autonomous):` patch, with no configuration change.

**Out of scope**:

- Updating OpenSpec in this repository (`chore/openspec-2`).
- The implementation stage (DOT-139), which builds on the detection this change adds.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `proposal-stage`: the prerequisites require the propose workflow as a skill or a command, and the prompt names the one the repository provides.

## Impact

- **Code** (`plugins/autonomous/src/stages/`): the proposal prerequisites and prompt, a small shared check for OpenSpec workflows that the implementation stage will reuse, and their tests.
- **Repository files**: `plugins/autonomous/README.md`; `.claude/agents/verify-runner.md` (agent scaffolding, outside the plugin).
- **Compatibility**: OpenSpec 1.x repositories keep working: they have the command, and usually the skill too.
