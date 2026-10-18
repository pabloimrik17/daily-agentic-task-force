# Optional config blocks with shipped defaults

Stage sessions need three settings that did not exist before: `sessions` (the
tool, the session manager's profile, the agent binary), `workspace` (the root
that holds the repositories) and `naming` (the model and effort that name a
session). We decided that these blocks are optional. The plugin ships
`config.defaults.json`, and each key missing from the user's file takes the
shipped value, key by key. The run reports the keys that took a default. A key
that is present is still validated strictly: an unknown or mistyped key is an
error naming its path. `selection` stays required, because it was added in
DOT-108 together with a coordinated dotfiles migration and has no sensible
default for every user. The schema id stays `autonomous.config.v1`, so an
existing file still parses.

## Considered Options

- **Make the new blocks required and release a major version with a
  migration.** Rejected: the plugin would fail on every machine until the
  dotfiles change lands, for settings that have an obvious default.
- **Write the defaults into the user's file.** Rejected: the file is managed by
  chezmoi from the dotfiles repository, which is the source of truth, so a
  write by the plugin would clash with it or be overwritten.

## Consequences

- Existing configuration files keep working, and the change needs no dotfiles
  migration. A user adds a `sessions`, `workspace` or `naming` key only to
  differ from the default.
- The report lists the keys that took a default, so the user can see which
  settings they did not choose.
- The loader checks the user's file for unknown keys before it fills the
  defaults, so a typo is never replaced silently by the default.
- Optional blocks with defaults and the required `selection` block now
  coexist in the same file.
