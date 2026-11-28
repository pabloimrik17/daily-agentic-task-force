import type { GithubConfig } from "../../config.ts";
import type { Exec } from "../../exec.ts";
import { parseError, runJson } from "../../label-triage/trackers/cli-json.ts";
import {
    withinListCap,
    LIST_FIELDS,
    LIST_LIMIT,
    listedIssue,
} from "../../label-triage/trackers/github.ts";
import { array, type Json, number, object, ParseError, string } from "../../validate.ts";
import type { TrackerResult } from "../../label-triage/trackers/tracker.ts";
import type { TaskLink, WorkReader, WorkTask } from "../types.ts";

const READER_FIELDS = `${LIST_FIELDS},blockedBy,blocking`;

// gh 2.100 gives a sub-issue node no repository field: its `url` is the only place a cross-repo
// sub-issue names its own.
export const ISSUE_URL = /^https?:\/\/[^/]+\/([^/]+\/[^/]+)\/issues\/\d+$/;

const FIELDS = "subIssues,url,parent";

export function splitId(id: string): { repository: string; number: string } {
    const hash = id.lastIndexOf("#");
    return { repository: id.slice(0, hash), number: id.slice(hash + 1) };
}

function childId(node: Json, path: string, taskRepository: string): string {
    const url = node.url;
    const repository =
        typeof url === "string" ? (ISSUE_URL.exec(url)?.[1] ?? taskRepository) : taskRepository;
    return `${repository}#${number(node, "number", path)}`;
}

function subIssueNodes(root: Json): unknown[] {
    return array(object(root.subIssues, "$.subIssues").nodes, "$.subIssues.nodes");
}

function openChildren(nodes: unknown[], taskRepository: string): string[] {
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
    const nodes = subIssueNodes(root);
    return {
        ...task,
        children: openChildren(nodes, repository),
        childCount: nodes.length,
        url: taskUrl(root, repository, issue),
        parent: parentLink(root, repository),
    };
}

// gh asks for the first 50 nodes of each list: a higher totalCount, including a blocker the token
// cannot see, means the read is incomplete.
function openIds(entry: Json, key: string, path: string, id: string): string[] {
    const listPath = `${path}.${key}`;
    const list = object(entry[key], listPath);
    const nodes = array(list.nodes, `${listPath}.nodes`);
    const total = number(list, "totalCount", listPath);
    if (total > nodes.length) {
        throw new ParseError(
            `${id} ${key} has totalCount ${total} but ${nodes.length} nodes; ` +
                `some are missing or not visible`,
        );
    }
    return nodes.flatMap((item, index) => {
        const nodePath = `${listPath}.nodes[${index}]`;
        const node = object(item, nodePath);
        if (string(node, "state", nodePath) === "CLOSED") return [];
        const repositoryPath = `${nodePath}.repository`;
        const repository = string(
            object(node.repository, repositoryPath),
            "nameWithOwner",
            repositoryPath,
        );
        return [`${repository}#${number(node, "number", nodePath)}`];
    });
}

function parseListing(repo: string, items: unknown[]): WorkTask[] {
    return items.map((item, index) => {
        const path = `$[${index}]`;
        const entry = object(item, path);
        const task = listedIssue(repo, entry, path);
        return {
            ...task,
            priority: null,
            project: null,
            repository: repo,
            blockedBy: openIds(entry, "blockedBy", path, task.id),
            children: null,
            childCount: null,
            blocks: openIds(entry, "blocking", path, task.id),
        };
    });
}

async function listRepository(exec: Exec, repo: string): Promise<TrackerResult<WorkTask[]>> {
    const command = `gh issue list --repo ${repo} --state open --json ${READER_FIELDS}`;
    const args = ["issue", "list", "--repo", repo, "--state", "open", "--limit", LIST_LIMIT];
    const listed = withinListCap(
        command,
        await runJson(exec, command, [...args, "--json", READER_FIELDS], (value) =>
            array(value, "$"),
        ),
    );
    if (!listed.ok) return listed;
    try {
        return { ok: true, value: parseListing(repo, listed.value) };
    } catch (error) {
        return { ok: false, error: parseError(command, error) };
    }
}

export function githubWorkReader(exec: Exec, config: GithubConfig): WorkReader {
    return {
        source: "github",
        async list() {
            const tasks: WorkTask[] = [];
            for (const repo of config.repos) {
                const result = await listRepository(exec, repo);
                if (!result.ok) return result;
                tasks.push(...result.value);
            }
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
