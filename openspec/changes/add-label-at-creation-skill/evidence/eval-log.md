# Creation-time label eval log

## Probe, 2026-09-28

The temporary `probe-config` case ran with `--runs 1 --ablation none --scaffold --max-cost-usd 0.30 --allow-tools 'Bash(*)' --no-publish --trust-plugin --keep-temp`. Its script created `$HOME/.config/autonomous/config.json` in the eval home. The isolated agent ran `bun` against the helper in this worktree, which is under the real home directory, and reported `scope: derived personal (every linear task is personal)`. The result grader scored 1.0, cost $0.0885954, and `error` was null. The temporary probe case was deleted. A permanent `linear-rule` case covers the seeded rule; Beads cases also seed a temporary database and configuration.

Chosen suite invocation (use a cost ceiling for each run):

```bash
claude plugin eval plugins/autonomous --scaffold --allow-tools 'Bash(*)' --model <pinned-model> --max-cost-usd <ceiling> --no-publish --trust-plugin
```

An earlier dry probe using only the narrow grants from design D4 blocked `which bd` and a project read before any create call. A broad Bash grant is needed for this suite because the isolated agent inspects its temporary tracker before creating. That run had no `error` but scored 0, at $0.1045618. A second probe with `Bash(*)` reached the helper, but found no Beads database and stopped before `bd create` (score 0.3333333, cost $0.2370992, `error` null). The permanent Beads cases therefore scaffold a database in the isolated workspace.

## RED suite, first saved-trace run
Command: `claude plugin eval plugins/autonomous --ablation with-without --runs 1 --scaffold --model claude-sonnet-5 --max-cost-usd 5 --allow-tools "Bash(*)" --no-publish --trust-plugin --keep-temp`. All 16 runs had `error: null`. The original explicit-label GitHub case was replaced before this run because its no-plugin arm had passed. The two conflict graders were subsequently consolidated and checked again in a targeted run.

### beads-work-afk

**with** — score 0.000; cost $0.138824; error `None`; graders: criteria=fail, helper-ran=fail, skill-fired=fail.

Attempted create command(s):

~~~~text
git config beads.role contributor 2>&1
bd create "Add a retry when the Nazaries sync job times out" \
  --type task \
  --priority 2 \
  --description "The Nazaries sync job currently fails outright when it times out, with no retry attempt. Add retry logic (with backoff) so a single timeout doesn't fail the whole sync.

Locate the Nazaries sync job implementation in this codebase first (search for 'Nazaries' or 'sync job'), then:
- Add a bounded number of retries (e.g. 3 attempts) specifically on timeout errors, with backoff between attempts.
- Ensure non-timeout failures are not retried (fail fast as before).
- Log each retry attempt.
- Add/adjust tests covering: timeout triggers a retry, success after a retry, and exhausting retries still surfaces a failure." \
  --acceptance "- Sync job retries on timeout instead of failing immediately.
- Retry count is bounded and uses backoff between attempts.
- Non-timeout errors still fail without retrying.
- Tests cover retry-then-succeed and retry-exhaustion-then-fail scenarios, and pass in CI.
- Behavior verified by running the test suite (and/or reproducing a simulated timeout) before marking done." \
  --silent 2>&1
~~~~

Final message:

~~~~text
Created **eval-s36**: "Add a retry when the Nazaries sync job times out" (task, P2). It includes a description and acceptance criteria (bounded retries with backoff on timeout only, retry logging, and test coverage) so an agent can locate the job, implement, and verify it independently.
~~~~

**without** — score 0.000; cost $0.119462; error `None`; graders: criteria=fail.

Attempted create command(s):

~~~~text
bd create "Add a retry when the Nazaries sync job times out" \
  --type task \
  --description "The Nazaries sync job currently fails outright when it times out. Add retry logic so a timeout triggers a bounded number of retries (with backoff) instead of an immediate failure." \
  --notes "Cleared for autonomous execution: the assignee agent may implement and verify this without checking back with the requester first." \
  --silent
~~~~

Final message:

~~~~text
Created **eval-b2g**: "Add a retry when the Nazaries sync job times out" (task, P2, OPEN), with a description of the fix and a note that it's cleared for autonomous implementation/verification.
~~~~

### comment-negative

**with** — score 1.000; cost $0.071232; error `None`; graders: criteria=pass, skill-absent=pass.

Attempted create command(s):

None.

Final message:

~~~~text
I don't have a Linear integration available in this session (no Linear MCP tool or CLI is configured), so I can't post that comment on DOT-12 directly. You'll need to add it yourself, or let me know if there's a Linear CLI/API token you'd like me to use via `curl`.
~~~~

**without** — score 1.000; cost $0.071244; error `None`; graders: criteria=pass, skill-absent=pass.

