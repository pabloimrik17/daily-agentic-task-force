// Spec proposal-stage, "The proposal prompt". The handoff body, the propose workflow's name, the
// task's context and the open pull request come from what the prerequisites read at launch, so
// the prompt file keeps exactly the text this attempt's agent received.

import type { TaskKey } from "../../attempts/record.ts";
import type { AutonomyLabel } from "../../label-contract/contract.ts";
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
    publicRepository,
    pullRequestOf,
    type Section,
    summarySection,
} from "../openspec-stage.ts";
import type { StageContext, StagePromptInput } from "../stage.ts";

export { CONTEXT_KEY, HANDOFF_SKILL, PULL_REQUEST_KEY } from "../openspec-stage.ts";
export const WORKFLOW_KEY = "proposeWorkflow"; // `/openspec-propose` or `/opsx:propose`

// What changes with the task's autonomy: its own section, the review step, the closing
// transition, and what to do when a command fails.
interface Autonomy {
    section: (workflow: string) => Section;
    review: string | null;
    blocked: boolean; // whether the prompt gives the blocked path
    transition: (task: TaskKey) => string;
    onFailure: string;
}

const AFK: Autonomy = {
    section: (workflow) => ({
        title: "Working without a human (AFK)",
        lines: [
            "This task carries `AFK`: no human follows this session, and nobody will answer a question.",
            "",
            `- Never ask the human anything, and never wait for an answer: a question hangs the session until someone happens to look at it. This holds inside \`${workflow}\` too: where it would ask, answer yourself.`,
            "- Where the definition leaves a gap, decide it yourself, choosing what the description, the Context section and the repository support best.",
            "- Record each assumption you make in three places: the proposal's design (the change's `design.md`), the stage summary and the logbook entry's `### Assumptions`. A human reviews the proposal later, and must see what you assumed without asking you.",
            `- If you cannot write a sound proposal, do not force one: follow the section "${BLOCKED_TITLE}".`,
        ],
    }),
    review: null,
    blocked: true,
    transition: (task) =>
        `Run \`/autonomous:run --apply --transition ${task}\`. For an \`AFK\` task it asks no one: it moves the task to \`implement\` itself. If it exits non-zero, the transition was not applied: publish no logbook entry, do not write the result marker, and leave this session open, so a human finds it waiting.`,
    onFailure: `treat it as a blocker: follow the section "${BLOCKED_TITLE}", and run no transition`,
};

const HITL: Autonomy = {
    section: () => ({
        title: "Working with the human (HITL)",
        lines: [
            "This task carries `HITL`: a human follows this session and reviews the proposal before the task moves on.",
            "",
            "- Ask the human when the definition leaves a gap or a choice is theirs to make, rather than guessing.",
            "- Once the proposal is pushed and its pull request is open, show the human the proposal and the pull request's URL, and iterate on their feedback. Commit and push each round as a new commit, and never amend or rewrite a pushed commit, so the pull request keeps the history of the review.",
            "- The transition question comes only after the human has seen the proposal, because it asks them to approve the proposal as it stands.",
        ],
    }),
    review: "Review the proposal with the human: show them the proposal and the pull request's URL, and commit and push each round of their feedback as a new commit. Go on only when the human is done with it.",
    blocked: false,
    transition: (task) =>
        `Run \`/autonomous:run --apply --transition ${task}\`. It asks the human whether to approve the proposal and move the task to \`implement\`, and applies the answer. When the human answers "Later", or the answer is not applied, stop here: publish no logbook entry, do not write the result marker, and leave this session open, so the human can come back to it.`,
    onFailure: "tell the human what it reported, and continue only as the human decides",
};

const AUTONOMIES: Record<AutonomyLabel, Autonomy> = { AFK, HITL };

function openPullRequest(context: StageContext): string[] {
    const found = pullRequestOf(context);
    if (found === null) {
        return [];
    }
    const { number, title, url } = found;
    return [
        "",
        `This workspace's branch already has an open pull request: #${number} "${title}", ${url}. An earlier attempt of this task opened it. Continue it: commit on this branch, and pull-request mode finds this pull request instead of opening another.`,
    ];
}

