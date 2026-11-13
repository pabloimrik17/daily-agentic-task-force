## Context

See proposal.md, "Why". This change builds on `add-stage-pull-request-and-logbook`: pull-request mode, log mode, the cover, the logbook receipt, `agentArgs` and `transition.json` in the attempt, and the optional `url` and `parent` on the work task. The current state that shapes the approach:

- **The contract.** `label-contract/contract.ts` declares the stage labels once (`grill-me`, `proposal`); every type, the colours, the meanings and the bootstrap derive from that list.
- **Selection.** `select/stage.ts` holds `SUPPORTED_STAGES = ["grill-me"]`. `candidates.ts` excludes a task as split when `children`, the open children, is not empty. No reader counts closed children.
- **Launch.** `attempts/launch.ts` checks, in order: stage registered, prerequisites (`{ tool, home }`), no `taken`, no open attempt, repository inferred. The prerequisites therefore cannot see the repository or the task.
- **The stage contract.** `prerequisites(env)` returns a `context` of strings that reaches the synchronous `prompt`. Grill-me uses it for the skill bodies.
- **The transition.** `transition/mode.ts` fixes `FROM_STAGE = "grill-me"` and `TO_STAGE = "proposal"`. Transition mode never writes: the answer comes back through answer mode, which applies it. `receipt.ts` looks for an open `grill-me` attempt.
- **Persist mode.** `persist/persist.ts` refuses any stage but `grill-me`, and runs four steps: read the task, save the description, save the comment, write the receipt.
- **Readers.** The work readers read `blocks` relations, open children and, for Linear, the project. Trackers read comments. Nothing reads related tasks, duplicates, attachments or linked pull requests.

## Goals / Non-Goals

**Goals:**

- Register the stage without a special case in reconcile, and with one general change in launch.
- Read the context in code, once, at launch, so the prompt file shows exactly what the agent was given.
- Reuse the transition, persist, pull-request and log modes instead of adding a mode for this stage.

**Non-Goals:**

- Driving `/opsx:propose` from the runner, or checking the proposal's content.
- Excluding in selection a task whose repository lacks OpenSpec. The user decided the stage waits at launch (see Risks).
- A general framework for stage transitions. Two transitions are described by a small table.

## Decisions

### D1. `implement` is one more entry in the contract's stage list

Adding `implement` to `STAGE_LABELS`, `COLOURS` and `MEANINGS` is enough for detection, triage and the bootstrap, which all derive from them. `StageName` in selection becomes the contract's `StageLabel`. `STAGE_IDS` does not gain `implement`: no stage implementation is registered for it, and selection excludes it as unsupported before launch is reached.

### D2. Launch infers the repository before the prerequisites, and passes the task and the repository

The order becomes: stage registered, repository inferred, prerequisites, no `taken`, no open attempt. `StageEnv` gains `task: WorkTask`, `repository: string` (its absolute path), `branch: string` and the readers the stage may call (D4). Grill-me and the test stage ignore the new fields.

Inference only reads the workspace root, so moving it earlier writes nothing. A task with no inferable repository now waits with that reason before its prerequisites run; the reason it reports is unchanged.

*Alternative:* a second, later hook for repository checks. Rejected: two hooks for one question, "can this stage start".

### D3. The OpenSpec checks are a directory test and one CLI call

The prerequisite holds when `<repository>/openspec` is a directory and `openspec --version` exits 0 through the shared `Exec`. It does not check that the repository has the `/opsx:propose` command: OpenSpec installs it per tool, and a session that lacks it fails visibly at its first step.

### D4. Context is read through a `ContextReader` per source, at launch

A new port, one implementation per source, returns a `TaskContext`:

```ts
interface RelatedTask { id: string; title: string; state: string; url: string | null }
interface TaskContext {
    comments: string[];
    parent: (RelatedTask & { description: string | null }) | null;
    children: RelatedTask[]; blockedBy: RelatedTask[]; blocks: RelatedTask[];
    related: RelatedTask[]; duplicates: RelatedTask[];
    project: string | null;
    attachments: { title: string; url: string }[];
    pullRequests: { title: string; url: string }[];
    notes: string[]; // e.g. "github: dependencies were not read"
}
```

- **Linear:** one `linear issue view <id> --json` gives relations, inverse relations, parent, children, project and attachments; comments come from the tracker's `readComments`.
- **Beads:** `bd show <id> --json --include-comments --include-dependents`, whose dependencies carry their type.
- **GitHub:** `gh issue view --json comments,subIssues,parent,closedByPullRequestsReferences`; no blockers, and the note.

The stage's `prerequisites` calls the reader and serialises the result as one JSON string in the stage context, under the key `context`. `prompt` parses it and renders the section. A failed read fails the prerequisites.

The exact JSON fields of each CLI are confirmed from recorded outputs in task 4.1 before the parsers are written; a field a CLI does not print yields an empty list and a note, never a failure.