Attempted create command(s):

None.

Final message:

~~~~text
I don't have access to a Linear integration in this session — there's no Linear MCP tool available, and I don't have network access to Linear's API directly. I can't post the comment on DOT-12 myself.

To do this, you'd need to either connect a Linear MCP server/integration to Claude Code, or post the comment manually. Let me know if you'd like help setting up the Linear integration.
~~~~

### entry-conflict

**with** — score 0.500; cost $0.095470; error `None`; graders: criteria=pass, helper-ran=fail, invalid-pair-absent=fail, skill-fired=fail.

Attempted create command(s):

~~~~text
bd create "Check the release notes" --labels AFK,HITL
~~~~

Final message:

~~~~text
Created `eval-azt` — "Check the release notes", tagged with `AFK` and `HITL`.
~~~~

**without** — score 0.500; cost $0.087155; error `None`; graders: criteria=pass, invalid-pair-absent=fail.

Attempted create command(s):

~~~~text
bd create "Check the release notes" -l AFK,HITL --silent
~~~~

Final message:

~~~~text
Created issue `eval-o1p`: "Check the release notes", tagged with `AFK` and `HITL`.

(Note: bd printed a warning that `beads.role` isn't configured on this repo — harmless, but let me know if you'd like me to set it.)
~~~~

### github-scope-conflict

**with** — score 0.500; cost $0.067271; error `None`; graders: criteria=pass, helper-ran=fail, invalid-pair-absent=fail, skill-fired=fail.

Attempted create command(s):

~~~~text
gh issue create --repo pabloimrik17/daily-agentic-task-force --title "Review my home backup plan" --label "work,personal,HITL" --body ""
~~~~

Final message:

~~~~text
`gh` isn't authenticated in this environment — I hit "run `gh auth login`" with no `GH_TOKEN` set, and I can't run interactive login for you. Please either run `gh auth login` yourself or provide a `GH_TOKEN` with access to `pabloimrik17/daily-agentic-task-force`, and I'll create the issue with title "Review my home backup plan" and labels `work`, `personal`, `HITL`.
~~~~

**without** — score 0.500; cost $0.070851; error `None`; graders: criteria=fail, invalid-pair-absent=pass.

Attempted create command(s):

None.

Final message:

~~~~text
I'm not authenticated to GitHub in this environment — `gh auth status` shows no logged-in host and there's no `GH_TOKEN` set. I can't create the issue without credentials.

To proceed, either:
- run `gh auth login` yourself in this environment, or
- provide a `GH_TOKEN` with access to `pabloimrik17/daily-agentic-task-force`

Once authenticated, I'll create the issue titled "Review my home backup plan" with labels `work`, `personal`, and `HITL` (I'll also verify those labels exist on the repo first, creating any that are missing).
~~~~

### grill-me-spelling

**with** — score 0.500; cost $0.069562; error `None`; graders: criteria=fail, helper-ran=fail, invalid-pair-absent=pass, skill-fired=fail.

Attempted create command(s):

None.

Final message:

~~~~text
No Linear integration is available in this session — there's no Linear tool or MCP connector I can access. I can't create the issue for you here. You'd need to either connect a Linear MCP server/integration to this session, or create it directly in Linear yourself.
~~~~

**without** — score 0.500; cost $0.069593; error `None`; graders: criteria=fail, invalid-pair-absent=pass.

Attempted create command(s):

None.

Final message:

~~~~text
I don't have access to a Linear integration/tool in this environment — there's no Linear MCP tool available to search or invoke. I can't create the issue directly.

You'll need to either connect a Linear MCP server/tool for this session, or create it manually. If it helps, here's the content ready to paste:

- **Title:** Figure out what the new dashboard should show
- **Label/Tag:** Grill Me
~~~~

### linear-rule

**with** — score 0.000; cost $0.069948; error `None`; graders: criteria=fail, helper-ran=fail, skill-fired=fail.

Attempted create command(s):

None.

Final message:

~~~~text
I don't have a Linear integration available in this session (no Linear tool or MCP connection is configured), so I can't create the issue directly.

To get this set up, you'd need to connect a Linear MCP server/integration to Claude Code. Once that's available, I can create the issue titled "Review the layout of my home office" for you.
~~~~

**without** — score 0.000; cost $0.069489; error `None`; graders: criteria=fail.

Attempted create command(s):

None.

Final message:

~~~~text
I don't have a Linear integration available in this session (no Linear MCP tool is connected), so I can't create the issue directly. You'd need to connect a Linear MCP server/tool first, or create it manually with title "Review the layout of my home office".
~~~~

### linear-unclear-entry

**with** — score 0.000; cost $0.091800; error `None`; graders: create-attempted=fail, criteria=fail, helper-ran=fail, skill-fired=fail.