function proposalSection(task: TaskKey, workflow: string, context: StageContext): Section {
    return {
        title: "Proposal",
        lines: [
            "Prepare one OpenSpec proposal for this task, in this order.",
            "",
            `1. Before you propose anything, look for a change an earlier attempt of this task left in this workspace: run \`openspec list\`, and look in \`openspec/changes/\` for a change that names ${task} or that this branch added, committed or not. If you find one, continue it: read its artifacts, then finish and correct them in place. Do not run \`${workflow}\` in that case, because it would create a second change, and one task ends with one OpenSpec change and one pull request.`,
            `2. Otherwise, run \`${workflow}\` with the task and its context: give it the task's id (${task}), its title, its description and the Context section. Let OpenSpec name the change; do not choose or force a name.`,
            "3. Write exactly one proposal for the whole task. Do not split the task into several changes, and create no subtask: a split is decided in a grill, not here. If the proposal turns out too large for one task, say so in the stage summary, and still write one proposal and create no subtask, so a human can decide on the split after reading it.",
            "4. Edit no project code. Write only the change's artifacts, and the glossary and ADR files the proposal needs. The code is the next stage's work, once the proposal is approved.",
            ...openPullRequest(context),
        ],
    };
}

function closing({ attempt, task }: Paths, autonomy: Autonomy): Closing {
    return {
        done: "When the proposal is written",
        steps: [
            `Commit and push the proposal on this workspace's current branch: the files of the OpenSpec change, and the glossary and ADR files you changed (see the constraints). If the push fails, ${autonomy.onFailure}.`,
            `Run \`/autonomous:run --apply --pull-request ${attempt} --title "<title>"\`. It opens the task's draft pull request, or finds the one already open. Write the title in this repository's own conventions: read its contributor instructions (AGENTS.md, CONTRIBUTING or the like) and its recent commit subjects first. Leave the task's id out of the title: the command appends it. If it exits non-zero, ${autonomy.onFailure}.`,
            ...(autonomy.review === null ? [] : [autonomy.review]),
        ],
        transition: autonomy.transition(task),
        onFailure: autonomy.onFailure,
        logbook: {
            name: "Proposal",
            holds: "name the OpenSpec change in it and list the change's files by repository-relative path",
        },
    };
}

const BLOCKED = {
    stage: "proposal",
    when: "When you cannot write a sound proposal (the definition contradicts itself, or leaves a gap no reasonable assumption fills), do not force one: a human settles the definition from your explanation, and a wrong proposal costs more than a late one. Instead:",
    steps: [],
    blocks: "the proposal",
    pullRequest: "maybe",
} as const satisfies Blocked;

function constraintsSection(autonomy: Autonomy): Section {
    return {
        title: "Constraints",
        lines: [
            "- Commit and push only the files of the OpenSpec change you wrote, under `openspec/changes/<change>/`, and the glossary and ADR files you changed, on this workspace's current branch. Stage them by path, never with `git add -A` or `git add .`, so no other file reaches the commit.",
            NO_FORCE_PUSH,
            "- Open no pull request yourself: pull-request mode opens it.",
            `- If a push fails, ${autonomy.onFailure}.`,
            publicRepository("the proposal"),
        ],
    };
}

export function proposalPrompt(input: StagePromptInput): string {
    const { context } = input;
    const paths = promptPaths(input);
    const autonomy = AUTONOMIES[promptAutonomy(input, "proposal")];
    const workflow = contextValue(context, "proposal", WORKFLOW_KEY);
    const sections = [
        contextSection(
            context,
            "proposal",
            "A grill's stage summary, when the task had a grill, is among the comments. Weigh it all with the description above before you propose.",
        ),
        proposalSection(paths.task, workflow, context),
        autonomy.section(workflow),
        closingSection(paths, closing(paths, autonomy)),
        summarySection(
            context,
            "proposal",
            paths.summary,
            "Name in it the pull request's URL, the OpenSpec change, and each deviation from the task's definition, with its reason.",
        ),
        ...(autonomy.blocked ? [blockedSection(paths, BLOCKED)] : []),
        constraintsSection(autonomy),
    ];
    return openspecPrompt(
        input,
        "Prepare the proposal for the task above with OpenSpec, then close the stage. Read every section before you start.",
        sections,
    );
}
