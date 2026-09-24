# daily-agentic-task-force

A Claude Code plugin marketplace. Nothing else lives here — no application
code, no libraries. Every directory under `plugins/` is a plugin published to
consumers through `.claude-plugin/marketplace.json`.

It is the agentic counterpart to [`monolab`](https://github.com/pabloimrik17/monolab),
which keeps the application code and publishes its own, separate marketplace.

## Add the marketplace

```bash
/plugin marketplace add pabloimrik17/daily-agentic-task-force
/plugin install datf-lab@daily-agentic-task-force
```

Installs are keyed `<plugin>@<marketplace>`, so plugins from different
marketplaces coexist on disk. Command invocation is **not** namespaced by
marketplace — commands surface as `datf-lab:hello`, with no marketplace
qualifier. Plugin names published here must therefore not collide with plugins
a user is likely to have enabled from elsewhere; that is why the staging plugin
is `datf-lab` and not `experiments`, which `monolab` already publishes.

## Plugins

| Plugin     | Version | Purpose                                               |
| ---------- | ------- | ----------------------------------------------------- |
| `datf-lab` | 0.1.0   | Staging area for skills and commands under validation |

## Plugin lifecycle

New material starts in `datf-lab` as soon as it is worth trying on real work.
It leaves one of two ways:

- **Promoted** — used on real work more than once, scope has stopped changing,
  and it belongs to a coherent group. It moves into its own plugin or an
  existing one, and both plugins' versions move in the same change.
- **Deleted** — everything else. Most things are deleted; that is the point of
  having a lab.

The `promoting-from-lab` skill inside `datf-lab` carries the step-by-step for
both exits.

## Versioning

Versions are driven by release-please from conventional commits. Only plugins
are versioned — the repository itself carries no version and no changelog. Tags
read `datf-lab--v0.1.0`, so each plugin versions independently.

A release bumps a plugin's version in three places at once:

1. `plugins/<name>/.claude-plugin/plugin.json`
2. `plugins/<name>/package.json`
3. that plugin's entry in `.claude-plugin/marketplace.json`

**These three must always agree.** A disagreement means consumers are offered a
version that differs from the one they receive. `bun run lint:marketplace`
enforces it, and CI fails the change if they drift.

## Working on this repository

Bun is the runtime and the package manager; the version is pinned in
`.bun-version`.

```bash
bun install
```

| Command                    | What it checks                                         |
| -------------------------- | ------------------------------------------------------ |
| `bun run lint:oxfmt`       | Formatting (`:fix` to apply)                           |
| `bun run lint:eslint`      | ESLint, including type-aware rules                     |
| `bun run lint:markdown`    | Markdown                                               |
| `bun run lint:knip`        | Unused files, exports and dependencies                 |
| `bun run lint:fallow`      | Dead code, full repository                             |
| `bun run lint:marketplace` | Marketplace consistency and version agreement          |
| `bun run lint:types`       | TypeScript                                             |
| `bun run test`             | Vitest, across repo scripts and every plugin workspace |

Commits are gated by husky: `validate-branch-name` and `lint-staged` on
pre-commit, `commitlint` on commit-msg. Branches must match
`main`, `develop`, or `<feature|fix|hotfix|chore|renovate>/<name>`.

## Adding a plugin

1. `mkdir -p plugins/<name>/.claude-plugin`
2. Write `plugins/<name>/.claude-plugin/plugin.json` — name, version `0.1.0`,
   description, author, license, repository, homepage.
3. Write `plugins/<name>/package.json` — private, name-scoped, same version.
4. Add a `plugins[]` entry to `.claude-plugin/marketplace.json` with the same
   name, `./plugins/<name>` as source, and the same version.
5. Add matching entries to `release-please-config.json` and
   `.release-please-manifest.json`.
6. Run `bun run lint:marketplace`.

Step 6 is not optional: a plugin directory that exists but is unlisted fails
validation, and so does one whose three versions disagree.
