## Context

OpenSpec 1.x writes, for Claude Code, both the commands (`.claude/commands/opsx/<name>.md`) and the skills (`.claude/skills/openspec-<name>/SKILL.md`). OpenSpec 2.0.0 writes only the skills, under `.agents/skills/`, and links `.claude/skills/openspec-*` to them. Both forms answer the same workflow: the skill `openspec-propose` is what `/opsx:propose` runs. The proposal stage's prerequisites read the task's repository (its main checkout) before launch, and pass strings to the prompt through the stage context.

## Goals / Non-Goals

**Goals:**

- One check, reusable by later stages, that tells which form of an OpenSpec workflow a repository provides.
- A prompt that names exactly what the session can run.

**Non-Goals:**

- Reading the OpenSpec version, or supporting tools other than Claude Code.

## Decisions

### D1. The skill wins over the command

When a repository has both, the prompt names the skill (`openspec-propose`, invoked as `/openspec-propose`). The skill exists in both major versions, so a repository that moves from 1.x to 2.0 between two attempts still gets a name that works; the command is used only when the skill is absent.

*Alternative:* read `openspec --version`. Rejected: the CLI on the path is the machine's, not the repository's, and the files are what the session actually sees.

### D2. The check looks at files in the repository, following links

Each workflow maps to one skill and one command: `propose` to `openspec-propose` and `/opsx:propose`, `apply` to `openspec-apply-change` and `/opsx:apply`, `update` to `openspec-update-change` and `/opsx:update`. The skill is present when `.claude/skills/<skill>/SKILL.md` exists, following symbolic links, since OpenSpec 2.0 makes that directory a link. The command is present when `.claude/commands/opsx/<name>.md` exists. The result, the name to write in the prompt, reaches the prompt through the stage context, so the prompt file keeps the exact name the agent was given.

### D3. `verify-runner` points at the skill's file

The agent follows `.claude/skills/openspec-verify-change/SKILL.md`, which exists on both versions in this repository.

## Risks / Trade-offs

- [The workspace branch could carry a different OpenSpec setup from the repository's main checkout] → The workspace branch starts from the main branch, so they match except while an OpenSpec update is in flight; the next attempt reads the repository again.