Attempted create command(s):

None.

Final message:

~~~~text
No Linear integration is available in this session — I don't have a Linear MCP tool or API access connected, and there's no `linear` CLI on this machine that I can use to create issues on your behalf.

To create it yourself, here's the issue as you'd want it:

**Title:** Decide how to organise the next research sprint
**Description:** Not yet decided whether an agent can proceed on this sprint alone or when direct involvement/review is needed — needs a decision before the sprint starts.

If you can connect a Linear MCP server (or share an API key) I can create it directly next time. Want me to check the `update-config` skill for wiring that up, or would you rather paste this into Linear yourself?
~~~~

**without** — score 0.000; cost $0.073288; error `None`; graders: create-attempted=fail, criteria=fail.

Attempted create command(s):

None.

Final message:

~~~~text
I don't have a Linear integration available in this session (no Linear MCP tool is connected), so I can't create the issue directly.

Since this is meant to flag that you haven't decided whether an agent can proceed alone, I want to check something before we go further: this smells like it might be a case where the issue itself should encode that undecided state (e.g., left unassigned, or with a "needs decision" label) rather than just having it in the title. But I can't inspect your Linear workspace's labels/states from here without the integration.

To move forward, you have a couple of options:
1. Connect a Linear MCP server/integration to this session so I can create the issue directly.
2. Tell me the issue details (team, description, any labels/priority) and I'll draft the exact content for you to paste into Linear yourself.

Which would you prefer?
~~~~

### pr-negative

**with** — score 1.000; cost $0.120947; error `None`; graders: criteria=pass, skill-absent=pass.

Attempted create command(s):

None.

Final message:

~~~~text
There's no remote configured, no commits, and no branches — this is an empty, freshly-initialized git repo with nothing committed. I can't open a pull request here because:

1. **No commits exist** — the `main` branch has nothing on it yet.
2. **No remote is configured** — there's no GitHub (or other) remote to push to or open a PR against.

There's also nothing to commit: the only untracked items (`.config/`, `.gitconfig`, `.npm/`) sit outside the repo directory itself, so they wouldn't be part of a PR from this repo anyway.

To proceed, I'd need: some committed work on a feature branch, and a configured remote pointing to a GitHub repo. Let me know if you want me to help set either of those up, or if you meant a different working directory.
~~~~

**without** — score 1.000; cost $0.111401; error `None`; graders: criteria=pass, skill-absent=pass.

Attempted create command(s):

None.

Final message:

~~~~text
I can't open a pull request here — there's nothing to open one for.

The working directory `/private/tmp/e-abS5Jo/home/cwd` is empty except for a `.claude` folder, and the git repo root turns out to be one level up at `/private/tmp/e-abS5Jo/home` (an ephemeral sandbox home directory, not a real project checkout). That repo has **no commits at all** ("No commits yet" on `main`), no remote configured, and the only untracked items are sandbox config/cache folders (`.config/`, `.gitconfig`, `.npm/`) — not application code.

There's no branch content and no GitHub remote to push to or open a PR against. If you intended this session to operate on a specific project repo, that repo doesn't appear to be mounted at this working directory — could you confirm the correct path or re-launch the session pointed at it?
~~~~

## RED conflict-grader correction
The first full RED attempt had a Beads run at the eight-turn cap (`error: exit 1`), and the explicit `personal` plus `HITL` GitHub case passed its result grader in the no-plugin arm. I raised the Beads turn limit, replaced that GitHub case with conflicting scopes, and reran the full suite with saved traces. A subsequent targeted grader check revealed that `bd create --help` matched a too-broad create grader. The final conflict graders require the task title and the safe label set. The targeted verification below has no errors and both result graders fail in both arms. Together with the unchanged positive cases in the full saved-trace run, every positive RED result grader fails in both arms.

### entry-conflict, corrected RED grader

**with** — score 0.000; cost $0.100983; error `None`; result grader fail.

Attempted create command(s):

~~~~text
bd create "Check the release notes" --labels AFK,HITL
~~~~

Final message:

~~~~text
Created **eval-e3w** — "Check the release notes", labeled `AFK` and `HITL`, P2/open.
~~~~

**without** — score 0.000; cost $0.084051; error `None`; result grader fail.

Attempted create command(s):

~~~~text
bd create "Check the release notes" -l AFK,HITL
~~~~

Final message:

~~~~text
Created issue **eval-4zl** — "Check the release notes" with labels `AFK` and `HITL`.

There's a warning that `beads.role` isn't configured — not blocking, but you may want to run `git config beads.role maintainer` (or `contributor`) to silence it going forward.
~~~~

### github-scope-conflict, corrected RED grader

**with** — score 0.000; cost $0.064986; error `None`; result grader fail.

