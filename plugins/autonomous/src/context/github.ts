// GitHub context (spec proposal-stage, "The run gathers the task's context" and "Context that
// only some trackers have"): one `gh issue view --json` carries the comments, the sub-issues, the
// parent and the pull requests that close the issue. Its parent has no body, and GitHub
// dependencies are not read, so each leaves a note.

import type { Exec } from "../exec.ts";
import { commentBodies, runJson } from "../label-triage/trackers/cli-json.ts";
import { array, type Json, number, object, string } from "../validate.ts";
import { absent, emptyContext, splitGithubId } from "./shared.ts";
import type { ContextLink, ContextReader, RelatedTask, TaskContext } from "./types.ts";

const FIELDS = "comments,subIssues,parent,closedByPullRequestsReferences";

// gh gives an issue node no repository, so a cross-repository sub-issue or parent names its own in
// its url.
const ISSUE_URL = /^https?:\/\/[^/]+\/([^/]+\/[^/]+)\/issues\/\d+$/;

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

function parent(root: Json, repository: string, notes: string[]): TaskContext["parent"] {
    if (absent(root.parent)) return null;
    notes.push("github: the parent's description was not read");
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

function comments(root: Json): string[] {
    return commentBodies(array(root.comments, "$.comments"), "$.comments", {
        body: "body",
        createdAt: "createdAt",
    });
}

function parseContext(repository: string): (value: unknown) => TaskContext {
    return (value) => {
        const root = object(value, "$");
        const notes = ["github: dependencies were not read"];
        return {
            ...emptyContext(),
            comments: comments(root),
            parent: parent(root, repository, notes),
            children: children(root, repository, notes),
            pullRequests: pullRequests(root, notes),
            notes,
        };
    };
}

export function githubContext(exec: Exec): ContextReader {
    return {
        source: "github",
        read(task) {
            const { repository, number: issue } = splitGithubId(task.id);
            return runJson(
                exec,
                `gh issue view ${issue} --repo ${repository} --json ${FIELDS}`,
                ["issue", "view", issue, "--repo", repository, "--json", FIELDS],
                parseContext(repository),
            );
        },
    };
}
