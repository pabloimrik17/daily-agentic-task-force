// Spec verification-stage, "The verification prompt". The handoff body, the adversarial review's
// body, the verify and update workflows' names, the change, the open pull request and the task's
// context come from what the prerequisites read at launch, so the prompt file keeps exactly the
// text this attempt's agent received. The adversarial review's parameters are this prompt's to
// supply (design D4); the skill names no fact about the verification.

import { dirname, join } from "node:path";

import type { AutonomyLabel } from "../../label-contract/contract.ts";
import type { PullRequest } from "../../pull-request/port.ts";
import {
    afkTransition,
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
    type Move,
    openspecPrompt,
    orchestrationSection,
    type Paths,
    promptAutonomy,
    promptPaths,
    PULL_REQUEST_KEY,
    type Section,
    summarySection,
} from "../openspec-stage.ts";
import type { StageContext, StagePromptInput } from "../stage.ts";

export const VERIFY_WORKFLOW_KEY = "verifyWorkflow"; // `/openspec-verify-change` or `/opsx:verify`
export const UPDATE_WORKFLOW_KEY = "updateWorkflow"; // `/openspec-update-change` or `/opsx:update`
export const ADVERSARIAL_REVIEW_KEY = "adversarialReview"; // the skill's body, frontmatter stripped

// Design D11: the record of the findings, beside the result marker, outside the repository.
const FINDINGS_FILE = "findings.md";

// What the prompt names, read by the prerequisites.
interface Work {
    change: string;
    verify: string;
    update: string;
    pullRequest: PullRequest;
    review: string; // the adversarial review's body
}

// The transition the verification closes with.
const MOVE: Move = { left: "verify", reached: "code-review" };

// What changes with the task's autonomy: its own section, what it does with uncommitted changes
// no finding claims, a proposal that contradicts the definition, whether a human follows the
// adversarial review, the follow-up tasks, the review step, the closing transition, and what to
// do when a command or a check fails; the deviation rule is shared (DEVIATION).
interface Autonomy {
    section: (work: Work) => Section;
    unclaimed: string;
    contradiction: string;
    human: string;
    followUps: string;
    review: string | null;
    blocked: boolean; // whether the prompt gives the blocked path
    transition: (paths: Paths) => string;
    onFailure: string;
}

const CONTRADICTION =
    "When the proposal contradicts the task's definition and the change's design records no deviation that explains it,";

const AFK: Autonomy = {
    section: ({ verify, update }) => ({
        title: "Working without a human (AFK)",
        lines: [
            "This task carries `AFK`: no human follows this session, and nobody will answer a question.",
            "",
            `- Never ask the human anything, and never wait for an answer: a question hangs the session until someone happens to look at it. This holds inside \`${verify}\` and \`${update}\` too: where they would ask, answer yourself.`,
            "- Decide the finding triage yourself: each finding's destination, with its reason.",
            "- Record each decision and each assumption you make in the stage summary and the logbook entry's `### Decisions` and `### Assumptions`. A human reviews the verification later, and must see what you decided without asking you.",
            `- If you cannot finish the verification, do not force it: follow the section "${BLOCKED_TITLE}".`,
        ],
    }),
    unclaimed: `Uncommitted changes that no finding claims by the end of the round block the attempt: follow the section "${BLOCKED_TITLE}", and name them in the stage summary.`,
    contradiction: `${CONTRADICTION} the definition wins: bring the code and the proposal to it, and record the deviation as above.`,
    human: "no: this task carries `AFK`.",
    followUps: "Create none: no human vets them.",
    review: null,
    blocked: true,
    transition: (paths) => afkTransition(paths, MOVE),
    onFailure: `treat it as a blocker: follow the section "${BLOCKED_TITLE}", and run no transition`,
};

