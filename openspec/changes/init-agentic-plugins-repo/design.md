## Context

See `proposal.md` — Why. The repository currently contains only OpenSpec scaffolding (`openspec/`, `.agents/`, `.claude/`, `.junie/`, `.opencode/`, `.pi/`) on a single commit; there is no manifest, no `package.json`, and no CI.

Two sibling repositories constrain the approach, and both were surveyed before deciding:

- **`monolab`** — a pnpm + nx monorepo carrying the heavier stack (eslint, knip, stylelint, markdownlint, vitest, stryker, codecov, release-please, husky, lint-staged, commitlint, validate-branch-name, fallow, oxfmt, renovate). It already hosts three Claude Code plugins under `claude-plugins/` and releases them with release-please. Its release configuration is the only part of its stack that is directly reusable here.
- **`dotfiles`** — a bun repository with a deliberately small stack (oxfmt, fallow, husky, lint-staged, commitlint, renovate) and a ~40-line CI workflow. Its shape, not `monolab`'s, is the right size for this repository.

Three findings from that survey shape the design and are worth recording, because each one invalidates an obvious shortcut:

1. **`monolab`'s analyzer configs cannot be copied.** Its `.fallowrc.json` lists `claude-plugins/**` in `ignorePatterns`, and its `knip.config.ts` declares no workspace for them. Neither analyzer has ever run against plugin code. Here, plugins *are* the codebase, so both configs must be written from scratch rather than adapted.
2. **Test discovery does not cover `.mjs` by default.** `bun test`'s built-in glob is `**{.test,.spec,_test_,_spec_}.{js,ts,jsx,tsx}`; `monolab`'s plugin tests are all `*.test.mjs`, which is precisely why that plugin needs a `vitest.config.mjs` with an explicit `include`. A naive setup here would report green having executed nothing.
3. **Most plugins have no code at all.** Of `monolab`'s three plugins, two (`commander`, `expo-developer`) contain zero JavaScript; only `experiments` has scripts. The toolchain must stay green on a Markdown-only repository.

Runtime is fixed at bun 1.3.14, matching `dotfiles`.

## Goals / Non-Goals

**Goals:**

- A marketplace consumers can add today, with one installable plugin proving the path end to end.
- Quality gates that are green on the seeded repository and meaningful the moment real code lands.
- Version synchronization enforced mechanically, not by discipline.
- A toolchain a reader can hold in their head — closer to `dotfiles`' 40 lines of CI than `monolab`'s 16KB nx matrix.

**Non-Goals:**

- Multi-agent-host support. Plugins target Claude Code only; the OpenSpec scaffolding for other hosts is pre-existing and stays untouched.
- Build or bundling. Nothing here compiles; there is no `dist/`, no `composite`, no project references.
- Coverage measurement. Excluded deliberately — see Decisions.
- Migrating anything out of `monolab`.

## Decisions

### Plugin naming: `datf-lab`, not `experiments`

Claude Code keys installs as `<plugin>@<marketplace>`, so two same-named plugins from different marketplaces coexist on disk. But the *invocation* namespace is the bare plugin name — commands surface as `experiments:npm-update-patch`, with no marketplace qualifier. Publishing a second `experiments` would make the two indistinguishable at the call site for anyone with both marketplaces enabled.

`datf-lab` derives from the marketplace name (**d**aily **a**gentic **t**ask **f**orce) plus the staging role.

*Alternatives:* reuse `experiments` and never enable both (a latent trap — it fails the first time a skill from each is wanted together); rename `monolab`'s plugin instead (breaks its existing release tags for no benefit here).

### Both knip and fallow, with a shared 40-issue margin

The two overlap substantially on dead code and unused dependencies, and running both means the same finding is reported twice. That duplication is accepted rather than divided, because splitting responsibilities (fallow for the PR ratchet, knip for dependency checks only) adds configuration that has to be kept true as both tools evolve.

The `--max-issues 40` margin is inherited from `monolab` and applies to both.

*Alternatives:* fallow alone (simpler, and it is what `dotfiles` uses — the fallback if the duplicate reporting proves noisy); an explicit split of concerns.

### ESLint with type-aware rules, and a `tsconfig.json` that makes it real

Type-aware linting needs the linted files inside a TypeScript project. `monolab` excludes `**/*.config.{ts,mts,cts}` and `eslint.config.ts` from its type-aware block — copying that here would leave type-aware linting covering essentially nothing, since root config files are nearly all the TypeScript that exists at seed time.

So: a single root `tsconfig.json` with `include: ["**/*.ts"]`, `moduleResolution: "bundler"`, `types: ["bun"]`, `noEmit: true`, `strict: true`, and no `composite` or project references (nothing builds). `projectService: true` with `tsconfigRootDir` then covers root configs and all of `plugins/**/*.ts`. `.mjs` and `.cjs` files cannot participate and go under `disableTypeChecked`.

The `tsconfig.json` earns its place independently of linting: knip uses it to resolve imports, and without it editors do not type the `satisfies` annotations on the config files.