Attempted create command(s):

~~~~text
gh issue create --repo pabloimrik17/daily-agentic-task-force --title "Review my home backup plan" --label "work,personal,HITL"
~~~~

Final message:

~~~~text
`gh` isn't authenticated in this environment. I need a valid GitHub credential to create the issue — either you run `gh auth login` here, or provide a `GH_TOKEN` (personal access token with repo scope) for me to use. Let me know how you'd like to proceed.
~~~~

**without** — score 0.000; cost $0.068365; error `None`; result grader fail.

Attempted create command(s):

~~~~text
gh issue create --repo pabloimrik17/daily-agentic-task-force --title "Review my home backup plan" --label "work" --label "personal" --label "HITL"
~~~~

Final message:

~~~~text
gh isn't authenticated in this session — running `gh issue create` failed with exit code 4, asking for `gh auth login` or a `GH_TOKEN` environment variable. I can't authenticate on your behalf; please run `gh auth login` (or set `GH_TOKEN`) and I can retry the issue creation.
~~~~

## GREEN first full suite, one run per arm
Command: `claude plugin eval plugins/autonomous --ablation with-without --runs 1 --scaffold --model claude-sonnet-5 --max-cost-usd 5 --allow-tools "Bash(*)" --no-publish --trust-plugin --keep-temp`. The earlier Beads-only smoke had score 1.0, `error: null`, cost $0.1310532, with `Skill` and helper both used; its create call was `bd create "Add a retry when the Nazaries sync job times out" --labels work,AFK`.

| Case | With | Without | Δ | Cost USD | Error | Skill fired |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| beads-work-afk | 0.00 | 0.00 | +0.00 | 0.2474 | none | True |
| comment-negative | 1.00 | 1.00 | +0.00 | 0.1843 | none | n/a |
| entry-conflict | 0.00 | 0.00 | +0.00 | 0.1900 | none | True |
| github-scope-conflict | 1.00 | 0.00 | +1.00 | 0.1935 | none | True |
| grill-me-spelling | 1.00 | 0.50 | +0.50 | 0.2223 | exit 1: Reached maximum number of turns (8) | True |
| linear-rule | 1.00 | 0.00 | +1.00 | 0.1956 | exit 1: Reached maximum number of turns (8) | True |
| linear-unclear-entry | 1.00 | 0.00 | +1.00 | 0.2476 | exit 1: Reached maximum number of turns (8) | True |
| pr-negative | 1.00 | 1.00 | +0.00 | 0.2287 | none | n/a |

Total estimated cost: $1.7094. This is diagnostic, not a passing GREEN run because some positives scored below 1.0 and three runs ended at the turn cap.

Classification and changes: `beads-work-afk` was a prompt clarity case: the agent honestly judged AFK at 0.9, under 0.95, and created with `work` only. The prompt now states unambiguously that no human input, review, or approval is needed. `entry-conflict` was a body failure: the agent loaded the skill, passed lowercase `afk`/`hitl` to `prepare`, then asked in its final text instead of creating. The body now requires exact contract casing and treats an absent `AskUserQuestion` tool as the create-and-report branch. The three Linear cases hit the eight-turn cap after helper and create calls; their caps are now 14. The `linear-unclear-entry` LLM grader passed all three judge votes, so there was no noisy judge to retry with `--judge-model sonnet`. No run showed an agent knowing the contract and then skipping the contract, so no rationalisation table or red flags were added.

## REFACTOR checks and account limit

The first `entry-conflict` retry still stopped after `prepare`, asking in plain text without calling `decide` or creating the task: score 0.667, cost $0.0783762, `error: null`. The skill body now requires `decide` for every prepared task, including conflicts, and makes the absence of the `AskUserQuestion` tool the create-and-report branch. The next single-case run scored 1.0, cost $0.1135504, `error: null`; its create call was `bd create "Check the release notes" --labels work`.

The following Beads retry ended with `error: exit 1: You've hit your monthly spend limit`; its score 0.333 and cost $0.0583054 are invalid evidence. The CLI said the session limit resets at 8:20 pm Europe/Madrid. Model-backed GREEN, reviewer, and interactive checks remain pending. No passing claim is drawn from this error.

After that reset, the same-account `beads-work-afk` retry (`--case beads-work-afk --ablation none --runs 1 --max-cost-usd 0.5`) exited 2 with a partial result. Its run had `error: exit 1: Not logged in · Please run /login`, score 0, and cost $0. `claude auth status` confirmed `loggedIn: false`, `authMethod: none`. This is an authentication blocker, not an eval failure or a passing result; the account must be logged in again before model-backed work can continue.

