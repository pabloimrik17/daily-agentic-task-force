---
name: promoting-from-lab
description: Use when a skill or command living in the datf-lab staging plugin has proven useful and should be promoted into its own plugin or an existing one, or has proven useless and should be deleted. Covers moving the files, updating both plugins' manifests, and keeping the marketplace entry in sync.
---

# Promoting material out of datf-lab

`datf-lab` is a holding area, not a home. Everything in it is provisional:
material that proves useful is promoted out, material that does not is deleted.
Nothing is meant to stay indefinitely.

This skill covers both exits.

## When to promote

Promote when all of these hold:

- the skill or command has been used on real work more than once
- its scope is stable — the last few edits were refinements, not rewrites
- it belongs to a coherent group, either an existing plugin or a new one worth
  publishing on its own

If any of those fail, leave it in the lab or delete it.

## Promote into an existing plugin

1. Move the directory: `git mv plugins/datf-lab/skills/<name> plugins/<target>/skills/<name>`
   (or `commands/<name>.md` for a command).
2. Update any `${CLAUDE_PLUGIN_ROOT}`-relative paths inside the moved files —
   the plugin root changes, so references to sibling skills or scripts move with
   it.
3. Update the invocation namespace anywhere it is written down: the prefix
   becomes `<target>:` instead of `datf-lab:`.
4. Note the removal in `plugins/datf-lab/CHANGELOG.md` and the addition in the
   target plugin's changelog. Release-please writes both from the commit
   messages, so use `feat:` or `fix:` scoped to each plugin.

## Promote into a new plugin

Create the plugin first, then move the material into it:

1. `mkdir -p plugins/<new>/.claude-plugin`
2. Write `plugins/<new>/.claude-plugin/plugin.json` with `name`, `version`
   `0.1.0`, description, author, license, repository, and homepage.
3. Write `plugins/<new>/package.json` — private, name-scoped, same version.
4. Add a `plugins[]` entry to `.claude-plugin/marketplace.json` with the same
   name, `./plugins/<new>` as its source, and the same version.
5. Add a `packages` entry to `release-please-config.json` mirroring the
   `plugins/datf-lab` block, with the JSONPath filter pointing at the new name.
6. Add the new path to `.release-please-manifest.json` at `0.1.0`.
7. Move the material as described above.

Then run `bun run lint:marketplace`. It fails if the three recorded versions
disagree, or if the new directory exists but is not listed.

## Delete

Deleting is the common case and needs no ceremony:

1. `git rm -r plugins/datf-lab/skills/<name>`
2. Record it in the commit message as `chore(datf-lab): drop <name>`.

Do not leave a tombstone file or a commented-out entry. The lab is allowed to
forget.

## Check before committing

- `bun run lint:marketplace` — every plugin resolves and every version agrees
- `bun run lint:markdown` — the moved Markdown still lints under its new path
- `bun run test` — plugin tests still discover under the new workspace
