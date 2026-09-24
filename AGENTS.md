# Agent instructions

This repository is a Claude Code plugin marketplace. There is no application
code and no library code. Everything under `plugins/` is a published plugin;
everything at the root is the toolchain that gates them.

## Package manager

**bun**, pinned in `.bun-version`. Never use npm, yarn or pnpm.

| npm                    | bun                             |
| ---------------------- | ------------------------------- |
| `npm install`          | `bun install`                   |
| `npm install <pkg>`    | `bun add <pkg>`                 |
| `npm install -D <pkg>` | `bun add -d <pkg>`              |
| `npm uninstall <pkg>`  | `bun remove <pkg>`              |
| `npm run <script>`     | `bun run <script>`              |
| `npx <cmd>`            | `bunx <cmd>`                    |
| `npm ci`               | `bun install --frozen-lockfile` |

Dependencies are pinned exact. No caret or tilde ranges — renovate manages
updates with `rangeStrategy: "pin"`.

## The version-sync invariant

A plugin's version is recorded in three files, and they must always agree:

1. `plugins/<name>/.claude-plugin/plugin.json`
2. `plugins/<name>/package.json`
3. that plugin's entry in `.claude-plugin/marketplace.json`

A disagreement means consumers are offered a version that differs from the one
they receive. Release-please updates all three in one release commit; if you
change a version by hand, change all three.

Run `bun run lint:marketplace` after touching any manifest. It also fails when
a plugin directory exists but is unlisted, and when a plugin's manifest name
disagrees with the name it is listed under.

**Never bump a version by hand to make a release.** Releases come from
conventional commits via release-please. The repository itself carries no
version and no changelog — only plugins are versioned.

## Plugin conventions

- One directory per plugin under `plugins/`. The directory name, the `name` in
  `plugin.json`, and the marketplace entry name are the same string.
- Plugin names must not collide with plugins published by sibling marketplaces.
  Claude Code namespaces commands by the bare plugin name, so a second
  `experiments` would be indistinguishable from `monolab`'s at the call site.
  This is why the staging plugin is `datf-lab`.
- Every plugin carries a `package.json` (private, name-scoped) so it can hold
  scripts and tests, and so release-please has a second version anchor.
- New plugin code is written in `.ts`, never `.mjs`. Default test discovery
  does not match `*.test.mjs`, so a `.mjs` test suite reports green having
  executed nothing.
- `datf-lab` is a staging area. Material in it is promoted into its own plugin
  or deleted; nothing is meant to stay. See its `promoting-from-lab` skill.

## Toolchain

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

Type-aware linting is real here: the root `tsconfig.json` uses
`include: ["**/*.ts"]` with no exclusions for config files, so a new `.ts` file
outside that glob fails the parser rather than being skipped quietly.

The agent scaffolding — `openspec/`, `.agents/`, `.claude/`, `.junie/`,
`.opencode/`, `.pi/` — is excluded from oxfmt, ESLint, knip, fallow and
markdownlint. Those five ignore lists must stay identical; divergence shows up
as one tool failing on files the others skip.

## Commits

Conventional commits, enforced by commitlint on commit-msg. Branch names are
enforced on pre-commit: `main`, `develop`, or
`<feature|fix|hotfix|chore|renovate>/<name>`.

Scope plugin changes to the plugin (`feat(datf-lab): ...`) so release-please
attributes them to the right changelog.

## Not used here

- **No beads database.** Task tracking for this repository lives in
  `openspec/changes/`, not in a local issue database.
- **No `.mcp.json`.** This repository configures no MCP servers.
- **No Codecov.** The repository is overwhelmingly Markdown; a coverage gate
  would block changes for reasons unrelated to quality. Revisit once plugins
  carry meaningful logic.