On 2026-09-30, after a new login (`claude auth status`: `loggedIn: true`, Claude Code 2.1.285), the same retry (`--case beads-work-afk --ablation none --runs 1 --scaffold --model claude-sonnet-5 --max-cost-usd 0.5 --allow-tools "Bash(*)"`) scored 1.0 in 6 turns, cost $0.150633, `error: null`. The `criteria` grader matched one `bd create` with `work` and `AFK`, `helper-ran` matched two helper calls, and `skill-fired` matched one `Skill` call. The run was not kept with `--keep-temp`, so its trace is not quoted here.

## Always-on cost and skill checklist

`claude --plugin-dir plugins/autonomous plugin details autonomous` reported about 124 always-on tokens with the skill versus 49 with the `run` command alone: an estimated **+75 tokens**. It reports about 80 always-on tokens for `labelling-new-tasks` (rounded per component) and about 1,000 on invocation.

Applicable `superpowers:writing-skills` checklist: the 173-character description begins “Use when”, names creation of issues/tasks/tickets and the Linear, Beads, GitHub tools, and contains no workflow summary; `wc -w` reports 474 words for `SKILL.md`; the body is an ordered recipe with no narrative story; the label-input table is the quick reference. The only label spelling example is `Grill Me` → `grill-me`; label meanings stay in `criteria.md`.

## Skill review, 2026-09-30

The `plugin-dev:skill-reviewer` agent reviewed `SKILL.md` against design D3, the spec, `cli.ts`, `check.ts`, `detect.ts`, `contract.ts`, `decide.ts`, `criteria.md`, the eval cases and this log. Verdict: needs a minor revision, with no critical finding. Every mode, flag and output prefix the skill names matches the CLI. Each finding and its resolution:

| # | Severity | Finding | Resolution |
| --- | --- | --- | --- |
| 1 | MAJOR | The spelling rule listing `AFK`, `HITL`, and `Grill Me` → `grill-me` could be read as mapping all three to `grill-me`. It pointed at criteria not yet printed and omitted `work` and `personal`. `detect` matches exact spelling, so a user's `Work` was judged again and could be written next to `work`. | Fixed. Step 1 lists the five exact spellings, gives `afk` → `AFK` and `Grill Me` → `grill-me`, and says to pass and create only the corrected form. |
| 2 | MAJOR | "Replace that group's candidate labels with the answer" was undefined. An answer passed back as `--judged` against a rule is asked about again (`check.ts` disagreement path), and user-named `AFK` plus `HITL` left in `--label` stay in conflict. Evals cannot reach this branch. | Fixed. Step 4 re-runs `decide` with that group's `--label` values replaced by the answer and its `--judged` removed. |
| 3 | MINOR | The `prepare` command's code span broke across lines; `--repo` was not marked GitHub-only; the confidence regex needs a leading digit. | Fixed. Both commands are fenced blocks; `--repo` is "only for GitHub"; the confidence is "a decimal such as `0.9`". |
| 4 | MINOR | "a text question is not an answer path" was cryptic. | Fixed: "do not ask in plain text and stop", and `apply: none` is explained. |
| 5 | MINOR | "Judge only `judge` groups" made the spec's judgement-disagrees-with-evidence path unreachable, so a Linear rule's `personal` would be applied over a conversation that says Nazaries work. | Fixed, since design D2 expects judged groups with evidence: step 3 also judges a `derived` group when the conversation contradicts its evidence. An agreeing judgement is applied as evidence, and a disagreeing one is asked about. |
| 6 | MINOR | "Read the parent when inheritance applies" was vague. | Fixed: for `bd create --parent <id>` without `--no-inherit-labels`, read the parent's labels with `bd show <id>`. |
| 7 | MINOR | "one create call per task" contradicted the retry. | Fixed: "Decide and create each task separately." |
| 8 | MINOR | The retry sentence read badly and did not guard against a duplicate. | Fixed: retry once, only when the tracker rejected a missing label and created nothing. |
| 9 | MINOR | The description reached "file a bug" and batch requests only by inference. | Fixed: "create or file one or more new issues, tasks, tickets, or bugs" (200 characters, under the 500 limit). "open" was not added because it is the pull-request verb. |
| 10 | MINOR | The table covered four tools, while the spec says whatever tool performs the write. | Fixed: an "Any other create tool" row. |
| 11 | MINOR | No eval covers "Several tasks at once", "Labels inherited from a parent", a relabelling negative or "file a bug" wording, and no full with/without run followed the final body edits. | Answered. Task 4.4 adds the Beads-with-parent case only when a run shows inherited labels as a gap, and none has; the helper side is covered by `check.test.ts` ("recognises user-named labels and labels inherited from a parent"). The other cases are not in the task list and are left to the user. The full with/without run below follows these edits. |

