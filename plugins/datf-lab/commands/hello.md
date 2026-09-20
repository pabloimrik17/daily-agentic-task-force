---
description: Confirm the datf-lab plugin is installed and report where its commands and skills resolve from
---

# datf-lab-hello

Smoke test for the `datf-lab` plugin. Confirms the plugin resolved from the
`daily-agentic-task-force` marketplace and that its command namespace is
reachable, without touching the working tree.

## Steps

1. Report the plugin root from `${CLAUDE_PLUGIN_ROOT}`.
2. Read `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` and report the
   plugin's `name` and `version`.
3. List the command files under `${CLAUDE_PLUGIN_ROOT}/commands/` and the skill
   directories under `${CLAUDE_PLUGIN_ROOT}/skills/`.
4. Confirm the command namespace is `datf-lab:`, not `experiments:` — the two
   marketplaces can be enabled at the same time and must not overlap.

## Output

A single block reporting:

- plugin name and version, and whether they match the marketplace entry
- the commands and skills the plugin currently ships
- the namespace under which they were invoked

Make no file changes. This command is read-only.