*Alternative:* the agent reads the context itself. Rejected by the user: code first, and the prompt file must be auditable.

### D5. The prompt is built from sections, as grill-me's is

`stages/proposal/prompt.ts` renders: the Context section; the proposal step (`/opsx:propose`, one change, no split, no code edits, continue an existing change); the autonomy section, chosen by the task's autonomy label; the closing with the exact commands; the stage summary section, which is the `handoff` body with the same redirect as grill-me; the blocked-agent section for `AFK`; and the constraints. The open pull request of the branch, found in the prerequisites through the `PullRequests` port of the first change, is passed in the context and named in the prompt.

The autonomy is read from the task's labels at launch. A task whose autonomy is missing never reaches launch: selection excludes it under classification, and a supplied task fails the prerequisites with that reason.

### D6. The two transitions are a table

```ts
const TRANSITIONS = {
    "grill-me": { to: "proposal", asks: "autonomy" },
    proposal: { to: "implement", asks: "approval" },
};
```

- **Transition mode** reads the task, finds its row, checks the receipt of an open attempt of that stage (`receipt.ts` takes the stage as a parameter) and then: for `grill-me`, emits the autonomy question as today; for `proposal` with `HITL`, emits the approval question (`Approve` → `implement`, `Later` → null); for `proposal` with `AFK`, applies the transition.
- **Applying** is one function shared by answer mode and the `AFK` path: check the label exists on the tracker, add, remove, read back. It is the code `transition/answer.ts` has today, taking the row and an optional autonomy.
- **Answer mode** reads the task again and picks the row by its stage label; the value must match what that row accepts.

The `AFK` path makes transition mode write, which it never did. Its report gains `applied: boolean`, and the README says so. `transition.json` (first change) is written on both paths, with `answer: ["implement"]` and `by: "agent" | "human"`, so the logbook header can say who approved.

*Alternative:* a separate `--advance` flag for the `AFK` case. Rejected: the agent would choose the command by autonomy, and the rule belongs in code.

### D7. Persist mode takes its steps from the stage

`persist.ts` keeps a table from stage to the files it requires, its steps and its comment header. `grill-me` keeps its four steps. `proposal` requires only `stage-summary.md` and runs read, comment and receipt. The header is `autonomous · proposal · <attempt-id> · stage summary saved`. The report schema is unchanged; for `proposal` its description fields are empty.

### D8. A split parent is found by a total child count

The work task gains `childCount: number | null`, the children in all, filled by `detail` beside `children`: Linear and GitHub already return every child with its state, and Beads lists by parent. `candidates.ts` excludes as split when `children` is not empty, or when the stage is `proposal` and `childCount > 0`. `SelectData` gains `readyToClose`, the split exclusions with `childCount > 0` and no open child, and the report renders them under their own heading.

A `grill-me` task with only closed children stays a candidate: a human reopened its refinement on purpose.

### D9. Completion and the blocked agent need no new machinery

`completed` mirrors grill-me's: `closed`, or `implement` present and `proposal` absent. A blocked `AFK` agent writes no marker, so its attempt is retained by the existing rule once its session ends; persist and log modes work on an open attempt, so it can leave its explanation first.

## Risks / Trade-offs

- [A task in `proposal` whose repository has no OpenSpec is selected, waits at launch, and may be selected again on the next run, holding the loop] → Accepted by the user for this iteration: the wait names the repository, and the fix is the user's (add OpenSpec, or move the task). Excluding such tasks in selection is left for the change that excludes tasks without an inferable repository (DOT-120).
- [The agent's `/opsx:propose` asks a question in an `AFK` session and the session hangs] → The prompt forbids it and gives the blocked path; a session that waits anyway shows as needing a human in reconcile.
- [A tracker CLI does not print a relation the context expects] → Empty list plus a note in the Context section; fixtures pin the shapes.
- [`implement` is missing on a tracker at the first transition] → The transition fails before any write, naming `--bootstrap-labels`; the README's upgrade note says to run it.
- [An `AFK` proposal reaches `implement` unreviewed] → The decision of ADR 0004. The draft pull request and its logbook entry are where the human reviews it, and `implement` is not yet a supported stage.
- [The context makes the prompt very long for a task with many comments] → Not capped in this iteration; the prompt file shows the size, and a cap can follow real use.

## Migration Plan

No configuration change. After the release, run `/autonomous:run --bootstrap-labels` once so Linear and GitHub have `implement`. Tasks already in `proposal` become candidates at the next run. Rollback is the previous plugin version: a task left in `implement` then reads as an unknown stage label and is reported as missing its stage, which triage would answer by adding `proposal`; remove `implement` by hand before rolling back.

## Open Questions

- Whether the Context section needs a size cap. It can be answered after the first real runs without changing the specs.