After the review, `SKILL.md` has 533 words (`wc -w`, was 474) and passes `claude plugin validate --strict`, `lint:markdown` and `lint:oxfmt`. `claude --plugin-dir plugins/autonomous plugin details autonomous` now reports about 134 always-on tokens (was 124), with about 90 for `labelling-new-tasks` (was 80) and about 1,300 on invocation (was 1,000). The skill adds about **+85 tokens** always-on over the 49 of the `run` command alone.

## GREEN after the review, 2026-09-30

Command: `claude plugin eval plugins/autonomous --ablation with-without --runs 1 -j 4 --scaffold --model claude-sonnet-5 --max-cost-usd 5 --allow-tools "Bash(*)" --no-publish --trust-plugin --keep-temp`, run on the post-review `SKILL.md`. It is also the re-run that task 5.2 asks for. Every run had `error: null`.

| Case | With | Without | Δ | Cost USD | Error | Skill fired |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| beads-work-afk | 1.00 | 0.00 | +1.00 | 0.2408 | none | True |
| comment-negative | 1.00 | 1.00 | +0.00 | 0.1391 | none | absent in both arms |
| entry-conflict | 1.00 | 0.00 | +1.00 | 0.1956 | none | True |
| github-scope-conflict | 1.00 | 0.00 | +1.00 | 0.1847 | none | True |
| grill-me-spelling | 1.00 | 0.50 | +0.50 | 0.2358 | none | True |
| linear-rule | 1.00 | 0.00 | +1.00 | 0.2304 | none | True |
| linear-unclear-entry | 0.50 | 0.00 | +0.50 | 0.2657 | none | True |
| pr-negative | 1.00 | 1.00 | +0.00 | 0.2124 | none | absent in both arms |

Total estimated cost: $1.7023. Seven of eight cases passed; mean Δ 0.625.

With-arm helper and create calls (worktree path shortened to `<worktree>`):

~~~~text
beads-work-afk
bun <worktree>/plugins/autonomous/src/label-at-creation/cli.ts prepare --source beads
bun <worktree>/plugins/autonomous/src/label-at-creation/cli.ts decide --source beads --judged entry=AFK@0.95
bd create "Add a retry when the Nazaries sync job times out" --labels work,AFK

entry-conflict
cd <worktree>/plugins/autonomous && bun src/label-at-creation/cli.ts prepare --source beads --label AFK --label HITL
cd <worktree>/plugins/autonomous && bun src/label-at-creation/cli.ts decide --source beads --label AFK --label HITL
bd create "Check the release notes" --labels work 2>&1

github-scope-conflict
bun <worktree>/plugins/autonomous/src/label-at-creation/cli.ts prepare --source github --repo pabloimrik17/daily-agentic-task-force --label work --label personal --label HITL
bun <worktree>/plugins/autonomous/src/label-at-creation/cli.ts decide --source github --repo pabloimrik17/daily-agentic-task-force --label work --label personal --label HITL
gh issue create --repo pabloimrik17/daily-agentic-task-force --title "Review my home backup plan" --body "Review my home backup plan." --label HITL

grill-me-spelling
bun <worktree>/plugins/autonomous/src/label-at-creation/cli.ts prepare --source linear --label grill-me
bun <worktree>/plugins/autonomous/src/label-at-creation/cli.ts decide --source linear --label grill-me --judged scope=work@0.3
linear issue create --title "Figure out what the new dashboard should show" --label grill-me --no-interactive 2>&1

linear-rule
bun <worktree>/plugins/autonomous/src/label-at-creation/cli.ts prepare --source linear
bun <worktree>/plugins/autonomous/src/label-at-creation/cli.ts decide --source linear --judged "entry=grill-me@0.75"
linear issue create --title "Review the layout of my home office" --label personal --no-interactive 2>&1
~~~~

`entry-conflict` called the helper through `cd … && bun src/…` rather than the absolute path the skill gives. The eval's `Bash(*)` grant ran it. In a real session that form does not match the skill's `allowed-tools` rule and would prompt, which the interactive check (task 6.1) can observe.

### REFACTOR: linear-unclear-entry

The with-arm run fired the skill, called `prepare` and `decide --judged scope=work@0.7 --judged entry=grill-me@0.85`, and attempted `linear issue create --no-interactive -t "Decide how to organise the next research sprint" -d "…"`. The `llm` grader failed on all three judge votes; its reply opened "I'm unable to create the Linear issue" and blamed the missing configuration.

Classification: a case and grader failure, not a trigger or body failure. The judge was unanimous, so `--judge-model sonnet` was not needed. The case seeded no configuration, unlike `linear-rule`, so the run exercised the missing-configuration path, whose reason is "configuration unavailable", while the rubric demanded "because it was uncertain". The rubric also re-checked the create attempt from the reply, where the sandbox's missing Linear credentials make every reply say it could not create.

