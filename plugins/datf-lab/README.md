# datf-lab

Staging plugin for the `daily-agentic-task-force` marketplace. It holds skills
and commands that are still being validated.

**Its contents are provisional.** Anything here is either on its way out to a
plugin of its own, or on its way to being deleted. Do not build workflows that
assume a `datf-lab:` command will still exist next month.

## Install

```bash
/plugin marketplace add pabloimrik17/daily-agentic-task-force
/plugin install datf-lab@daily-agentic-task-force
```

The plugin is deliberately not named `experiments`: the sibling `monolab`
marketplace already publishes a plugin under that name, and Claude Code
namespaces commands by the bare plugin name. Two enabled `experiments` plugins
would collide at `/experiments:*`.

## Contents

| Kind    | Name                 | Purpose                                                             |
| ------- | -------------------- | ------------------------------------------------------------------- |
| Command | `datf-lab:hello`     | Smoke test — confirms the plugin resolved and reports its namespace |
| Skill   | `promoting-from-lab` | How to promote material out of the lab, or delete it                |

## Lifecycle: promote or delete

Material enters the lab as soon as it is worth trying on real work. It leaves
one of two ways.

**Promoted** when it has been used on real work more than once, its scope has
stopped changing, and it belongs to a coherent group — either an existing plugin
or a new one worth publishing. Promotion moves the files, updates both plugins'
manifests, and adds or updates the marketplace entry. Both plugins' versions
move in the same change: one gains the material, the other loses it.

**Deleted** otherwise. Most things are deleted, and that is the point of having
a lab. No tombstone files, no commented-out entries.

The `promoting-from-lab` skill carries the step-by-step for both exits.

## Versioning

Versions are driven by release-please from conventional commits scoped to this
plugin. A release bumps the version in three places at once:
`.claude-plugin/plugin.json`, `package.json`, and this plugin's entry in the
root `.claude-plugin/marketplace.json`. Tags read `datf-lab--v0.1.0`, so this
plugin versions independently of the repository and of any sibling plugin.

`bun run lint:marketplace` fails the build if those three ever disagree.
