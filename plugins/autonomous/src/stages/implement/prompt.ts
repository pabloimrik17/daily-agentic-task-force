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
    CHANGE_KEY,
    type Closing,
    closingSection,
    commitsSection,
    constraintsSection,
    contextSection,
    contextValue,
    DEVIATION,
    hitlTransition,
    ON_FAILURE,
    afkTransition,
    type Move,
    openspecPrompt,
    orchestrationSection,
    type Paths,
    promptAutonomy,
    promptPaths,
    requiredPullRequest,
    type Section,
    summarySection,
    UPDATE_WORKFLOW_KEY,
} from "../openspec-stage.ts";
import type { StageContext, StagePromptInput } from "../stage.ts";

export {
    CHANGE_KEY,
    CONTEXT_KEY,
    HANDOFF_SKILL,
    PULL_REQUEST_KEY,
    UPDATE_WORKFLOW_KEY,
} from "../openspec-stage.ts";
export const APPLY_WORKFLOW_KEY = "applyWorkflow"; // `/openspec-apply-change` or `/opsx:apply`

// What the prompt names, read by the prerequisites.
interface Work {
    change: string;
    apply: string;
    update: string;
    pullRequest: PullRequest;
}

// The transition the implementation closes with.
const MOVE: Move = { left: "implement", reached: "verify" };

// What changes with the task's autonomy: its own section, the review step, the closing transition,
// and what to do when a command or a check fails; the deviation rule is shared (DEVIATION).
interface Autonomy {
    section: (work: Work) => Section;
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
    review: null,
    blocked: true,
    transition: (paths) => afkTransition(paths, MOVE),
    onFailure: ON_FAILURE.AFK,
};

const HITL: Autonomy = {
    section: () => ({
        title: "Working with the human (HITL)",
        lines: [
            "This task carries `HITL`: a human follows this session and takes a quick look at the implementation before the task moves on.",
            "",
            "- Ask the human when the proposal leaves a gap or a choice is theirs to make, rather than guessing.",
            "- Once every task is committed and pushed and the checks pass, show the human the implementation and the pull request's URL for a quick look at anything that jars, and tell them that verification, code review and QA follow. Fix only what the human clearly asks for. Commit and push each round as a new commit, and never amend or rewrite a pushed commit, so the pull request keeps the history of the review. Once a round changed anything, run the checks again before the transition.",
            "- The transition question comes only after the human has seen the implementation, because it asks them to approve the implementation as it stands.",
        ],
    }),
    review: "Give the human a quick look at the implementation: show them the implementation and the pull request's URL for anything that jars, and tell them that verification, code review and QA follow. Fix only what the human clearly asks for, and commit and push each round as a new commit. Go on only when the human is done with it, and once a round changed anything, confirm again, as in the step before, that every check passes, nothing is left uncommitted and every commit is pushed.",
    blocked: false,
    transition: (paths) => hitlTransition(paths, MOVE, "the implementation"),
    onFailure: ON_FAILURE.HITL,
};

const AUTONOMIES: Record<AutonomyLabel, Autonomy> = { AFK, HITL };

function workOf(context: StageContext): Work {
    return {
        change: contextValue(context, "implement", CHANGE_KEY),
        apply: contextValue(context, "implement", APPLY_WORKFLOW_KEY),
        update: contextValue(context, "implement", UPDATE_WORKFLOW_KEY),
        pullRequest: requiredPullRequest(context, "implement"),
    };
}

function implementationSection(work: Work, autonomy: Autonomy, deviation: string): Section {
    const { change, apply, update, pullRequest } = work;
    const { number, title, url } = pullRequest;
    return {
        title: "Implementation",
        lines: [
            `Implement the OpenSpec change \`${change}\` by running \`${apply}\` on it, as the orchestrator (see the next section). Its proposal is approved, and lives on this workspace's branch, in the task's draft pull request #${number} "${title}", ${url}. Commit on this branch: the pull request shows every commit. Work in this order.`,
            "",
            `1. Before you implement anything, look for what an earlier attempt of this task left in this workspace: the checked tasks in \`openspec/changes/${change}/tasks.md\`, the branch's commits since the proposal (\`git log\`), and the uncommitted changes (\`git status\`). Continue from the checked tasks and the commits; do not redo them. Treat uncommitted changes as partial work on the next unchecked tasks: finish them, check their tasks and commit them. Never discard them: no \`git checkout --\`, \`git restore\`, \`git reset --hard\`, \`git clean\` or stash.`,
            `2. Run \`${apply}\` on the change \`${change}\`, and implement every task of its \`tasks.md\`, one coherent unit of work at a time (see the commits section).`,
            `3. When the implementation shows the proposal is wrong (a task cannot work as written, or the design misses a case), change the change's artifacts with \`${update}\` on this same branch, and record the deviation, with its reason, in the change's \`design.md\`, the stage summary and the logbook entry. ${deviation}`,
            `4. Once every task is done, run every check the repository defines: its tests, linters and type checks, and whatever its contributor instructions or scripts name. Fix what fails, commit and push the fix, and run them again until they all pass. If a check cannot be made to pass, ${autonomy.onFailure}.`,
            "",
            "Verifying the change against its proposal, reviewing the code's quality, running what the task delivers as its end user would, and archiving the change belong to later stages (verification, code review and QA), and you do none of them. Run neither OpenSpec's verify workflow nor its archive workflow, even when the apply workflow suggests verifying or archiving once every task is done. The repository's checks, and the review of each teammate's block, stay yours.",
        ],
    };
}

const ORCHESTRATION = orchestrationSection({
    each: "a block of the change",
    ends: "the implementation ends",
});

const COMMITS = commitsSection({
    unit: "one coherent unit of work at a time: its code, its tests, and the change's task checkboxes it completes",
    next: "the next unit of work",
});

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
        "Commit and push what is done, by the rules of the commits section, so no work is lost. Leave unchecked every task that is not done. If the push fails, do not retry it and do not start this section over: keep the commits, and name the push's error and the unpushed commits in the stage summary and the logbook entry.",
    ],
    blocks: "the implementation",
    pullRequest: "always",
} as const satisfies Blocked;

export function implementPrompt(input: StagePromptInput): string {
    const { context } = input;
    const paths = promptPaths(input);
    const label = promptAutonomy(input, "implement");
    const autonomy = AUTONOMIES[label];
    const work = workOf(context);
    const sections = [
        contextSection(
            context,
            "implement",
            "The proposal's stage summary, and a grill's when the task had one, are among the comments. Weigh it all with the description above and the change's artifacts before you implement.",
        ),
        implementationSection(work, autonomy, DEVIATION[label]),
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
        constraintsSection(autonomy.onFailure, "the commits, the change's artifacts"),
    ];
    return openspecPrompt(
        input,
        "Implement the task above's OpenSpec change as the orchestrator, then close the stage. Read every section before you start.",
        sections,
    );
}
