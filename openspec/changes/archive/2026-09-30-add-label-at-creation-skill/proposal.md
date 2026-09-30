## Why

The `label-triage` step (DOT-102) cleaned the backlog: its first `--apply` run added 559 contract labels. Nothing stops the untagged debt from growing again, because every session that creates a task in Linear, Beads or GitHub still does so without the contract in mind. Linear DOT-103 asks for a skill in the `autonomous` plugin so that any Claude session creating a task sets one label from each contract group at creation time. It uses the same meaning and the same threshold the triage step uses, and asks the user for what it is not sure about. DOT-103 is the next slice of DOT-82 and is unblocked now that the contract, the criteria file and the triage code exist.

## What Changes

- Add the plugin's first **skill**, `labelling-new-tasks`, triggered when a session is about to create an issue or task in Linear, Beads or GitHub. It changes nothing about *whether* or *where* the task is created. It adds labels: before the create call, the creating agent judges the missing groups against the shared criteria, using the context of its own conversation. Its create call then carries the labels it is confident about, and it asks the user (AskUserQuestion) for the rest when a human can answer. It never blocks creation: with no one to ask, the task is created with the confident labels only, the reply names the groups left out, and the triage step picks them up on its next run.
- Add a small **deterministic helper**, `bun src/label-at-creation/cli.ts`, which the skill calls, so that everything that is not a judgement reuses the code the triage step already runs: it prints the criteria file verbatim, loads the user configuration, derives evidence (structural scope rules, aliases), applies the configured threshold and checks validity under the contract. It prints which labels to apply and which groups to ask about. Meaning and threshold keep one source each: the criteria file `src/label-triage/criteria.md` and `judgement.threshold` in `~/.config/autonomous/config.json`. The judgement itself stays with the creating agent; no `claude -p` call is made.
- Develop and audit the skill with the Claude Code CLI and the skill-authoring skills available, not by reading prose alone:
    - a **`claude plugin eval` suite** in `plugins/autonomous/evals/`, whose no-plugin baseline arm is the RED run of `superpowers:writing-skills`;
    - `claude plugin validate --strict`;
    - `claude plugin details` for the always-on token cost;
    - a `plugin-dev:skill-reviewer` review.
- Document the skill in the plugin README and mention it in the plugin description.

**Out of scope**: a hook that blocks task creation without labels (DOT-103: only if the skill proves insufficient); labelling or relabelling existing tasks (the triage step's job); creating labels on a tracker (`--bootstrap-labels` stays the only path); lifecycle labels; running the eval suite in CI.

## Capabilities

### New Capabilities

- `label-at-creation`: applying the label contract when a task is created in any tracker. It covers when the skill applies, how the creating agent judges the missing groups against the shared criteria, and the deterministic helper that supplies evidence, threshold and validity from the existing contract code. It also covers asking the user or leaving groups to triage, and writing the labels in the create call without ever blocking creation or creating labels.

### Modified Capabilities

None. The `label-contract` requirements (vocabulary, meanings, configuration, bootstrap) and the `label-triage` requirements are reused unchanged. The configuration's `judgement.threshold` gains a second reader but keeps its meaning.

## Impact

- **New**:
    - `plugins/autonomous/skills/labelling-new-tasks/SKILL.md`;
    - `plugins/autonomous/src/label-at-creation/` (the helper's pure decision module, its CLI entry and their tests);
    - `plugins/autonomous/evals/` (eval cases and graders; `evals/results/` ignored by git).
- **Reused, unchanged**:
    - `src/config.ts` (`loadConfig`);
    - `src/label-contract/contract.ts` and `detect.ts`;
    - `src/label-triage/rules.ts` (`deriveByRule`) and `decide.ts` (`decide`);
    - `src/label-triage/criteria.md`.
- **Modified**: the plugin `README.md`, the `description` of `plugins/autonomous/.claude-plugin/plugin.json`, `plugins/autonomous/package.json` and the plugin's entry in `.claude-plugin/marketplace.json` (kept identical), and `.gitignore` (eval results).
- **Consumer requirements**: none new. The skill needs `bun` (already required) and is present only in sessions where the `autonomous` plugin is installed and enabled. At the time of writing it is not installed on this machine; only `datf-lab` is.
- **Cost**: the skill's description joins the always-on skill listing of every session with the plugin enabled. On-invoke cost is one skill body plus two short helper calls. Eval runs spend model calls on the user's plan and are run locally, on demand.
- **Tracking**: Linear DOT-103, sub-issue of DOT-82. Release through release-please from a `feat(autonomous): …` commit; no manual version bump.