*Alternatives:* no type-aware linting (a shorter config, but then the `tsconfig.json` exists only for knip); copying `monolab`'s exclusions (type-aware in name only).

### Vitest, single root config, with the validation script as its first subject

A test runner is configured now even though plugin content is Markdown, so the validation script ships with tests rather than acquiring them later.

The configuration is one root `vitest.config.ts` using `projects`: an inline project for `scripts/**/*.test.ts`, plus the `plugins/*` glob so each plugin workspace is picked up as it gains code. `monolab` uses a config per plugin because nx invokes targets per project; without nx that fragmentation buys nothing.

Both `vitest` and `bun test` exit non-zero when no test files are found, so the repository must ship at least one real test — `scripts/validate-marketplace.test.ts` — rather than passing `--passWithNoTests`. A tolerant flag would convert "test discovery is broken" into a silent pass, which is the failure mode finding 2 describes.

New plugin code is written in `.ts`, not `.mjs`, so default discovery covers it.

*Alternatives:* `bun test` (zero dependencies, and the natural choice given the runtime — rejected only for parity with `monolab`); no runner until code exists.

### Codecov excluded

Coverage is a ratio over executable lines, and this repository is overwhelmingly Markdown. A blocking patch target would fail changes for having no coverable code, and `monolab`'s per-package flag matrix is fourteen hand-maintained blocks. Revisit once plugins carry meaningful logic.

### Release-please, plugins only, with three-way version sync

`monolab`'s configuration is reused verbatim in shape: `release-type: "simple"` (nothing publishes to a registry), `tag-separator: "--"` and `include-v-in-tag: true` so tags read `datf-lab--v0.1.0` and plugins version independently, and `extra-files` updating `.claude-plugin/plugin.json`, `package.json`, and the plugin's entry in the root `.claude-plugin/marketplace.json` via a JSONPath filter.

The root is not a release-please package: the repository has no version and no changelog. Consistently, `metadata.version` is omitted from the marketplace manifest — `monolab` pins it to `0.1.0` and never updates it, so the field only misleads.

`bootstrap-sha` is set to the OpenSpec scaffolding commit so the first changelog does not absorb pre-init history.

### Marketplace validation as an owned script

Release-please updates three files per release through independent `extra-files` rules; a JSONPath that stops matching after a rename fails silently, leaving the marketplace advertising a version the plugin does not carry. `scripts/validate-marketplace.ts` closes that loop by checking agreement in both directions — every listed plugin resolves to a manifest, and every plugin directory is listed — and reporting all problems in one run rather than stopping at the first.

This is the one gate `monolab` lacks, and the only failure here that breaks consumers rather than contributors.

### Bun workspaces with a `package.json` per plugin

A Claude Code plugin needs only `.claude-plugin/plugin.json` to function; the package manifest exists so plugins can carry scripts and tests, and so release-please has a second version anchor. The cost is roughly six lines per plugin.

### Branch and commit conventions

`validate-branch-name` pattern: `^(main|develop)$|^(feature|fix|hotfix|chore|renovate)/.+$|^release-please--branches--.+$`. Pruned from `monolab`'s (dropping `master`, `pre`, `release`, `bugfix`), with `chore/` added because a tooling repository generates branches that are neither feature nor fix. `develop` is retained for future use though only `main` exists today.

## Risks / Trade-offs

- **Duplicate dead-code findings from knip and fallow** → Accepted knowingly. Both carry the same 40-issue margin; if the noise outweighs the value, drop knip and keep fallow, which has the GitHub Action with PR comments.
- **Type-aware linting is slower and needs every linted `.ts` inside the project** → A file added outside `include: ["**/*.ts"]` fails the parser rather than being skipped quietly, so the failure is loud and local.
- **The 40-issue margin is imported debt on an empty repository** → It permits up to 40 findings before failing, which on a repository this size is effectively no gate. Tighten toward zero once the real baseline is known.
- **A Markdown-only repository leaves eslint, knip, and vitest gating almost nothing at seed time** → They are configured now so the first real code lands on working gates instead of retrofitting them; the validation script and its test give each one at least one genuine subject.
- **Ignore lists must cover the agent scaffolding** (`openspec/`, `.agents/`, `.claude/`, `.junie/`, `.opencode/`, `.pi/`) **in five separate places** — eslint, knip, fallow, markdownlint, oxfmt → Divergence between them shows up as one tool failing on files the others skip. Keep the lists identical.
- **`datf-lab` is fixed at first release** → The name is written into the directory, the manifests, every command prefix, and the release tags. Renaming after the first tag orphans it.
- **Existing local branches not matching the pattern will be rejected at commit time** → Rename before the first commit; `feature/init-repo` already conforms.

## Migration Plan

Not applicable — this is the repository's first substantive change. There is nothing to migrate and no consumers to break.

Rollback is `git revert` of the initialization commit; nothing is published to a registry, and no release tag is created until a plugin change lands on `main`.

## Open Questions

None. The design decisions above were settled before drafting; nothing outstanding would alter the specs, the approach, or the task breakdown.
