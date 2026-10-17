import type { StepResult } from "../runner.ts";
import { byReason } from "../select/render.ts";
import type { Excluded } from "../select/types.ts";
import type { LaunchData } from "./launch.ts";

type Field = [name: string, value: string | null];

// The exclusion as the select step's report names it.
export function exclusionName(excluded: Excluded): string {
    return byReason([excluded])[0]?.name ?? excluded.reason;
}

export function renderLaunch(result: StepResult<LaunchData>): string {
    const fields = [...unitFields(result.data), ...launchFields(result.data)];
    return [
        `[${result.step}] ${result.outcome} (${result.tier})`,
        ...fields.flatMap(([name, value]) =>
            value === null ? [] : [`  ${name.padEnd(11)} ${value}`],
        ),
        "  reasons:",
        ...result.reasons.map((r) => `    - ${r}`),
    ].join("\n");
}

function unitFields({ task, stage, input, repository }: LaunchData): Field[] {
    return [
        ["task", task && `${task.source} → ${task.id} → ${task.title}`],
        ["stage", stage],
        ["input", input],
        ["repository", repository && `${repository.path} (from ${repository.inferredFrom})`],
    ];
}

function launchFields({ branch, group, title, workspace, attempt, excluded }: LaunchData): Field[] {
    return [
        ["branch", branch],
        ["group", group],
        ["title", title && renderTitle(title)],
        [
            "workspace",
            workspace && `${workspace.path} (${workspace.created ? "created" : "reused"})`,
        ],
        ["attempt", attempt && renderAttempt(attempt)],
        ["excluded", excluded && exclusionName(excluded)],
    ];
}

function renderTitle(title: NonNullable<LaunchData["title"]>): string {
    const source = title.error === null ? title.source : `${title.source}: ${title.error}`;
    return `${title.value} (${source})`;
}

function renderAttempt(attempt: NonNullable<LaunchData["attempt"]>): string {
    const session = attempt.session === null ? "no session" : `session ${attempt.session}`;
    return `${attempt.id} ${attempt.state}, ${session}`;
}