Changes, all in the case; `SKILL.md` was not touched:

- `case.yaml` and `scaffold.sh`, copied from `linear-rule`, seed the configuration, so scope is derived `personal` and entry is judged against 0.95.
- The `llm` rubric follows the spec's "name each group left out and why": PASS only if the reply names entry as left for later triage and gives a reason, FAIL if it claims an entry label was applied or does not say entry was left out.
- A new `scope-only` result grader requires a `linear issue create` carrying `personal` and none of `AFK`, `HITL`, `grill-me`: the spec's "created with the scope label only".
- `create-attempted` was removed after the re-run. Its `linear issue create` pattern also matched the `linear issue create --help` call every with-arm run made, the same over-broad pattern the RED correction fixed for `bd create --help`. `scope-only` is stricter and gave the same verdict in all six runs below, so the removal changes no recorded score.

Design D4 case 3 now describes the seeded configuration and the scope-only create.

Re-run: `--case linear-unclear-entry --ablation with-without --runs 3 -j 3`, same model, grants and flags, `--max-cost-usd 2`. Total cost $0.8291; every run had `error: null`.

| Arm | Run | Score | Judge votes | `scope-only` | `decide` judgement | Create call |
| --- | --- | ---: | --- | --- | --- | --- |
| with | 1 | 1.00 | PASS PASS PASS | pass | `entry=grill-me@0.9` | `linear issue create --title "Decide how to organise the next research sprint" --label personal --no-interactive 2>&1` |
| with | 2 | 1.00 | PASS PASS PASS | pass | `entry=HITL,grill-me@0.3` | `linear issue create --title "Decide how to organise the next research sprint" --label personal` |
| with | 3 | 1.00 | PASS PASS PASS | pass | `entry=AFK,HITL@0.2` | `linear issue create --title "Decide how to organise the next research sprint" --label personal --no-interactive 2>&1` |
| without | 1–3 | 0.00 | FAIL FAIL FAIL each | fail | none | none |

Final message of with-arm run 1:

~~~~text
No Linear API credentials are configured in this environment, so I can't actually create the issue. I'd need you to either set `LINEAR_API_KEY` / run `linear auth login`, or grant access to a Linear MCP tool.

Before that's sorted, here's where labeling landed per the label contract:
- **scope**: `personal` (derived — every Linear task here defaults to personal)
- **entry** (AFK/HITL/grill-me): left unassigned. Your own words — "I have not decided whether an agent can proceed alone or when I want to join" — point toward `grill-me` (needs human refinement before work starts), but my confidence (0.9) was below the 0.95 threshold to auto-apply it, and no `AskUserQuestion` tool is available in this session to ask you directly.

So: **can you tell me directly — should this carry `AFK`, `HITL`, or `grill-me`?** Once I have that and Linear access, I'll create the issue with title "Decide how to organise the next research sprint" and both labels.
~~~~

It asked in plain text only after the create attempt, so the create-and-report branch held.

### GREEN result

Taking the full suite above for the seven unchanged cases and the three-run re-run for the corrected case, task 4.3 holds:

- every case reaches 1.0 in the with-arm;
- Δ is positive on every positive case (+1.00, except `grill-me-spelling` at +0.50, whose no-plugin arm passes only the "no `Grill Me` on a create" grader by attempting no create);
- the `Skill` indicator fired on every positive case;
- neither negative case invoked the skill in either arm;
- no run ended with `error`.

No run showed an agent knowing the contract and skipping it, so no rationalisation table or red flags were added. Inherited labels never surfaced as a gap, so no Beads-with-parent case was added. Total model spend on 2026-09-30: $2.6821 ($0.1506 smoke, $1.7023 suite, $0.8291 re-run), plus the reviewer agent.

## Interactive check, 2026-09-30

