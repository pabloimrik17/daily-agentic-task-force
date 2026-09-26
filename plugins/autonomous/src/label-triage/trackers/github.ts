// GitHub tracker (spec label-triage, "Read the open tasks"; label-contract,
// "Label bootstrap"): reads and writes through `gh` (v2.100.0), one configured
// repo at a time. A task id is `<owner/name>#<number>` so a write can be routed
// back to its repo.

import type { GithubConfig } from "../../config.ts";
import type { Exec } from "../../exec.ts";
import { array, type Json, object, ParseError, string } from "../../validate.ts";
import { run, runJson } from "./cli-json.ts";
import type { Tracker, TrackerLabel, TrackerResult, TrackerTask } from "./tracker.ts";

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

function parseTasks(repo: string): (value: unknown) => TrackerTask[] {
    return (value) => {
        const items = array(value, "$");
        return items.map((item, index) => task(repo, object(item, `$[${index}]`), `$[${index}]`));
    };
}

function parseTask(repo: string): (value: unknown) => TrackerTask {
    return (value) => task(repo, object(value, "$"), "$");
}

function labelEntry(repo: string, entry: Json, path: string): TrackerLabel {
    const color = string(entry, "color", path);
    return { scope: repo, name: string(entry, "name", path), colour: `#${color.toLowerCase()}` };
}

function parseLabels(repo: string): (value: unknown) => TrackerLabel[] {
    return (value) => {
        const items = array(value, "$");
        return items.map((item, index) =>
            labelEntry(repo, object(item, `$[${index}]`), `$[${index}]`),
        );
    };
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

// `gh` has no unlimited listing, so every list asks for one past the cap:
// getting that extra entry back means the listing would be incomplete.
const LIST_CAP = 1000;
const LIST_LIMIT = String(LIST_CAP + 1);

function complete<T>(command: string, result: TrackerResult<T[]>): TrackerResult<T[]> {
    if (result.ok && result.value.length > LIST_CAP) {
        return {
            ok: false,
            error: `${command}: more than ${LIST_CAP} results; the listing would be incomplete`,
        };
    }
    return result;
}

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
                const result = complete(
                    command,
                    await runJson(
                        exec,
                        command,
                        [
                            "issue",
                            "list",
                            "--repo",
                            repo,
                            "--state",
                            "open",
                            "--limit",
                            LIST_LIMIT,
                            "--json",
                            LIST_FIELDS,
                        ],
                        parseTasks(repo),
                    ),
                );
                if (!result.ok) {
                    return result;
                }
                tasks.push(...result.value);
            }
            return { ok: true, value: tasks };
        },

        readTask(id: string): Promise<TrackerResult<TrackerTask>> {
            const parsedId = parseTaskId(id);
            if (!parsedId.ok) {
                return Promise.resolve({ ok: false, error: `${id} is not a valid GitHub task id` });
            }
            const { repo, number } = parsedId;
            return runJson(
                exec,
                `gh issue view ${number} --repo ${repo} --json ${LIST_FIELDS}`,
                ["issue", "view", number, "--repo", repo, "--json", LIST_FIELDS],
                parseTask(repo),
            );
        },

        addLabel(id: string, label: string): Promise<TrackerResult<void>> {
            const parsedId = parseTaskId(id);
            if (!parsedId.ok) {
                return Promise.resolve({ ok: false, error: `${id} is not a valid GitHub task id` });
            }
            const { repo, number } = parsedId;
            return run(exec, `gh issue edit ${number} --repo ${repo} --add-label ${label}`, [
                "issue",
                "edit",
                number,
                "--repo",
                repo,
                "--add-label",
                label,
            ]);
        },

        async listLabels(): Promise<TrackerResult<TrackerLabel[]>> {
            const labels: TrackerLabel[] = [];
            for (const repo of repos) {
                const command = `gh label list --repo ${repo} --json name,color`;
                const result = complete(
                    command,
                    await runJson(
                        exec,
                        command,
                        [
                            "label",
                            "list",
                            "--repo",
                            repo,
                            "--json",
                            "name,color",
                            "--limit",
                            LIST_LIMIT,
                        ],
                        parseLabels(repo),
                    ),
                );
                if (!result.ok) {
                    return result;
                }
                labels.push(...result.value);
            }
            return { ok: true, value: labels };
        },

        createLabel(scope: string, name: string, colour: string): Promise<TrackerResult<void>> {
            const hexColour = colour.startsWith("#") ? colour.slice(1) : colour;
            return run(exec, `gh label create ${name} --repo ${scope} --color ${hexColour}`, [
                "label",
                "create",
                name,
                "--repo",
                scope,
                "--color",
                hexColour,
            ]);
        },
    };
}
