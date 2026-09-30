import { readFileSync } from "node:fs";

import { loadConfig, type Source } from "../config.ts";
import { type Group } from "../label-contract/contract.ts";
import { check, prepare, type CheckInput, type JudgedGroup } from "./check.ts";

export const USAGE = `Usage:
  cli.ts prepare --source <linear|beads|github> [--repo <owner/name>] [--label <name>]...
  cli.ts decide  --source <linear|beads|github> [--repo <owner/name>] [--label <name>]... [--judged <group>=<label>[,<label>]@<confidence>]...`;

interface Parsed {
    mode: "prepare" | "decide";
    input: CheckInput;
    judged: JudgedGroup[];
}

type ParseResult = { ok: true; value: Parsed } | { ok: false; error: string };

interface Draft {
    mode: Parsed["mode"];
    source?: Source;
    repo?: string;
    labels: string[];
    judged: JudgedGroup[];
}

// Each handler records one flag's value and returns an error, if any.
type FlagHandler = (draft: Draft, value: string) => string | undefined;

const SOURCES: readonly string[] = ["linear", "beads", "github"];

function parseJudged(value: string, judged: readonly JudgedGroup[]): JudgedGroup | string {
    const match = /^(scope|entry)=(.*)@(\d+(?:\.\d+)?)$/.exec(value);
    if (!match) return `invalid --judged: ${value}`;
    const group = match[1] as Group;
    const confidence = Number(match[3]);
    if (confidence < 0 || confidence > 1) {
        return `--judged confidence must be in [0, 1]: ${value}`;
    }
    if (judged.some((item) => item.group === group)) {
        return `--judged group given twice: ${group}`;
    }
    return { group, labels: match[2] === "" ? [] : match[2]!.split(","), confidence };
}

const FLAGS = new Map<string, FlagHandler>([
    [
        "--source",
        (draft, value) => {
            if (draft.source !== undefined || !SOURCES.includes(value)) {
                return `invalid or repeated --source: ${value}`;
            }
            draft.source = value as Source;
            return undefined;
        },
    ],
    [
        "--repo",
        (draft, value) => {
            if (draft.repo !== undefined) return "--repo given twice";
            draft.repo = value;
            return undefined;
        },
    ],
    [
        "--label",
        (draft, value) => {
            draft.labels.push(value);
            return undefined;
        },
    ],
    [
        "--judged",
        (draft, value) => {
            if (draft.mode !== "decide") return "--judged is only accepted by decide";
            const judged = parseJudged(value, draft.judged);
            if (typeof judged === "string") return judged;
            draft.judged.push(judged);
            return undefined;
        },
    ],
]);

function finish({ mode, source, repo, labels, judged }: Draft): ParseResult {
    if (!source) return { ok: false, error: "--source is required" };
    if (source === "github" && !repo) {
        return { ok: false, error: "--repo is required for github" };
    }
    if (source !== "github" && repo) {
        return { ok: false, error: "--repo is only accepted for github" };
    }
    return {
        ok: true,
        value: { mode, input: { source, labels, ...(repo ? { repo } : {}) }, judged },
    };
}

function isMode(value: string | undefined): value is Parsed["mode"] {
    return value === "prepare" || value === "decide";
}

function applyFlag(
    draft: Draft,
    flag: string | undefined,
    value: string | undefined,
): string | undefined {
    if (!flag || !value || value.startsWith("--")) {
        return `missing value for ${flag ?? "argument"}`;
    }
    const handler = FLAGS.get(flag);
    return handler ? handler(draft, value) : `unknown flag: ${flag}`;
}

function parse(argv: readonly string[]): ParseResult {
    const mode = argv[0];
    if (!isMode(mode)) {
        return { ok: false, error: "expected prepare or decide" };
    }
    const draft: Draft = { mode, labels: [], judged: [] };
    for (let index = 1; index < argv.length; index += 2) {
        const error = applyFlag(draft, argv[index], argv[index + 1]);
        if (error !== undefined) return { ok: false, error };
    }
    return finish(draft);
}

export interface MainDeps {
    env: Record<string, string | undefined>;
    readConfig?: (path: string) => string;
    stdout: (text: string) => void;
    stderr: (text: string) => void;
}

export function main(argv: readonly string[], deps: MainDeps): number {
    const parsed = parse(argv);
    if (!parsed.ok) {
        deps.stderr(`${parsed.error}\n${USAGE}`);
        return 1;
    }
    const load = loadConfig(deps.env, deps.readConfig);
    const criteria = readFileSync(new URL("../label-triage/criteria.md", import.meta.url), "utf8");
    if (parsed.value.mode === "prepare") {
        deps.stdout(criteria);
        deps.stdout(prepare(parsed.value.input, load).join("\n"));
    } else {
        if (!load.ok) deps.stdout(criteria);
        deps.stdout(check(parsed.value.input, load, parsed.value.judged).join("\n"));
    }
    return 0;
}

if (import.meta.main) {
    process.exitCode = main(process.argv.slice(2), {
        env: process.env,
        stdout: (value) => process.stdout.write(`${value}\n`),
        stderr: (value) => process.stderr.write(`${value}\n`),
    });
}
