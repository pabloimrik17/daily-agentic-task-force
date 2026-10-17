// The prompt frame every stage shares (spec stage-sessions, "Session creation
// arguments"; design D7): the attempt id, the task, the stage's instructions,
// and the absolute path and exact content of the result marker.

import { RESULT_SCHEMA } from "../attempts/result.ts";
import type { StagePromptInput } from "./stage.ts";

// The JSON the agent must write, with the attempt id filled in.
export function expectedMarker(attemptId: string): string {
    return JSON.stringify(
        {
            schema: RESULT_SCHEMA,
            attempt: attemptId,
            outcome: "completed",
            summary: "<one sentence on what was done>",
            artifacts: ["<paths of files produced, or empty>"],
            finishedAt: "<ISO 8601 time>",
        },
        null,
        2,
    );
}

export function renderPrompt(input: StagePromptInput, instructions: string): string {
    const { attempt, task, resultPath } = input;
    return [
        `# Attempt ${attempt.id}`,
        "",
        "## Task",
        "",
        `- Source: ${task.source}`,
        `- Id: ${task.id}`,
        `- Title: ${task.title}`,
        "",
        "### Description",
        "",
        task.description ?? "(no description)",
        "",
        "## Instructions",
        "",
        instructions,
        "",
        "## Result marker",
        "",
        `Write this file, at exactly this absolute path, only when the work is done, then stop: ${resultPath}`,
        "",
        "Content:",
        "",
        "```json",
        expectedMarker(attempt.id),
        "```",
        "",
    ].join("\n");
}
