# Calibration

The calibration of design D14, run on 2026-11-22. It is not finished: the runs and the scoring are done, and the shipped `review` defaults are not yet set from them (see "Open decisions").

## Method

- **Pull requests:** #94, #96, #97, #100 and #105. #99 was left out because none of its bot findings was accepted.
- **Commit reviewed:** the head at the `ready_for_review` event for #100, and the head when the pull request was opened for the other four, which were opened ready. The base is that head's merge base with `main`.
- **Reference set:** 20 distinct bot findings the user accepted, confirmed by the user. A finding is accepted when a later commit fixed that place or the user's reply says it was addressed. A resolved thread is not evidence. Two pairs raised by two bots count once each (97-1 with 97-4, 105-2 with 105-3). 105-8 is left out: Greptile raised it on a later commit.
- **Team:** the full `L` team against the base, in a temporary worktree at the commit.
- **Teammates:** each one a headless Claude Code session (`claude -p`, 2.1.330) started in that worktree with its brief as the whole prompt, so its cost and duration are the session's own. `/code-review` and the tests lens ran on Opus at high effort, the walkthrough on Opus at medium, `fallow-review` on Sonnet at medium.
- **CLI reviewers:** Codex 0.171.0 with `gpt-6-luna` at high effort on a free ChatGPT account, and CodeRabbit 0.9.6 on its free plan.
- **Scoring:** one scorer per pull request read the report, the reference findings and the code. `caught` means the same defect at the same place; `partial` means the same place and a closely related problem. Scorers were told to choose the stricter verdict when unsure.

## Not measured

- **`/security-review`:** skipped on every run, because the base is a commit and not the default branch.
- **CodeRabbit on #100 and #105:** skipped with "Rate limit exceeded". The free plan includes 3 reviews, spent on #96, #94 and #97. Those two pull requests hold 11 of the 20 reference findings.
- **Codex on #94:** it reported two findings, and one named a path outside the repository (a directory segment was missing), so the parser skipped the reviewer and both were lost. Neither was a reference finding.
- **Greptile:** its CLI refused every run with "this organization's billing plan does not include per-use CLI reviews". So the CLI is billed per use, apart from the pull request app's monthly tier, and the current plan does not include it. How many reference findings it would catch is unknown. The user chose to leave it unmeasured.

## Coverage of the reference set

| Pull request | Reference findings | Caught by the team | By whom                                                        |
| ------------ | ------------------ | ------------------ | -------------------------------------------------------------- |
| #94          | 1                  | 1                  | `/code-review`, walkthrough                                    |
| #96          | 5                  | 4                  | `/code-review` (3, one also by the tests lens), CodeRabbit (1) |
| #97          | 3                  | 2, and 1 partial   | `/code-review`                                                 |
| #100         | 7                  | 1                  | `/code-review`                                                 |
| #105         | 4                  | 1                  | `/code-review`                                                 |
| Total        | 20                 | 9, and 1 partial   |                                                                |

Per reviewer, over the pull requests where it reported:

| Reviewer        | Reported on | Reference findings in reach | Caught           | Caught by it alone |
| --------------- | ----------- | --------------------------- | ---------------- | ------------------ |
| `/code-review`  | 5           | 20                          | 8, and 1 partial | 6, and 1 partial   |
| CodeRabbit CLI  | 3           | 9                           | 1                | 1                  |
| Walkthrough     | 5           | 20                          | 1                | 0                  |
| Tests lens      | 5           | 20                          | 1                | 0                  |
| Codex           | 4           | 19                          | 0                | 0                  |
| `fallow-review` | 5           | 20                          | 0                | 0                  |

The 11 reference findings not fully caught:

- **Prose that instructs an agent or a person** (8): 96-5 (README), 100-1 (design), 100-2 (README), 100-3 and 100-4 (stage prompt), 105-2, 105-4 and 105-6 (verify skill and prompt). No reviewer of the team reads a prompt, a skill or a document for what it makes an agent do.
- **Git edge cases** (2): 100-8 (`fetch` without `--prune`) and 100-9 (`status.showUntrackedFiles=no`). `/code-review` had a finding on the line of 100-9 that argued the opposite.
- **The partial** (1): 97-3.

