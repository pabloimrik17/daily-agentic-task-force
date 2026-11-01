# Creation-helper eval log

Task 5.3 of `add-stage-labels-and-transition`: the nine evals that run the
creation helper, re-run on 2026-11-01 after the helper, the skill and the
graders moved to the three label groups. The user authorised the spend with a
ceiling of 10 USD.

## First run

Command, from the repository root, once per group (`--case beads-*`,
`github-*`, `linear-*`, `entry-conflict`, `grill-me-spelling`), with the
README's flags, `--ablation none` (the no-plugin arm scores nothing this task
verifies), `-j 3`, and per-group ceilings adding up to 10 USD:

```bash
claude plugin eval plugins/autonomous --case <glob> --ablation none -j 3 \
  --scaffold --allow-tools 'Bash(*)' \
  --model claude-sonnet-5 --max-cost-usd <ceiling> \
  --no-publish --trust-plugin --json <group>.json --report <group>.html
```

Claude Code 2.1.316, three runs per case, every run with `error: null`, no
group partial. The raw JSON and HTML reports are kept outside the repository
(the results directory is git-ignored).

| Case | Score | Pass rate | Runs | Cost (USD) | Errors | Graders failed |
| --- | --- | --- | --- | --- | --- | --- |
| beads-nothing-certain | 1.00 | 1.00 | 1.00 / 1.00 / 1.00 | 0.5310 | none | none |
| beads-several-tasks | 1.00 | 1.00 | 1.00 / 1.00 / 1.00 | 0.3979 | none | none |
| beads-work-afk | 1.00 | 1.00 | 1.00 / 1.00 / 1.00 | 0.3242 | none | none |
| github-missing-label | 1.00 | 1.00 | 1.00 / 1.00 / 1.00 | 0.3861 | none | none |
| github-scope-conflict | 1.00 | 1.00 | 1.00 / 1.00 / 1.00 | 0.4040 | none | none |
| linear-rule | 1.00 | 1.00 | 1.00 / 1.00 / 1.00 | 0.4559 | none | none |
| linear-unclear-entry | 0.67 | 0.33 | 0.50 / 0.50 / 1.00 | 0.4742 | none | criteria, scope-only |
| entry-conflict | 1.00 | 1.00 | 1.00 / 1.00 / 1.00 | 0.3700 | none | none |
| grill-me-spelling | 1.00 | 1.00 | 1.00 / 1.00 / 1.00 | 0.5283 | none | none |

Total cost of the five groups: 3.8716 USD.

Eight cases pass their result grader on every run, as they did before the
change (the archived log of `add-label-at-creation-skill` records 1.00 for
each). One does not.

## Classification: `linear-unclear-entry`

The prompt says the user "has not decided whether an agent can proceed alone or
when I want to join". Before this change the expected outcome was a task created
with `personal` only and the entry group left for triage, and the graders said
so: `criteria` passed only a reply that left the autonomy for a later triage,
and `scope-only` matched a create call with `personal` and no `AFK`, `HITL` or
`grill-me`.

Under the three-group contract that input is the `grill-me` case: an autonomy
the user has not decided is decided in a grill (design D2), and the helper's
`decide` applies `grill-me` alone for a `grill-me` judgement (design D10, spec
label-at-creation "Grill judged", skill step 3). Runs 1 and 2 did exactly that
(`personal` and `grill-me`, with the reason that the autonomy is decided in the
grill) and were failed by the old graders; run 3 left the autonomy for triage
and was rewarded. The failure is expectation drift, not a helper or skill
defect. In runs 1 and 2 the agent also did not attempt the `linear issue
create` call (it stopped at the unauthenticated CLI), which fails the tool
grader regardless of the labels; the archived log shows the same agent
behaviour before this change.

Fix: the case keeps its prompt and name; its graders now state the new
expectation.

- `graders/criteria.md`: PASS only if the issue, or the create command given,
  carries `personal` and `grill-me` and the reply says the autonomy is decided
  in the grill; FAIL if `AFK`, `HITL` or `proposal` is claimed, if the autonomy
  is left for a later triage, or if the user is asked to choose before creating.
- `graders/scope-only.md` is renamed `graders/scope-and-grill.md`: a `linear
  issue create` call with `--label personal` and `--label grill-me` and none of
  `AFK`, `HITL` or `proposal`.

## Re-run 1: LLM grader, 2026-11-01 10:33 UTC

Same command, `--case linear-unclear-entry`, ceiling 1.5 USD. Cost 0.4539 USD,
three runs, every `error: null`. Score 0.75 / 0.50 / 0.75, no run passed. The
rewritten LLM `criteria` failed every run (judge votes 3-0, 3-0, 2-1) because
the sandbox cannot authenticate the `linear` CLI, so every reply says the issue
could not be created and asks the user to log in; the judges read that as a
failure although two replies gave the create command with `personal` and
`grill-me`. The tool grader `scope-and-grill` passed the two runs that
attempted the create. The LLM grader was the wrong instrument here: the other
Linear cases (`linear-rule`, `grill-me-spelling`) already judge the attempted
create call with a `tool_used` grader for this reason (README, "Local eval
suite": judge the attempted create call in the trace).

Second fix: `graders/criteria.md` becomes that `tool_used` grader (a `linear
issue create` call with `--label personal` and `--label grill-me` and none of
`AFK`, `HITL` or `proposal`), and the duplicate `scope-and-grill.md` is
dropped. The case now has `criteria`, `helper-ran` and `skill-fired`, like
`linear-rule`.

## Re-run 2: tool grader, 2026-11-01 10:37 UTC

Same command and ceiling. Cost 0.4784 USD, three runs, every `error: null`.
Score 1.00 / 0.67 / 1.00; pass rate 0.67. Runs 1 and 3 attempted the create
with `personal` and `grill-me` and no autonomy label, as the contract wants.
Run 2 ran the helper and the skill but never attempted the create call (it
stopped at the unauthenticated CLI and asked the user to log in), so the tool
grader found no call. That is the agent behaviour the archived log already
records for this case and `beads-work-afk` before the change, independent of
the label contract; the case was not re-run again because of the account's
weekly quota (84 % used on the Team account at 10:38 UTC).

## Result

Every case passes its result grader as it did before the change, except
`linear-unclear-entry`, whose failure is classified as expectation drift and
fixed in its graders; after the fix its two runs that attempt the create pass,
and the one that does not is agent variance the sandbox already showed. Total
spend: 3.8716 + 0.4539 + 0.4784 = 4.8039 USD, under the 10 USD ceiling the user
set.
