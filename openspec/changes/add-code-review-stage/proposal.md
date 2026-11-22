## Why

A task that leaves verification moves to `code-review` and stops there. Selection treats `code-review` as an unsupported stage, so a person takes the task from there. Nobody judges the quality of the code before external reviewers see it. The review bots and the human find what a review on this machine could have found and fixed, and the human cannot tell what was already checked. This change (DOT-164) registers the code review stage: the second review stage, after verification and before QA and external review (ADR 0007). It is built on the review team of DOT-163.

## What Changes

- **The code review stage is registered** (id and label `code-review`), for the `claude` tool only, with `--model opus --effort high`. Selection supports `code-review`, and a `code-review` candidate is preferred over every other stage's. The stage judges the quality of the code the implementation changed, not its match with the proposal.
- **Prerequisites** are verification's, minus the verify workflow:
    - the workspace branch has an open pull request that adds exactly one active OpenSpec change;
    - the review team skill and the adversarial review skill are read from the running plugin;
    - the `gh` CLI can read and write the pull request's review threads.
- **One adversarial review**, the verification's mechanics inherited:

    | Parameter | Value |
    | --- | --- |
    | Subject | the code the implementation changed |
    | References | the definition and the proposal, for intent |
    | Procedure of the report | the `review-team` skill |
    | Severity floor | `CRITICAL` |
    | Later reviews | QA and external review |
    | Record | `findings.md` in the attempt's directory |
    | Whether a human follows | `HITL` |

- **Its input includes what verification passed on**: the open finding threads addressed to code review, and the `Code review` heading of verification's stage summary. Both enter the finding triage as findings of the reviewer `verification`.
- **The proposal is not touched.** Code review never changes the proposal or the definition. A finding whose fix would contradict them is deferred to a follow-up for `AFK` and asked for `HITL`.
- **Doubts** are settled against the definition and the proposal first. Then the human is asked (`HITL`) or the doubt is published as an open thread (`AFK`). A doubt is never refuted or fixed.
- **Finding threads on the pull request** (ADR 0008):
    - Only findings that survived the refutation are published, as one review per attempt whose body is a short index.
    - A fixed `CRITICAL` or `WARNING` finding, or one deferred to a created follow-up, is published resolved, with its commit or the task's URL.
    - A proposed follow-up, a finding passed on to QA or external review (tagged `#qa` / `#external-review`, marker `for=<stage>`), a blocked fix and a doubt stay open.
    - Fixed `SUGGESTION`s, refuted and dismissed findings appear only in the logbook entry.
    - Comments use Conventional Comments, a folded trace and versioned hidden markers, so a re-attempt never publishes twice.
- **The walkthrough**: the review team's guide is brought up to the final diff at the close, with each published finding as a note. The human gets it through `plannotator guide import --pr`, a short markdown rendering in the logbook entry, and, for `HITL`, the Plannotator Inbox.
- **The human round (`HITL`)**: the human reviews on GitHub or in Plannotator. Each comment becomes a finding of the reviewer `human`, and the adversarial review runs one more round on them.
    - The refutation is advisory: counter-evidence is shown, and the human decides.
    - The round repeats until the human approves at the transition question.
- **A new stage label, `external-review`** (colour `#a16207`): the task's code is reviewed and it waits for its external review. It enters the contract and the bootstrap before its stage exists (DOT-157). The transition `code-review → external-review` is applied with no answer for `AFK` and on approval for `HITL`, with verification's guards on leaving. The pull request stays a draft.
- **The adversarial review gains the human's round**: a caller whose human follows the review may run one more round whose report is the human's comments. Its refutation is advisory.
- **The closing order**, the blocked path and persist mode follow verification's. The logbook entry gets a `### Code review` section.
- **Release.** A `feat(autonomous):` minor, with no configuration change. `--bootstrap-labels` must run once per tracker to create `external-review`.

**Out of scope**:

- The external review stage, marking the pull request ready and the bots' findings (DOT-157); QA.
- Picture it (DOT-159), tuicr as a surface (DOT-160), verification publishing threads (DOT-161) and the hybrid tier decision (DOT-158).
- The review team itself (DOT-163).

## Capabilities

### New Capabilities

- `code-review-stage`: the code review stage. It covers its registration, prerequisites, prompt, how it runs the adversarial review with the review team, its inputs from verification, doubts, finding threads, the walkthrough, the human round, commits, closing order, blocked path, stage summary and completion.

### Modified Capabilities

- `label-contract`: `external-review` joins the stage group, the meanings, the spellings and colours, and the bootstrap. A fifth transition, `code-review → external-review`, is added, and the autonomy decides whether leaving `code-review` needs an answer.
- `work-selection`: `code-review` becomes a supported stage, after `verify` in the order of advancement. `external-review` is a stage label that is not supported.
- `label-triage`: a task in `external-review` is decided `AFK` or `HITL`.
- `autonomous-run`: transition mode, transition answers, the approval question, persist mode and its preconditions, and the receipt wait all serve `code-review`. Leaving `code-review` needs the work finished.
- `adversarial-review`: a caller whose human follows the review may run a round whose report is the human's comments, with an advisory refutation.

## Impact

- **New code:**
    - `plugins/autonomous/src/stages/code-review/` (stage and prompt);
    - a finding-thread publisher in `plugins/autonomous/src/` (anchoring, markers, resolution), used by the prompt through a mode of `/autonomous:run`;
    - their tests.
- **Changed code:**
    - the stage registry and contract, selection, the label contract and bootstrap, triage;
    - transition mode, its guards and receipt, persist mode;
    - the adversarial review skill;
    - README, glossary and ADR 0007's consequences.
- **External tools:** `gh` (review threads through the API) and `plannotator` (guide import and Inbox), both optional for the walkthrough.
- **Depends on DOT-163** (the `review-team` skill and its report schema). Preparing this proposal before DOT-163's calibration may need an update of the tier references once that lands.
