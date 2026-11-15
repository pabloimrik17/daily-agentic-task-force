// The headings start one level below the Context section's own, which the prompt renders at the third.

import type { ContextLink, RelatedTask, TaskContext } from "./types.ts";

const EMPTY = "The task has no comments, relations, project, attachments or linked pull requests.";

function relatedLine({ id, title, state, url }: RelatedTask): string {
    return `${id}: ${title} (${state})${url === null ? "" : `, ${url}`}`;
}

function bullets(lines: string[]): string {
    return lines.map((line) => `- ${line}`).join("\n");
}

function section(heading: string, body: string): string {
    return `#### ${heading}\n\n${body}`;
}

function tasks(heading: string, list: RelatedTask[]): string[] {
    return list.length === 0 ? [] : [section(heading, bullets(list.map(relatedLine)))];
}

function links(heading: string, list: ContextLink[]): string[] {
    const lines = list.map(({ title, url }) => `[${title}](${url})`);
    return list.length === 0 ? [] : [section(heading, bullets(lines))];
}

function comments(list: string[]): string[] {
    const entries = list.map((body, index) => `##### Comment ${index + 1}\n\n${body}`);
    return list.length === 0 ? [] : [section("Comments", entries.join("\n\n"))];
}

function parent(value: TaskContext["parent"]): string[] {
    if (value === null) return [];
    const description =
        value.description === null ? "" : `\n\n##### Parent description\n\n${value.description}`;
    return [section("Parent", `${relatedLine(value)}${description}`)];
}

export function renderContext(context: TaskContext): string {
    const content = [
        ...comments(context.comments),
        ...parent(context.parent),
        ...tasks("Children", context.children),
        ...tasks("Blocked by", context.blockedBy),
        ...tasks("Blocks", context.blocks),
        ...tasks("Related", context.related),
        ...tasks("Duplicates", context.duplicates),
        ...(context.project === null ? [] : [section("Project", context.project)]),
        ...links("Attachments", context.attachments),
        ...links("Pull requests", context.pullRequests),
    ];
    const notes = context.notes.length === 0 ? [] : [section("Not read", bullets(context.notes))];
    return [...(content.length === 0 ? [EMPTY] : content), ...notes].join("\n\n");
}
