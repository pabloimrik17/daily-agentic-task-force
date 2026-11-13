import { definitionOf } from "../persist/splice.ts";
import type { TaskLink, WorkTask } from "../select/types.ts";

const MAX_FALLBACK = 500;
const SECTIONS = ["### Problem", "### Solution"];

// A link is clickable when the tracker gave a URL, and the bare id in code otherwise.
function link({ id, url }: TaskLink): string {
    return url === null || url === "" ? `\`${id}\`` : `[${id}](${url})`;
}

// A section runs from its heading line to the next `## ` or `### ` heading, or the end.
function section(definition: string, heading: string): string | null {
    const lines = definition.split("\n");
    const start = lines.findIndex((line) => line.trimEnd() === heading);
    if (start === -1) return null;
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((line) => /^#{2,3} /.test(line));
    return [heading, ...(end === -1 ? rest : rest.slice(0, end))].join("\n").trim();
}

// The first paragraph, cut so the result with its ellipsis is at most MAX_FALLBACK characters.
function firstParagraph(description: string): string {
    const paragraph = (description.trim().split(/\n\s*\n/)[0] ?? "").trim();
    if (paragraph.length <= MAX_FALLBACK) return paragraph;
    return `${paragraph.slice(0, MAX_FALLBACK - 1).trimEnd()}…`;
}

function body(description: string | null): string[] {
    if (description === null || description.trim() === "") return [];
    const definition = definitionOf(description);
    if (definition === null) return [firstParagraph(description)];
    return SECTIONS.flatMap((heading) => section(definition, heading) ?? []);
}

// The pull request's description: the links to the task and its parent, then the
// definition's Problem and Solution, or the first paragraph of a task never grilled
// (spec stage-logbook, "The cover" and "Cover of a task without a definition"; design D4).
export function cover(task: WorkTask, parent: TaskLink | null): string {
    const links = [`Task: ${link({ id: task.id, url: task.url ?? null })}`];
    if (parent !== null) links.push(`Parent: ${link(parent)}`);
    return [links.join("\n"), ...body(task.description)].join("\n\n");
}
