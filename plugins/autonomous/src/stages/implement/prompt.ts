// Spec implementation-stage, "The implementation prompt". The handoff body, the apply and update
// workflows' names, the change, the open pull request and the task's context come from what the
// prerequisites read at launch, so the prompt file keeps exactly the text this attempt's agent
// received. The orchestration is stated as intent: how many teammates, and how they are briefed,
// is the orchestrator's call.

import type { AutonomyLabel } from "../../label-contract/contract.ts";
import type { PullRequest } from "../../pull-request/port.ts";
import {
    BLOCKED_TITLE,
    type Blocked,
    blockedSection,
    type Closing,
    closingSection,
    contextSection,
    contextValue,
    NO_FORCE_PUSH,
    openspecPrompt,
    type Paths,
    promptAutonomy,
    promptPaths,
    PULL_REQUEST_KEY,
    publicRepository,
    type Section,
    summarySection,
} from "../openspec-stage.ts";
import type { StageContext, StagePromptInput } from "../stage.ts";

export { CONTEXT_KEY, HANDOFF_SKILL, PULL_REQUEST_KEY } from "../openspec-stage.ts";
export const APPLY_WORKFLOW_KEY = "applyWorkflow"; // `/openspec-apply-change` or `/opsx:apply`
export const UPDATE_WORKFLOW_KEY = "updateWorkflow"; // `/openspec-update-change` or `/opsx:update`
export const CHANGE_KEY = "change"; // the name of the OpenSpec change the branch adds

// What the prompt names, read by the prerequisites.
interface Work {
    change: string;
    apply: string;
    update: string;
    pullRequest: PullRequest;
}

// What changes with the task's autonomy: its own section, how a deviation is decided, the review
// step, the closing transition, and what to do when a command or a check fails.
interface Autonomy {
    section: (work: Work) => Section;
    deviation: string;
    review: string | null;
    blocked: boolean; // whether the prompt gives the blocked path
    transition: (paths: Paths) => string;
    onFailure: string;
}

const AFK: Autonomy = {
    section: ({ apply, update }) => ({
        title: "Working without a human (AFK)",
        lines: [
            "This task carries `AFK`: no human follows this session, and nobody will answer a question.",
            "",
            `- Never ask the human anything, and never wait for an answer: a question hangs the session until someone happens to look at it. This holds inside \`${apply}\` and \`${update}\` too: where they would ask, answer yourself.`,
            "- Where the proposal leaves a gap, decide it yourself, choosing what the change's artifacts, the description, the Context section and the repository support best.",
            "- Record each assumption you make in three places: the change's design (its `design.md`), the stage summary and the logbook entry's `### Assumptions`. A human reviews the implementation later, and must see what you assumed without asking you.",
            `- A task of the change that cannot be done without a human (their go-ahead, a real write to a tracker or another outside service, a credential) is neither done nor checked. Finish every other task, then follow the section "${BLOCKED_TITLE}", and name those tasks in the stage summary. Never check a task you did not do: the transition refuses while a task is unchecked, so that unfinished work never leaves this stage.`,
            `- If you cannot finish the implementation, do not force it: follow the section "${BLOCKED_TITLE}".`,
        ],
    }),
    deviation:
        "Decide the deviation yourself, without asking, and record it as an assumption as well.",
    review: null,
    blocked: true,
    transition: ({ task, attempt, entry }) =>
        `Run \`/autonomous:run --apply --transition ${task}\`. For an \`AFK\` task it asks no one: it moves the task to \`verify\` itself, once it finds every task of the change checked and every commit pushed. If it exits non-zero, the transition was not applied: fix what its reason names, then run it once more. You may commit an uncommitted change by the rules of the commits section and push it, push the commits it names, and check a task of the change only when it is done, never one you did not do. A failed read or write (the fetch, the pull request, the tracker) needs no fix, only the second run. When what it names cannot be fixed (a task that needs a human, unfinished work), or the second run is refused too, the task is blocked: the stage summary is already posted, so do not post it again, and write a logbook entry to \`${entry}\` that says the attempt is blocked and why, quoting the transition's reason, then run \`/autonomous:run --apply --log ${attempt}\`. Write no result marker and stop: the task stays in \`implement\`, and the attempt is kept once this session ends, so a human finds it with the notice.`,
    onFailure: `treat it as a blocker: follow the section "${BLOCKED_TITLE}", and run no transition`,
};

