// Spec verification-stage, "The verification prompt". The handoff body, the adversarial review's
// body, the verify and update workflows' names, the change, the open pull request and the task's
// context come from what the prerequisites read at launch, so the prompt file keeps exactly the
// text this attempt's agent received. The adversarial review's parameters are this prompt's to
// supply (design D4); the skill names no fact about the verification.

import { dirname, join } from "node:path";

import type { AutonomyLabel } from "../../label-contract/contract.ts";
import type { PullRequest } from "../../pull-request/port.ts";
import {
    ACCEPTED_FIXES,
    afkReviewSection,
    afkTransition,
    type Blocked,
    blockedSection,
    CHANGE_KEY,
    checksStep,
    type Closing,
    closingSection,
    CONFIRMED_FOLLOW_UPS,
    confirmStep,
    constraintsSection,
    contextSection,
    contextValue,
    DEVIATION,
    fixCommitsSection,
    HUMAN_FOLLOWS,
    hitlReviewSection,
    hitlTransition,
    ON_FAILURE,
    type Move,
    NO_FOLLOW_UPS,
    openspecPrompt,
    orchestrationSection,
    type Paths,
    PROPOSED_FOLLOW_UPS,
    promptAutonomy,
    promptPaths,
    REVIEW_TITLE,
    requiredPullRequest,
    resumeReview,
    reviewBlockedWhen,
    type Section,
    summarySection,
    UNCLAIMED,
    UPDATE_WORKFLOW_KEY,
} from "../openspec-stage.ts";
import type { StageContext, StagePromptInput } from "../stage.ts";

export { UPDATE_WORKFLOW_KEY } from "../openspec-stage.ts";
export const VERIFY_WORKFLOW_KEY = "verifyWorkflow"; // `/openspec-verify-change` or `/opsx:verify`
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
    section: ({ verify, update }) =>
        afkReviewSection(
            "the verification",
            `This holds inside \`${verify}\` and \`${update}\` too: where they would ask, answer yourself.`,
        ),
    unclaimed: UNCLAIMED.AFK,
    contradiction: `${CONTRADICTION} the definition wins: bring the code and the proposal to it, and record the deviation as above.`,
    human: HUMAN_FOLLOWS.AFK,
    followUps: NO_FOLLOW_UPS,
    review: null,
    blocked: true,
    transition: (paths) => afkTransition(paths, MOVE),
    onFailure: ON_FAILURE.AFK,
};

const HITL: Autonomy = {
    section: () =>
        hitlReviewSection("the verification", [
            "- The transition question comes only after the human has seen the outcome and the pull request, because it asks them to approve the verification as it stands.",
        ]),
    unclaimed: UNCLAIMED.HITL,
    contradiction: `${CONTRADICTION} ask the human which wins, bring the code and the proposal to their answer, and record the deviation as above.`,
    human: HUMAN_FOLLOWS.HITL,
    followUps: CONFIRMED_FOLLOW_UPS,
    review: "Review the outcome with the human: show them each finding by outcome, with its reason, the proposed follow-up tasks and the pull request's URL. Commit and push each round of their feedback as a new commit. Go on only when the human is done with it, and once a round changed anything, confirm again, as in the step before, that every check passes, nothing is left uncommitted and every commit is pushed.",
    blocked: false,
    transition: (paths) => hitlTransition(paths, MOVE, "the verification"),
    onFailure: ON_FAILURE.HITL,
};

const AUTONOMIES: Record<AutonomyLabel, Autonomy> = { AFK, HITL };

function workOf(context: StageContext): Work {
    return {
        change: contextValue(context, "verify", CHANGE_KEY),
        verify: contextValue(context, "verify", VERIFY_WORKFLOW_KEY),
        update: contextValue(context, "verify", UPDATE_WORKFLOW_KEY),
        pullRequest: requiredPullRequest(context, "verify"),
        review: contextValue(context, "verify", ADVERSARIAL_REVIEW_KEY),
    };
}

// Design D10: the earlier attempt's fixes stay; its uncommitted changes are an unfinished fix.
function resumeStep(autonomy: Autonomy): string {
    return resumeReview(
        "the branch's commits since the implementation (`git log`) and the uncommitted changes (`git status`)",
        autonomy.unclaimed,
    );
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
            `4. Stay within the verification. A deeper review of the code's quality is code review's, and running what the task delivers as its end user would is QA's: pass a finding that belongs to either on to that stage, whatever its severity, under its heading in the stage summary, and never fix it here. Every finding \`${verify}\` reports is the verification's own, whatever it concerns: weigh it and decide it here, as any other finding, and never pass it on to a later stage.`,
            `5. ${checksStep(autonomy.onFailure)}`,
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
            `- Later reviews: code review, under the heading \`Code review\` in the stage summary, and QA, under the heading \`QA\`. A finding that belongs to either goes to it whatever its severity, unless \`${verify}\` reported it: that one is the verification's own, decided here like any other finding, and never passed on.`,
            `- Record: \`${findings}\`, in this attempt's directory. It stays outside the repository and every tracker: never commit it and never post it. Build the stage summary and the logbook entry's \`### Verification\` from it.`,
            `- Whether a human follows the review: ${autonomy.human}`,
            "",
            `${PROPOSED_FOLLOW_UPS} ${autonomy.followUps}`,
            "",
            review.trim(),
        ],
    };
}

const ORCHESTRATION = orchestrationSection({
    each: "a part of a phase of the adversarial review",
    ends: "the verification ends",
});

const COMMITS = fixCommitsSection([
    "- Commit a fix only once its fix check accepts it, and commit an update of the change's artifacts with the fix it belongs to.",
]);

function closing(paths: Paths, autonomy: Autonomy): Closing {
    return {
        done: "When the round's fixes are committed and pushed",
        steps: [
            confirmStep(autonomy.onFailure),
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
    when: reviewBlockedWhen(
        "the verification",
        "a fix rejected by two fix checks, a check that cannot be made to pass, or a fix that needs a human",
    ),
    steps: [ACCEPTED_FIXES],
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