const HITL: Autonomy = {
    section: () => ({
        title: "Working with the human (HITL)",
        lines: [
            "This task carries `HITL`: a human follows this session and reviews the verification before the task moves on.",
            "",
            "- Ask the human when a choice is theirs to make, rather than guessing.",
            "- Show the human the finding triage, each finding with its destination and reason, before the refutation starts, and apply their changes to it.",
            "- A fix rejected by two fix checks goes to the human: show them the finding and the rejections, and continue only as they decide.",
            "- The transition question comes only after the human has seen the outcome and the pull request, because it asks them to approve the verification as it stands.",
        ],
    }),
    unclaimed:
        "Show the human the uncommitted changes that no finding claims by the end of the round, and do with them only what they decide.",
    contradiction: `${CONTRADICTION} ask the human which wins, bring the code and the proposal to their answer, and record the deviation as above.`,
    human: "yes: this task carries `HITL`.",
    followUps:
        "Show the human the proposed follow-up tasks, and create only those they confirm, in the task's own tracker, labelled at creation by following the autonomous plugin's `labelling-new-tasks` skill. Relate each one to the task, never as its subtask: on Linear, `linear issue relation add <new> related <task>`; on Beads, `bd dep add <new> <task> --type related`; on GitHub, which has no such relation, a link to the task in the new issue's body. A follow-up task the human does not confirm stays proposed.",
    review: "Review the outcome with the human: show them each finding by outcome, with its reason, the proposed follow-up tasks and the pull request's URL. Commit and push each round of their feedback as a new commit. Go on only when the human is done with it, and once a round changed anything, confirm again, as in the step before, that every check passes, nothing is left uncommitted and every commit is pushed.",
    blocked: false,
    transition: (paths) => hitlTransition(paths, MOVE, "the verification"),
    onFailure: "tell the human what it reported, and continue only as the human decides",
};

const AUTONOMIES: Record<AutonomyLabel, Autonomy> = { AFK, HITL };

// Required by the prerequisites, so its absence is a defect, not a branch without one.
function openPullRequest(context: StageContext): PullRequest {
    return JSON.parse(contextValue(context, "verify", PULL_REQUEST_KEY)) as PullRequest;
}

function workOf(context: StageContext): Work {
    return {
        change: contextValue(context, "verify", CHANGE_KEY),
        verify: contextValue(context, "verify", VERIFY_WORKFLOW_KEY),
        update: contextValue(context, "verify", UPDATE_WORKFLOW_KEY),
        pullRequest: openPullRequest(context),
        review: contextValue(context, "verify", ADVERSARIAL_REVIEW_KEY),
    };
}

const REVIEW_TITLE = "The adversarial review";

// Design D10: the earlier attempt's fixes stay; its uncommitted changes are an unfinished fix.
function resumeStep(autonomy: Autonomy): string {
    return `Before the report, look for what an earlier attempt of this task left in this workspace: the branch's commits since the implementation (\`git log\`) and the uncommitted changes (\`git status\`). This round starts afresh: the earlier attempt's stage summary, among the comments, says what it did. Its fix commits stay, and are part of what the report checks; do not revert or redo them. Treat uncommitted changes as an unfinished fix: keep them in the working tree, and commit them only once a fix check of this round accepts them as the fix of a surviving finding. Never discard them: no \`git checkout --\`, \`git restore\`, \`git reset --hard\`, \`git clean\` or stash. ${autonomy.unclaimed}`;
}

function verificationSection(work: Work, autonomy: Autonomy, deviation: string): Section {
    const { change, verify, update, pullRequest } = work;
    const { number, title, url } = pullRequest;
    return {
        title: "Verification",
        lines: [
            `Verify the OpenSpec change \`${change}\` as the orchestrator (see the orchestration section): check that the implementation on this workspace's branch matches the change's proposal and the task's definition, and correct what does not. The change and its implementation live in the task's draft pull request #${number} "${title}", ${url}. The repository provides the verify workflow as \`${verify}\` and the update workflow as \`${update}\`. Commit on this branch: the pull request shows every commit. Work in this order.`,
            "",
            `1. ${resumeStep(autonomy)}`,
            `2. Run one round of the adversarial review, as the section "${REVIEW_TITLE}" sets it up. Its report checks the implementation against the proposal, by running \`${verify}\` on the change \`${change}\` as it is, with all its checks, Code Pattern Consistency included; and against the task's definition, the description above: each acceptance criterion it holds is met, including one that no requirement of the change covers, and none of its non-goals is done. A deviation the change's \`design.md\` already records, with its reason, is the proposal's word, not a finding.`,
            `3. A fix brings the code to the proposal, unless the refutation shows the proposal is the one that is wrong: then change the change's artifacts with \`${update}\` on this same branch, and record the deviation, with its reason, in the change's \`design.md\`, the stage summary and the logbook entry. ${deviation} ${autonomy.contradiction}`,
            "4. Stay within the verification. A deeper review of the code's quality is code review's, and running what the task delivers as its end user would is QA's: pass a finding that belongs to either on to that stage, under its heading in the stage summary, and never fix it here.",
            `5. Once the fixes are committed and pushed, run every check the repository defines: its tests, linters and type checks, and whatever its contributor instructions or scripts name. Fix what fails, commit and push the fix, and run them again until they all pass. If a check cannot be made to pass, ${autonomy.onFailure}.`,
        ],
    };
}