const HITL: Autonomy = {
    section: () => ({
        title: "Working with the human (HITL)",
        lines: [
            "This task carries `HITL`: a human follows this session and reviews the implementation before the task moves on.",
            "",
            "- Ask the human when the proposal leaves a gap or a choice is theirs to make, rather than guessing.",
            "- Once every task is committed and pushed and the checks pass, show the human the implementation and the pull request's URL, and iterate on their feedback. Commit and push each round as a new commit, and never amend or rewrite a pushed commit, so the pull request keeps the history of the review.",
            "- The transition question comes only after the human has seen the implementation, because it asks them to approve the implementation as it stands.",
        ],
    }),
    deviation: "Ask the human before you change the proposal, and change it only as they decide.",
    review: "Review the implementation with the human: show them the implementation and the pull request's URL, and commit and push each round of their feedback as a new commit. Go on only when the human is done with it.",
    blocked: false,
    transition: ({ task }) =>
        `Run \`/autonomous:run --apply --transition ${task}\`. It asks the human whether to approve the implementation and move the task to \`verify\`, and applies the answer. When the human answers "Later", or the answer is not applied, stop here: publish no logbook entry, do not write the result marker, and leave this session open, so the human can come back to it.`,
    onFailure: "tell the human what it reported, and continue only as the human decides",
};

const AUTONOMIES: Record<AutonomyLabel, Autonomy> = { AFK, HITL };

// Required by the prerequisites, so its absence is a defect, not a branch without one.
function openPullRequest(context: StageContext): PullRequest {
    return JSON.parse(contextValue(context, "implement", PULL_REQUEST_KEY)) as PullRequest;
}

function workOf(context: StageContext): Work {
    return {
        change: contextValue(context, "implement", CHANGE_KEY),
        apply: contextValue(context, "implement", APPLY_WORKFLOW_KEY),
        update: contextValue(context, "implement", UPDATE_WORKFLOW_KEY),
        pullRequest: openPullRequest(context),
    };
}

function implementationSection(work: Work, autonomy: Autonomy): Section {
    const { change, apply, update, pullRequest } = work;
    const { number, title, url } = pullRequest;
    return {
        title: "Implementation",
        lines: [
            `Implement the OpenSpec change \`${change}\` by running \`${apply}\` on it, as the orchestrator (see the next section). Its proposal is approved, and lives on this workspace's branch, in the task's draft pull request #${number} "${title}", ${url}. Commit on this branch: the pull request shows every commit. Work in this order.`,
            "",
            `1. Before you implement anything, look for what an earlier attempt of this task left in this workspace: the checked tasks in \`openspec/changes/${change}/tasks.md\`, the branch's commits since the proposal (\`git log\`), and the uncommitted changes (\`git status\`). Continue from the checked tasks and the commits; do not redo them. Treat uncommitted changes as partial work on the next unchecked tasks: finish them, check their tasks and commit them. Never discard them: no \`git checkout --\`, \`git restore\`, \`git reset --hard\`, \`git clean\` or stash.`,
            `2. Run \`${apply}\` on the change \`${change}\`, and implement every task of its \`tasks.md\`, one coherent unit of work at a time (see the commits section).`,
            `3. When the implementation shows the proposal is wrong (a task cannot work as written, or the design misses a case), change the change's artifacts with \`${update}\` on this same branch, and record the deviation, with its reason, in the change's \`design.md\`, the stage summary and the logbook entry. ${autonomy.deviation}`,
            `4. Once every task is done, run every check the repository defines: its tests, linters and type checks, and whatever its contributor instructions or scripts name. Fix what fails, commit and push the fix, and run them again until they all pass. If a check cannot be made to pass, ${autonomy.onFailure}.`,
        ],
    };
}

