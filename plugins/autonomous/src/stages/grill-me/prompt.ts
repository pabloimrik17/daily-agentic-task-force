// The skill bodies come from the context the prerequisites read at launch, so the prompt
// file keeps exactly the text this attempt's agent received.

import { dirname } from "node:path";

import { type TaskKey, taskKey } from "../../attempts/record.ts";
import { definitionPath, logbookEntryPath, stageSummaryPath } from "../../attempts/state.ts";
import { MAX_WORDS } from "../../logbook/body.ts";
import { DEFINITION_HEADING } from "../../persist/splice.ts";
import { renderPrompt } from "../prompt.ts";
import type { StageContext, StagePromptInput } from "../stage.ts";
import { HANDOFF_SKILL, SKILLS_PLUGIN } from "../skills.ts";

export { SKILLS_PLUGIN } from "../skills.ts";

const GRILL_SKILL = "grill-with-docs";

export const GRILL_ME_SKILLS: readonly string[] = [GRILL_SKILL, HANDOFF_SKILL];

interface Closing {
    attempt: string;
    task: TaskKey;
    definition: string;
    summary: string;
    entry: string;
}

function skillBody(context: StageContext, name: string): string {
    const body = context[name];
    if (body === undefined) {
        throw new Error(`the grill-me prerequisites read no ${name} skill`);
    }
    return body.trim();
}

function grill(context: StageContext): string[] {
    return [
        "### 1. Grill",
        "",
        skillBody(context, GRILL_SKILL),
        "",
        `Every skill named in this section is a skill of the \`${SKILLS_PLUGIN}\` plugin: invoke it with the Skill tool as \`${SKILLS_PLUGIN}:<name>\`.`,
    ];
}

const TEMPLATE = [
    "```markdown",
    DEFINITION_HEADING,
    "",
    "### Problem",
    "",
    "<what is wrong or missing, and why it matters>",
    "",
    "### Solution",
    "",
    "<what changes, as far as the grill settled it>",
    "",
    "### Acceptance criteria",
    "",
    "- <a criterion a reviewer can check>",
    "",
    "### Non-goals",
    "",
    "- <what this task does not do>",
    "",
    "### Decisions",
    "",
    "- <a decision taken in the grill, and its reason>",
    "",
    "### Proposed autonomy",
    "",
    "<AFK or HITL, as the grill proposes it>: <the reason>",
    "",
    "### Artifacts",
    "",
    '- <repository-relative paths of the glossary and ADR files changed, and the ids of any subtasks; or "none">',
    "```",
];