// Design D4: the parameters the skill takes from its caller, right before its body.
function reviewSection(work: Work, autonomy: Autonomy, findings: string): Section {
    const { change, verify, review } = work;
    return {
        title: REVIEW_TITLE,
        lines: [
            "Correct what the verification finds through one round of the adversarial review below, as its orchestrator: run no second report after the fixes, even when every fix passes its fix check. These are its parameters:",
            "",
            "- Subject: the implementation on this workspace's branch.",
            `- References: the change's proposal, its artifacts under \`openspec/changes/${change}/\`, and the task's definition, its description above.`,
            `- The report's procedure: \`${verify}\` on the change \`${change}\`, with all its checks.`,
            "- Severity scale: the verify workflow's `CRITICAL`, `WARNING` and `SUGGESTION`. The floor is `CRITICAL`.",
            "- Later reviews: code review, under the heading `Code review` in the stage summary, and QA, under the heading `QA`.",
            `- Record: \`${findings}\`, in this attempt's directory. It stays outside the repository and every tracker: never commit it and never post it. Build the stage summary and the logbook entry's \`### Verification\` from it.`,
            `- Whether a human follows the review: ${autonomy.human}`,
            "",
            `Each deferred finding that survives the refutation becomes a proposed follow-up task, with its title, its reason and the finding it comes from, in the stage summary and the logbook entry. ${autonomy.followUps}`,
            "",
            review.trim(),
        ],
    };
}

const ORCHESTRATION = orchestrationSection({
    each: "a part of a phase of the adversarial review",
    ends: "the verification ends",
});

const SHARED_COMMITS = commitsSection({
    unit: "each fixed finding on its own: its fix, and its reproduction test when it has one",
    next: "the next fix",
});

const COMMITS: Section = {
    ...SHARED_COMMITS,
    lines: [
        ...SHARED_COMMITS.lines,
        "- Commit a fix only once its fix check accepts it, and commit an update of the change's artifacts with the fix it belongs to.",
    ],
};

function closing(paths: Paths, autonomy: Autonomy): Closing {
    return {
        done: "When the round's fixes are committed and pushed",
        steps: [
            `Confirm that every check the repository defines passes, that nothing is left uncommitted, and that every commit is pushed. If something is not, finish it first; if a check cannot be made to pass, or a push fails, ${autonomy.onFailure}.`,
            ...(autonomy.review === null ? [] : [autonomy.review]),
        ],
        transition: autonomy.transition(paths),
        onFailure: autonomy.onFailure,
        logbook: {
            name: "Verification",
            holds: "list the findings fixed, with their commits by subject, and those refuted, passed on, deferred and dismissed",
        },
    };
}

const BLOCKED = {
    stage: "verify",
    when: "When you cannot finish the verification (a fix rejected by two fix checks, a check that cannot be made to pass, or a fix that needs a human), do not force it: a human settles it from your explanation, and a forced fix costs more than a late one. Instead:",
    steps: [
        "Commit and push the fixes their fix checks accepted, by the rules of the commits section, so no work is lost. Commit no fix that no fix check accepted, and name its finding and its rejections in the stage summary. If the push fails, do not retry it and do not start this section over: keep the commits, and name the push's error and the unpushed commits in the stage summary and the logbook entry.",
    ],
    blocks: "the verification",
    pullRequest: "always",
} as const satisfies Blocked;

export function verifyPrompt(input: StagePromptInput): string {
    const { context } = input;
    const paths = promptPaths(input);
    const label = promptAutonomy(input, "verify");
    const autonomy = AUTONOMIES[label];
    const work = workOf(context);
    const sections = [
        contextSection(
            context,
            "verify",
            "The implementation's and the proposal's stage summaries, and a grill's when the task had one, are among the comments. Weigh it all with the description above, the change's artifacts and the branch's commits before you verify.",
        ),
        verificationSection(work, autonomy, DEVIATION[label]),
        reviewSection(work, autonomy, join(dirname(input.resultPath), FINDINGS_FILE)),
        ORCHESTRATION,
        COMMITS,
        autonomy.section(work),
        closingSection(paths, closing(paths, autonomy)),
        summarySection(
            context,
            "verify",
            paths.summary,
            "Name in it the pull request's URL, the OpenSpec change, the commits, each finding by outcome (fixed, refuted, passed on, deferred or dismissed) with its reason, the findings passed on under a heading per later stage (`Code review`, `QA`), the proposed follow-up tasks, and each deviation from the proposal, with its reason.",
        ),
        ...(autonomy.blocked ? [blockedSection(paths, BLOCKED)] : []),
        constraintsSection(
            autonomy.onFailure,
            "the commits, the change's artifacts, any follow-up task",
        ),
    ];
    return openspecPrompt(
        input,
        "Verify the task above's OpenSpec change as the orchestrator, then close the stage. Read every section before you start.",
        sections,
    );
}