const ORCHESTRATION: Section = {
    title: "Orchestration",
    lines: [
        "You are the orchestrator: you plan the work, delegate it to teammates, review what they hand back, and commit it. Every teammate is a Claude agent you start from this session.",
        "",
        "- Delegate the work to as many teammates as you see fit, each on a block of the change.",
        "- Give each teammate the model and the effort level its block needs. You may set any model and any effort level for a teammate, from the cheapest up, not only levels near your own. No block should cost more than it needs: choose the cheapest that does it well.",
        "- Keep your own context under about 30% until the implementation ends: leave the reading, the writing and the checking to teammates, and keep for yourself the plan, the review of their work and the commits.",
    ],
};

const COMMITS: Section = {
    title: "Commits",
    lines: [
        "- Only you commit, never a teammate: a teammate changes files and never stages, commits or pushes. Tell each teammate so.",
        "- Commit one coherent unit of work at a time: its code, its tests, and the change's task checkboxes it completes, in the same commit. Stage by path, never with `git add -A` or `git add .`, so no other file reaches the commit.",
        "- Write each message as a conventional commit, in this repository's conventions: take the type and the scope from its contributor instructions (AGENTS.md, CONTRIBUTING or the like), its commit rules (a commitlint configuration or the like) and its recent history. In a monorepo, give every commit a scope.",
        "- Mark a commit breaking (`!` after the type and scope, or a `BREAKING CHANGE` footer) only when the change's proposal declares the change breaking. Otherwise no commit carries either.",
        "- Push each commit before you start the next unit of work, so the pull request always shows the work done.",
        "- Never amend a commit and never rewrite one already pushed.",
    ],
};

function closing(paths: Paths, autonomy: Autonomy): Closing {
    return {
        done: "When every task of the change is done",
        steps: [
            `Confirm that every check the repository defines passes, that every task of the change is checked in its \`tasks.md\`, that nothing is left uncommitted, and that every commit is pushed. If something is not, finish it first; if a check cannot be made to pass, or a push fails, ${autonomy.onFailure}.`,
            ...(autonomy.review === null ? [] : [autonomy.review]),
        ],
        transition: autonomy.transition(paths),
        onFailure: autonomy.onFailure,
        logbook: {
            name: "Implementation",
            holds: "list the tasks of the change you did, and the commits by subject",
        },
    };
}

const BLOCKED = {
    stage: "implement",
    when: "When you cannot finish the implementation (the proposal contradicts itself, a check cannot be made to pass, or a task needs a human), do not force it: a human settles it from your explanation, and a forced implementation costs more than a late one. Instead:",
    steps: [
        "Commit and push what is done, by the rules of the commits section, so no work is lost. Leave unchecked every task that is not done.",
    ],
    blocks: "the implementation",
    pullRequest: "always",
} as const satisfies Blocked;

function constraintsSection(autonomy: Autonomy): Section {
    return {
        title: "Constraints",
        lines: [
            "- Commit and push only on this workspace's current branch.",
            NO_FORCE_PUSH,
            "- Leave the task's pull request a draft: never mark it ready for review, and open no other pull request.",
            `- If a push fails, ${autonomy.onFailure}.`,
            publicRepository("the commits, the change's artifacts"),
        ],
    };
}

export function implementPrompt(input: StagePromptInput): string {
    const { context } = input;
    const paths = promptPaths(input);
    const autonomy = AUTONOMIES[promptAutonomy(input, "implement")];
    const work = workOf(context);
    const sections = [
        contextSection(
            context,
            "implement",
            "The proposal's stage summary, and a grill's when the task had one, are among the comments. Weigh it all with the description above and the change's artifacts before you implement.",
        ),
        implementationSection(work, autonomy),
        ORCHESTRATION,
        COMMITS,
        autonomy.section(work),
        closingSection(paths, closing(paths, autonomy)),
        summarySection(
            context,
            "implement",
            paths.summary,
            "Name in it the pull request's URL, the OpenSpec change, the commits, and each deviation from the proposal, with its reason.",
        ),
        ...(autonomy.blocked ? [blockedSection(paths, BLOCKED)] : []),
        constraintsSection(autonomy),
    ];
    return openspecPrompt(
        input,
        "Implement the task above's OpenSpec change as the orchestrator, then close the stage. Read every section before you start.",
        sections,
    );
}
