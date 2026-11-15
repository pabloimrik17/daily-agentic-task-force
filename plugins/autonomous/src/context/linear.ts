// linear-cli 2.6.0's `issue view --json` prints neither relations nor the parent's url and
// description, so one read-only `linear api` query reads them.

import type { Exec } from "../exec.ts";
import { type AuthoredComment, runJson } from "../label-triage/trackers/cli-json.ts";
import { mapExecError, nullableDescription } from "../label-triage/trackers/linear.ts";
import type { TrackerResult } from "../label-triage/trackers/tracker.ts";
import { array, boolean, type Json, object, string } from "../validate.ts";
import { absent, emptyContext } from "./shared.ts";
import type { ContextReader, RelatedTask, TaskContext } from "./types.ts";

const FIRST = 100;

const TASK = "identifier title url state { name }";

// Each connection asks for pageInfo, which linear-cli's own queries leave out: a full page
// is then reported instead of read as the whole list.
const QUERY = `query($id: String!) { issue(id: $id) {
    project { name }
    parent { ${TASK} description }
    children(first: ${FIRST}) { nodes { ${TASK} } pageInfo { hasNextPage } }
    relations(first: ${FIRST}) { nodes { type relatedIssue { ${TASK} } } pageInfo { hasNextPage } }
    inverseRelations(first: ${FIRST}) { nodes { type issue { ${TASK} } } pageInfo { hasNextPage } }
    attachments(first: ${FIRST}) { nodes { title url } pageInfo { hasNextPage } }
} }`;

function relatedTask(value: unknown, path: string): RelatedTask {
    const entry = object(value, path);
    return {
        id: string(entry, "identifier", path),
        title: string(entry, "title", path),
        state: string(object(entry.state, `${path}.state`), "name", `${path}.state`),
        url: string(entry, "url", path),
    };
}

function connection(issue: Json, key: string, notes: string[]): unknown[] {
    const path = `$.data.issue.${key}`;
    if (absent(issue[key])) {
        notes.push(`linear: ${key} were not read`);
        return [];
    }
    const root = object(issue[key], path);
    if (boolean(object(root.pageInfo, `${path}.pageInfo`), "hasNextPage", `${path}.pageInfo`)) {
        notes.push(`linear: ${key} has more than ${FIRST} entries, the rest were not read`);
    }
    return array(root.nodes, `${path}.nodes`);
}

interface Edge {
    type: string;
    task: RelatedTask;
}

function edges(issue: Json, key: string, side: string, notes: string[]): Edge[] {
    return connection(issue, key, notes).map((item, index) => {
        const path = `$.data.issue.${key}.nodes[${index}]`;
        const entry = object(item, path);
        return {
            type: string(entry, "type", path),
            task: relatedTask(entry[side], `${path}.${side}`),
        };
    });
}

function ofType(list: Edge[], ...types: string[]): RelatedTask[] {
    return list.filter(({ type }) => types.includes(type)).map(({ task }) => task);
}

function parent(issue: Json): TaskContext["parent"] {
    if (absent(issue.parent)) return null;
    const entry = object(issue.parent, "$.data.issue.parent");
    return {
        ...relatedTask(entry, "$.data.issue.parent"),
        description: nullableDescription(entry, "$.data.issue.parent"),
    };
}

function project(issue: Json): string | null {
    if (absent(issue.project)) return null;
    return string(object(issue.project, "$.data.issue.project"), "name", "$.data.issue.project");
}

function parseContext(value: unknown): TaskContext {
    const data = object(object(value, "$").data, "$.data");
    const issue = object(data.issue, "$.data.issue");
    const notes: string[] = [];
    const outgoing = edges(issue, "relations", "relatedIssue", notes);
    const incoming = edges(issue, "inverseRelations", "issue", notes);
    const attachments = connection(issue, "attachments", notes).map((item, index) => {
        const path = `$.data.issue.attachments.nodes[${index}]`;
        const entry = object(item, path);
        return { title: string(entry, "title", path), url: string(entry, "url", path) };
    });
    return {
        ...emptyContext(),
        parent: parent(issue),
        children: connection(issue, "children", notes).map((item, index) =>
            relatedTask(item, `$.data.issue.children.nodes[${index}]`),
        ),
        blockedBy: ofType(incoming, "blocks"),
        blocks: ofType(outgoing, "blocks"),
        related: ofType([...outgoing, ...incoming], "related"),
        duplicates: ofType([...outgoing, ...incoming], "duplicate"),
        project: project(issue),
        attachments,
        notes,
    };
}

export type ReadComments = (id: string) => Promise<TrackerResult<AuthoredComment[]>>;

export function linearContext(exec: Exec, readComments: ReadComments): ContextReader {
    return {
        source: "linear",
        async read(task) {
            const read = await runJson(
                exec,
                `linear api issue --variable id=${task.id}`,
                ["api", QUERY, "--variable", `id=${task.id}`],
                parseContext,
                mapExecError,
            );
            if (!read.ok) return read;
            const comments = await readComments(task.id);
            if (!comments.ok) return comments;
            return { ok: true, value: { ...read.value, comments: comments.value } };
        },
    };
}
