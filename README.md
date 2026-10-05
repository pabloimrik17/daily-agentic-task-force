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

| Plugin       | Purpose                                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------------------------- |
| `autonomous` | Autonomous loop entry point — gate steps, starting with a Claude quota gate                                |
| `datf-lab`   | Staging area for skills and commands under validation                                                      |
| `stonks`     | Swing-trading bookkeeping — reconciles mirrors against IBKR and keeps the Simply Wall St watchlist in step |

Current versions live in `.claude-plugin/marketplace.json`, which release-please
keeps up to date.

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
| `bun run typecheck`        | TypeScript                                             |
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
   name, `./plugins/<name>` as source, the same version, and a description.
5. Add matching entries to `release-please-config.json` and
   `.release-please-manifest.json`.
6. Run `bun run lint:marketplace`.

Step 6 is not optional: a plugin directory that exists but is unlisted fails
validation, and so does one whose three versions disagree.

## Stonks OAuth documentation site

`docs/` contains the public homepage and privacy policy for **Stonks personal**,
whose plugin is in development. These static pages support the personal Google
Sheets OAuth setup; they do not collect portfolio data.

To publish after merging the pages, open repository **Settings → Pages**, select
**Deploy from a branch**, choose **main** and **/docs**, and save. The expected URLs
are:

- Homepage: <https://pabloimrik17.github.io/daily-agentic-task-force/>
- Privacy policy: <https://pabloimrik17.github.io/daily-agentic-task-force/privacy.html>

Use those URLs in Google Auth Platform's Branding settings only once they are
publicly reachable. Google decides whether the OAuth branding meets its
requirements; hosting the pages does not guarantee approval.

If Google requests ownership verification, use the same Google account that owns
the OAuth project to add the homepage as a **URL-prefix** property in Search
Console. Choose HTML-file or HTML-tag verification, publish the exact file in
`docs/` or add the supplied tag to `docs/index.html`, then verify. Keep the file or
tag present afterward. This verifies the project site rather than the entire
`github.io` domain.

Review the privacy policy whenever the plugin's data handling changes, including
AI-provider processing and local storage. Keep the OAuth app name consistent with
**Stonks personal** on these pages.
