// GitHub tracker (spec label-triage, "Read the open tasks"; label-contract,
// "Label bootstrap"): reads and writes through `gh`, one configured repo at a
// time. A task id is `<owner/name>#<number>` so a write can be routed back to
// its repo.

import type { GithubConfig } from "../../config.ts";
import type { Exec } from "../../exec.ts";
import { array, type Json, object, ParseError, string } from "../../validate.ts";
import type { Tracker, TrackerLabel, TrackerResult, TrackerTask } from "./tracker.ts";

function parseError(command: string, error: unknown): string {
    if (error instanceof ParseError) {
        return `${command}: output does not match the expected shape: ${error.message}`;
    }
    return `${command}: output is not valid JSON: ${(error as Error).message}`;
}

function parseJson(
    command: string,
    stdout: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
    try {
        return { ok: true, value: JSON.parse(stdout) };
    } catch (error) {
        return { ok: false, error: parseError(command, error) };
    }
}

function labelNames(entry: Json, path: string): string[] {
    const items = array(entry.labels, `${path}.labels`);
    return items.map((item, index) => {
        const labelPath = `${path}.labels[${index}]`;
        return string(object(item, labelPath), "name", labelPath);
    });
}

function task(repo: string, entry: Json, path: string): TrackerTask {
    const number = entry.number;
    if (typeof number !== "number" || !Number.isFinite(number)) {
        throw new ParseError(`${path}.number must be a finite number`);
    }
    return {
        source: "github",
        id: `${repo}#${number}`,
        title: string(entry, "title", path),
        description: string(entry, "body", path),
        labels: labelNames(entry, path),
        status: string(entry, "state", path),
        updatedAt: string(entry, "updatedAt", path),
    };
}

function parseTasks(command: string, repo: string, stdout: string): TrackerResult<TrackerTask[]> {
    const parsed = parseJson(command, stdout);
    if (!parsed.ok) {
        return parsed;
    }
    try {
        const items = array(parsed.value, "$");
        const tasks = items.map((item, index) =>
            task(repo, object(item, `$[${index}]`), `$[${index}]`),
        );
        return { ok: true, value: tasks };
    } catch (error) {
        return { ok: false, error: parseError(command, error) };
    }
}

function parseTask(command: string, repo: string, stdout: string): TrackerResult<TrackerTask> {
    const parsed = parseJson(command, stdout);
    if (!parsed.ok) {
        return parsed;
    }
    try {
        return { ok: true, value: task(repo, object(parsed.value, "$"), "$") };
    } catch (error) {
        return { ok: false, error: parseError(command, error) };
    }
}

function labelEntry(repo: string, entry: Json, path: string): TrackerLabel {
    const color = string(entry, "color", path);
    return { scope: repo, name: string(entry, "name", path), colour: `#${color.toLowerCase()}` };
}

function parseLabels(command: string, repo: string, stdout: string): TrackerResult<TrackerLabel[]> {
    const parsed = parseJson(command, stdout);
    if (!parsed.ok) {
        return parsed;
    }
    try {
        const items = array(parsed.value, "$");
        return {
            ok: true,
            value: items.map((item, index) =>
                labelEntry(repo, object(item, `$[${index}]`), `$[${index}]`),
            ),
        };
    } catch (error) {
        return { ok: false, error: parseError(command, error) };
    }
}

function parseTaskId(id: string): { ok: true; repo: string; number: string } | { ok: false } {
    const hash = id.lastIndexOf("#");
    if (hash === -1) {
        return { ok: false };
    }
    const repo = id.slice(0, hash);
    const number = id.slice(hash + 1);
    if (repo === "" || number === "" || !/^\d+$/.test(number)) {
        return { ok: false };
    }
    return { ok: true, repo, number };
}

const LIST_FIELDS = "number,title,body,labels,updatedAt,state";

export function githubTracker(exec: Exec, config: GithubConfig): Tracker {
    const repos = config.repos;

    return {
        source: "github",
        labelScopes: repos,
        createsLabels: true,

        async listTasks(): Promise<TrackerResult<TrackerTask[]>> {
            const tasks: TrackerTask[] = [];
            for (const repo of repos) {
                const command = `gh issue list --repo ${repo} --state open --json ${LIST_FIELDS}`;
                const result = await exec([
                    "issue",
                    "list",
                    "--repo",
                    repo,
                    "--state",
                    "open",
                    "--limit",
                    "1000",
                    "--json",
                    LIST_FIELDS,
                ]);
                if (!result.ok) {
                    return { ok: false, error: `${command}: ${result.error}` };
                }
                const parsed = parseTasks(command, repo, result.stdout);
                if (!parsed.ok) {
                    return parsed;
                }
                tasks.push(...parsed.value);
            }
            return { ok: true, value: tasks };
        },

        async readTask(id: string): Promise<TrackerResult<TrackerTask>> {
            const parsedId = parseTaskId(id);
            if (!parsedId.ok) {
                return { ok: false, error: `${id} is not a valid GitHub task id` };
            }
            const { repo, number } = parsedId;
            const command = `gh issue view ${number} --repo ${repo} --json ${LIST_FIELDS}`;
            const result = await exec([
                "issue",
                "view",
                number,
                "--repo",
                repo,
                "--json",
                LIST_FIELDS,
            ]);
            if (!result.ok) {
                return { ok: false, error: `${command}: ${result.error}` };
            }
            return parseTask(command, repo, result.stdout);
        },

        async addLabel(id: string, label: string): Promise<TrackerResult<void>> {
            const parsedId = parseTaskId(id);
            if (!parsedId.ok) {
                return { ok: false, error: `${id} is not a valid GitHub task id` };
            }
            const { repo, number } = parsedId;
            const command = `gh issue edit ${number} --repo ${repo} --add-label ${label}`;
            const result = await exec([
                "issue",
                "edit",
                number,
                "--repo",
                repo,
                "--add-label",
                label,
            ]);
            if (!result.ok) {
                return { ok: false, error: `${command}: ${result.error}` };
            }
            return { ok: true, value: undefined };
        },

        async listLabels(): Promise<TrackerResult<TrackerLabel[]>> {
            const labels: TrackerLabel[] = [];
            for (const repo of repos) {
                const command = `gh label list --repo ${repo} --json name,color`;
                const result = await exec([
                    "label",
                    "list",
                    "--repo",
                    repo,
                    "--json",
                    "name,color",
                    "--limit",
                    "1000",
                ]);
                if (!result.ok) {
                    return { ok: false, error: `${command}: ${result.error}` };
                }
                const parsed = parseLabels(command, repo, result.stdout);
                if (!parsed.ok) {
                    return parsed;
                }
                labels.push(...parsed.value);
            }
            return { ok: true, value: labels };
        },

        async createLabel(
            scope: string,
            name: string,
            colour: string,
        ): Promise<TrackerResult<void>> {
            const hexColour = colour.startsWith("#") ? colour.slice(1) : colour;
            const command = `gh label create ${name} --repo ${scope} --color ${hexColour}`;
            const result = await exec([
                "label",
                "create",
                name,
                "--repo",
                scope,
                "--color",
                hexColour,
            ]);
            if (!result.ok) {
                return { ok: false, error: `${command}: ${result.error}` };
            }
            return { ok: true, value: undefined };
        },
    };
}