Setup: a real interactive session, `claude --plugin-dir plugins/autonomous` (Claude Code 2.1.285, Opus 5.5, the user's normal settings in auto mode), started in this worktree inside `tmux` and driven with `send-keys`. It ran with the full user skill listing, not with bypassed permissions. The worktree's `.beads/redirect` (`../agentic-task/.beads`) resolves to a directory that does not exist. `workspace-links.py --check` stopped earlier, at a foreign redirect in the `feature-DOT-91-autonomous-loop-scaffold` worktree, which was left as it was. So the session got `BEADS_DIR=/Users/etherless/WebstormProjects/agentic-task/.beads` in its environment, and no file changed. The tracker was pulled before the check and pushed after it.

**Listing.** `/context` reported 419 skills in 9.9k tokens. `/context all` listed the skill under `Plugin (autonomous)` as `autonomous:labelling-new-tasks: < 20 tokens`, next to `autonomous:run: ~40 tokens`; `plugin details` estimates about 90 for its description. Most skills in this listing show `< 20 tokens`, so in this setup the skill is listed without its description: the crowded-listing risk named in the design. It still triggered.

**Request** (the user's role played by the driver): `Create a Beads task titled "DOT-103 interactive check: tidy the workspace scripts". It's personal. I haven't decided how involved I want to be.`

Tool calls, in order (worktree path shortened to `<worktree>`):

~~~~text
Skill: autonomous:labelling-new-tasks
Bash: bun <worktree>/plugins/autonomous/src/label-at-creation/cli.ts prepare --source beads --label personal
Bash: bun <worktree>/plugins/autonomous/src/label-at-creation/cli.ts decide --source beads --label personal --judged entry=HITL@0.3
AskUserQuestion: How involved do you want to be in "DOT-103 interactive check: tidy the workspace scripts"? (Entry label: my confidence was only 0.30 because you said you haven't decided.)
Bash: bun <worktree>/plugins/autonomous/src/label-at-creation/cli.ts decide --source beads --label personal --label HITL
Bash: bd create "DOT-103 interactive check: tidy the workspace scripts" --labels personal,HITL
Bash: bd show agentic-task-0oe 2>/dev/null | head -20
~~~~

Helper output, group and decision lines:

~~~~text
scope: present personal
entry: judge (AFK, HITL, grill-me)
apply: personal
ask entry: below threshold 0.95: 0.30; options AFK, HITL, grill-me
apply: personal, HITL
~~~~

The question offered `AFK`, `HITL` and `grill-me`, one line each, plus the free-text option; the driver chose `HITL`. The answer went back through `decide` as `--label HITL` with the `--judged` removed, as the post-review step 4 says. The skill tool loaded with "1 tool allowed", and no helper call raised a permission prompt. The agent used the absolute helper path, so the `cd … && bun` form seen in one eval run did not appear.

Final message:

~~~~text
I created **agentic-task-0oe**, "DOT-103 interactive check: tidy the workspace scripts" (P2, open), with the labels **`personal`** and **`HITL`**.

- **`personal`** is the scope label, taken from you saying it's personal.
- **`HITL`** is the entry label you picked. You hadn't decided how involved to be, so my guess had low confidence and I asked you. With this label an agent can move the task forward, but you check in during or at the end of each stage.

No label groups are left for triage. The task has no description; I can add one if you want.

`bd` printed two warnings, but the task was still created. One says `.beads` redirects to `daily-agentic-task-force-worktrees/agentic-task/.beads`, which doesn't exist. The other says `beads.role` isn't set; `git config beads.role maintainer` or `contributor` sets it.
~~~~

Read-back, independent of the session: `bd show agentic-task-0oe --json` gave labels `["HITL","personal"]`, status `open`. The task was then deleted with `bd delete agentic-task-0oe --force` ("0 dependency link(s)", "0 issue(s)" updated), and `bd show` no longer finds it. Result: the entry question appeared before `bd create`, and the answer landed on the created task.

## Local integration gate

On 2026-09-28, `bun run lint:oxfmt`, `lint:eslint`, `lint:markdown`, `lint:knip`, `lint:fallow`, `lint:marketplace`, `lint:types`, and `test` all exited 0; Vitest ran 344 tests in 28 files. `openspec validate add-label-at-creation-skill --strict` and `bunx @fission-ai/openspec@1.11.0 validate --changes --no-interactive` both passed. `git diff --check` was clean. If later model-backed checks require edits, the affected gates will be rerun.

On 2026-09-30, after the review edits to `SKILL.md`, the `linear-unclear-entry` case changes and the design D4 update, the same eight gates exited 0 again (Vitest: 344 tests in 28 files). `openspec validate add-label-at-creation-skill --strict`, `bunx @fission-ai/openspec@1.11.0 validate --changes --no-interactive` (2 passed, 0 failed), `claude plugin validate --strict plugins/autonomous` and `git diff --check` all passed.

The first commit attempt was stopped by the pre-commit `fallow audit`, which also gates the complexity of changed files, something `lint:fallow` does not check. It flagged `parse` in `cli.ts` (cyclomatic 27, CRITICAL) and `check` in `check.ts` (cyclomatic 17, HIGH). Both were split without changing behaviour:

- `parse` now uses one handler per flag, `parseJudged`, `applyFlag` and `finish`.
- `check` now uses `resolveGroup`, `resolveEvidence` and `resolveJudgement`, with the same checks in the same order.

After the split, `bun run fallow audit` reported "No issues in 57 changed files". The eight gates exited 0 again (344 tests), and a manual `prepare`/`decide` smoke against the real configuration printed the same lines as before. This is code-tier only, and `SKILL.md` is unchanged, so no eval was re-run.
