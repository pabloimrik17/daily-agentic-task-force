// The parent in `gh issue view --json` has no body, so a second call reads it.

import type { Exec } from "../exec.ts";
import type { TrackerResult } from "../label-triage/trackers/tracker.ts";
import {
    type AuthoredComment,
    authoredComments,
    runJson,
} from "../label-triage/trackers/cli-json.ts";
import { array, type Json, number, object, string } from "../validate.ts";
import { ISSUE_URL, splitId } from "../select/readers/github.ts";
import { absent, emptyContext } from "./shared.ts";
import type { ContextLink, ContextReader, RelatedTask, TaskContext } from "./types.ts";

const FIELDS = "comments,subIssues,parent,closedByPullRequestsReferences";

function relatedTask(value: unknown, path: string, repository: string): RelatedTask {
    const entry = object(value, path);
    const url = string(entry, "url", path);
    return {
        id: `${ISSUE_URL.exec(url)?.[1] ?? repository}#${number(entry, "number", path)}`,
        title: string(entry, "title", path),
        state: string(entry, "state", path),
        url,
    };
}

function children(root: Json, repository: string, notes: string[]): RelatedTask[] {
    if (absent(root.subIssues)) {
        notes.push("github: sub-issues were not read");
        return [];
    }
    const nodes = array(object(root.subIssues, "$.subIssues").nodes, "$.subIssues.nodes");
    return nodes.map((item, index) => relatedTask(item, `$.subIssues.nodes[${index}]`, repository));
}

function parent(root: Json, repository: string): TaskContext["parent"] {
    if (absent(root.parent)) return null;
    return { ...relatedTask(root.parent, "$.parent", repository), description: null };
}

// gh prints a closing pull request with its number, repository and url but no title.
function pullRequests(root: Json, notes: string[]): ContextLink[] {
    if (absent(root.closedByPullRequestsReferences)) {
        notes.push("github: linked pull requests were not read");
        return [];
    }
    const items = array(root.closedByPullRequestsReferences, "$.closedByPullRequestsReferences");
    return items.map((item, index) => {
        const path = `$.closedByPullRequestsReferences[${index}]`;
        const entry = object(item, path);
        const repository = object(entry.repository, `${path}.repository`);
        const owner = string(object(repository.owner, `${path}.repository.owner`), "login", path);
        const name = string(repository, "name", `${path}.repository`);
        return {
            title: `${owner}/${name}#${number(entry, "number", path)}`,
            url: string(entry, "url", path),
        };
    });
}

// A deleted account leaves a comment with a null author.
function login(comment: Json, path: string): string | null {
    if (absent(comment.author)) return null;
    return string(object(comment.author, `${path}.author`), "login", `${path}.author`);
}

function comments(root: Json): AuthoredComment[] {
    const keys = { body: "body", createdAt: "createdAt" };
    return authoredComments(array(root.comments, "$.comments"), "$.comments", keys, login);
}

function parseContext(repository: string): (value: unknown) => TaskContext {
    return (value) => {
        const root = object(value, "$");
        const notes = ["github: dependencies were not read"];
        return {
            ...emptyContext(),
            comments: comments(root),
            parent: parent(root, repository),
            children: children(root, repository, notes),
            pullRequests: pullRequests(root, notes),
            notes,
        };
    };
}

async function withParentBody(
    exec: Exec,
    context: TaskContext,
): Promise<TrackerResult<TaskContext>> {
    if (context.parent === null) return { ok: true, value: context };
    const { repository, number: issue } = splitId(context.parent.id);
    const result = await runJson(
        exec,
        `gh issue view ${issue} --repo ${repository} --json body`,
        ["issue", "view", issue, "--repo", repository, "--json", "body"],
        (value) => string(object(value, "$"), "body", "$"),
    );
    if (!result.ok) return result;
    return {
        ok: true,
        value: { ...context, parent: { ...context.parent, description: result.value } },
    };
}

export function githubContext(exec: Exec): ContextReader {
    return {
        source: "github",
        async read(task) {
            const { repository, number: issue } = splitId(task.id);
            const result = await runJson(
                exec,
                `gh issue view ${issue} --repo ${repository} --json ${FIELDS}`,
                ["issue", "view", issue, "--repo", repository, "--json", FIELDS],
                parseContext(repository),
            );
            return result.ok ? withParentBody(exec, result.value) : result;
        },
    };
}