function closing({ attempt, task, definition, summary, entry }: Closing): string[] {
    return [
        "### 2. Closing",
        "",
        "When the grill is over, close the stage in this order. Never skip or reorder a step.",
        "",
        "1. Confirm the definition with the human, and whether to split the task into subtasks (section 4).",
        "2. Only if the grill changed glossary or ADR files, commit and push them (section 4).",
        `3. Write the definition to \`${definition}\`, following the template below. Write the stage summary to \`${summary}\` (section 3). Create the subtasks of a confirmed split (section 4).`,
        `4. Run \`/autonomous:run --apply --persist ${attempt}\`. It writes the definition into the task's description and posts the stage summary as a comment on the task. If it exits non-zero, tell the human what it reported, and do not run the transition.`,
        "5. Show the human the task's URL, or its id when the task has no URL.",
        `6. Run \`/autonomous:run --apply --transition ${task}\`. It asks the human for the task's autonomy and applies the answer.`,
        `7. Run \`/autonomous:run --apply --pull-request ${attempt} --title "<title>"\`. It pushes the branch and opens the pull request, or finds the one already open. Write the title in this repository's own conventions: read its contributor instructions (AGENTS.md, CONTRIBUTING or the like) and its recent commit subjects first. Do not add the task's id to the title: the command appends it. If it exits non-zero, tell the human what it reported (a failed push included), and continue only as the human decides. If it reports that the task needs no pull request (the parent of a split, when the grill committed no documentation), skip step 8.`,
        `8. Write the logbook entry's body to \`${entry}\` (described below), then run \`/autonomous:run --apply --log ${attempt}\`. It publishes the entry as a comment on the pull request. If log mode rejects the body, correct \`${entry}\` as it reports and run it again.`,
        `9. Only once the entry is published (or step 8 was skipped because the task needs no pull request), write the result marker. When the human answers "Later" to the transition question, or the answer is not applied, do not run steps 7 to 9: open no pull request, publish no entry, do not write the marker, and leave this session open.`,
        "",
        "The one exception: if the human decides to close the task instead of defining it, the human closes it in its tracker, or tells you to and you close it there. Then skip steps 2 to 8 (no docs commit, no definition, no persist, no transition, no pull request, no logbook entry), write the result marker with a summary saying the task was closed, and stop.",
        "",
        `Definition template. Its first line is \`${DEFINITION_HEADING}\`, exactly:`,
        "",
        ...TEMPLATE,
        "",
        "The Proposed autonomy section only records what the grill proposes. The task's autonomy label, set by the transition in step 6, is the decision: if the human answers another autonomy, leave the definition as it is and do not run persist again.",
        "",
        `The logbook entry's body, in \`${entry}\`, addresses a person catching up on the pull request, not the next agent. It has these four sections, in this order, and a stage may add its own after them: \`### What I did\`, \`### Decisions\`, \`### Assumptions\` and \`### Next stage\`. It holds at most ${MAX_WORDS} words. Mark each decision as the agent's or the human's. Next stage links this task's stage summary without repeating it. \`none\` is fine for Decisions or Assumptions. Do not write the entry's header: log mode writes it.`,
    ];
}

function stageSummary(context: StageContext, summary: string): string[] {
    return [
        "### 3. Stage summary",
        "",
        skillBody(context, HANDOFF_SKILL),
        "",
        `Override: write this handoff document at step 3 of the closing, to \`${summary}\`, not to the temporary directory.`,
    ];
}

const CONSTRAINTS = [
    "### 4. Constraints",
    "",
    "- Do not prepare a proposal for this task in this session.",
    "- Commit and push only the glossary and ADR files the grill changed, on this workspace's current branch. Open no pull request yourself: pull-request mode opens it. Never force a push and never pass `--no-verify`. When the grill changed no such file, commit and push nothing.",
    "- If a push fails, tell the human why, and continue only as the human decides.",
    "- When the human confirms a split, create each subtask with the `autonomous:labelling-new-tasks` skill, as a native subtask of this task in the same tracker, through that tracker's parent option. Each subtask's description holds its own definition, in the template above, and each subtask gets its own autonomy. This task keeps the overall definition and still goes through its own persist, transition and pull-request mode (steps 4 to 7); pull-request mode opens a pull request for it only when the grill committed documentation.",
    "- Before a Linear split, tell the human how many Linear issues it creates: the free plan limits them.",
];

const PUBLIC_ISSUE =
    "- The issue and the pull request may be public: write no absolute path and no other detail of this machine (user name, home directory, host name) in the definition, the stage summary or the logbook entry; use repository-relative paths and URLs.";

export function grillMePrompt(input: StagePromptInput): string {
    const { attempt, resultPath, context } = input;
    const dir = dirname(resultPath);
    const summary = stageSummaryPath(dir);
    const instructions = [
        "Refine the task above with the human: grill it (section 1), then close the stage (sections 2 to 4).",
        "",
        ...grill(context),
        "",
        ...closing({
            attempt: attempt.id,
            task: taskKey(attempt.task.source, attempt.task.id),
            definition: definitionPath(dir),
            summary,
            entry: logbookEntryPath(dir),
        }),
        "",
        ...stageSummary(context, summary),
        "",
        ...CONSTRAINTS,
        PUBLIC_ISSUE,
    ];
    return renderPrompt(input, instructions.join("\n"));
}
