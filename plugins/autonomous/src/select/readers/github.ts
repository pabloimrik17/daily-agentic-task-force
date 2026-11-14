import type { GithubConfig } from "../../config.ts";
import type { Exec } from "../../exec.ts";
import { runJson } from "../../label-triage/trackers/cli-json.ts";
import { githubTracker } from "../../label-triage/trackers/github.ts";
import { array, type Json, number, object, string } from "../../validate.ts";
import type { TaskLink, WorkReader, WorkTask } from "../types.ts";

// gh 2.100 gives a sub-issue node no repository field: its `url` is the only place a cross-repo
// sub-issue names its own.
const ISSUE_URL = /^https?:\/\/[^/]+\/([^/]+\/[^/]+)\/issues\/\d+$/;

const FIELDS = "subIssues,url,parent";

function splitId(id: string): { repository: string; number: string } {
    const hash = id.lastIndexOf("#");
    return { repository: id.slice(0, hash), number: id.slice(hash + 1) };
}

function childId(node: Json, path: string, taskRepository: string): string {
    const url = node.url;
    const repository =
        typeof url === "string" ? (ISSUE_URL.exec(url)?.[1] ?? taskRepository) : taskRepository;
    return `${repository}#${number(node, "number", path)}`;
}

function openChildren(value: unknown, taskRepository: string): string[] {
    const root = object(value, "$");
    const nodes = array(object(root.subIssues, "$.subIssues").nodes, "$.subIssues.nodes");
    return nodes.flatMap((item, index) => {
        const path = `$.subIssues.nodes[${index}]`;
        const node = object(item, path);
        return string(node, "state", path) === "CLOSED"
            ? []
            : [childId(node, path, taskRepository)];
    });
}

function linkId(url: string, number: number, fallbackRepository: string): string {
    return `${ISSUE_URL.exec(url)?.[1] ?? fallbackRepository}#${number}`;
}

function parentLink(root: Json, taskRepository: string): TaskLink | null {
    const value = root.parent;
    if (value === undefined || value === null) return null;
    const parent = object(value, "$.parent");
    const url = string(parent, "url", "$.parent");
    return { id: linkId(url, number(parent, "number", "$.parent"), taskRepository), url };
}

function taskUrl(root: Json, repository: string, issue: string): string {
    const url = root.url;
    return typeof url === "string" ? url : `https://github.com/${repository}/issues/${issue}`;
}

function parseDetail(value: unknown, task: WorkTask, repository: string, issue: string): WorkTask {
    const root = object(value, "$");
    return {
        ...task,
        children: openChildren(root, repository),
        url: taskUrl(root, repository, issue),
        parent: parentLink(root, repository),
    };
}

export function githubWorkReader(exec: Exec, config: GithubConfig): WorkReader {
    const tracker = githubTracker(exec, config);
    return {
        source: "github",
        async list() {
            const result = await tracker.listTasks();
            if (!result.ok) return result;
            const tasks: WorkTask[] = result.value.map((task) => ({
                ...task,
                priority: null,
                project: null,
                repository: splitId(task.id).repository,
                blockedBy: null,
                children: null,
                blocks: [],
            }));
            return { ok: true, value: tasks };
        },
        detail(task) {
            const { repository, number: issue } = splitId(task.id);
            return runJson(
                exec,
                `gh issue view ${issue} --repo ${repository} --json ${FIELDS}`,
                ["issue", "view", issue, "--repo", repository, "--json", FIELDS],
                (value) => parseDetail(value, task, repository, issue),
            );
        },
    };
}