## Findings outside the reference set

A unique finding is one no other reviewer reported, judged by meaning. "Look real" means the scorer verified the defect in the code; the rest are unsure or do not hold.

| Reviewer        | Findings | Doubts | Unique | Look real | Unsure |
| --------------- | -------- | ------ | ------ | --------- | ------ |
| `/code-review`  | 42       | 9      | 33     | 23        | 8      |
| Tests lens      | 13       | 5      | 10     | 8         | 2      |
| Walkthrough     | 8        | 8      | 6      | 2         | 1      |
| CodeRabbit CLI  | 7        | 0      | 3      | 1         | 1      |
| `fallow-review` | 18       | 0      | 18     | 0         | 1      |
| Codex           | 0        | 0      | 0      | 0         | 0      |

- `fallow-review`'s 18 findings are accurate notes that an export or a fixture changed. None names a defect.
- No finding pointed at a file outside the change. A few pointed at lines the change leaves untouched.
- These findings were not triaged by the user. "Look real" is the scorer's reading.

## Time and cost

| Reviewer                    | Time per pull request | Cost per pull request | Total, five pull requests |
| --------------------------- | --------------------- | --------------------- | ------------------------- |
| `/code-review xhigh` (Opus) | 7.5 to 13.5 min       | $2.04 to $5.57        | $19.07                    |
| Tests lens (Opus)           | 2.1 to 3.1 min        | $0.78 to $1.65        | $6.28                     |
| Walkthrough (Opus)          | 1.7 to 3.1 min        | $0.68 to $1.46        | $4.29 over four           |
| `fallow-review` (Sonnet)    | 0.8 to 2.1 min        | $0.27 to $0.30        | $1.45                     |
| Codex (`gpt-6-luna`)        | 62 to 101 s           | free account          |                           |
| CodeRabbit CLI              | 103 to 240 s          | free plan, 3 reviews  |                           |

The walkthrough on Sonnet at medium cost $0.24 to $0.40 and took 45 to 71 seconds on #94, #96 and #97.

The reviewers of one pull request run at once, so a run takes as long as `/code-review`: 8 to 14 minutes.

## Defects the calibration found in the review team

- **Fixed: the `/code-review` brief reviewed the wrong code.** It passed the merge base alone, and the built-in skill reads a lone commit id as the commit to review. On #94, #96 and #97 it reviewed the base commit and never the subject. The brief now passes the range `<merge-base>..<head>` (design D8). The numbers above come from the runs after the fix.
- **Open: the walkthrough on Sonnet wrote an invalid file on 2 of 3 pull requests.** It left `label` off a doubt. The walkthrough is required, so `collect` exited 1 and wrote no report. On Opus it wrote a valid file on all four.
- **Open: one bad path loses all of Codex's findings.** The parser skips the reviewer when one entry does not fit (design D8). On #94 that dropped two findings that other reviewers confirmed.
- **Open: CodeRabbit phrases some findings as questions**, and the parser records them as findings, not doubts.
- **Open: the plan names no model for a teammate.** Whoever runs the skill picks it, and the walkthrough result above shows the choice matters.

## Open decisions

The shipped `review` defaults are unchanged, and `config.test.ts` pins nothing new. What the numbers suggest, for the user to decide:

- `/code-review` carries the team: 8 of the 9 caught reference findings and 23 of the 34 unique findings that look real. It is also about 60% of the teammates' cost ($19.07 of $31.49).
- `fallow-review` caught nothing and reported no defect in five runs.
- Codex on the free account reported nothing in four runs. That says little about a paid model.
- CodeRabbit's CLI caught 1 of the 9 reference findings in its reach, where the pull request bot had raised 6 of those 9. Its free plan covers 3 reviews.
- Eight of the misses are instructions in prose. A reviewer with that angle is the gap the reference set shows.
