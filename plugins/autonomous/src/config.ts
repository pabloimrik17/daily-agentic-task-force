// The user configuration file (spec label-contract, "User configuration
// file"): per-user parts of the label contract live in one JSON file outside
// the plugin, validated strictly. A missing file, a missing required field, a
// mistyped field or an unknown field is an error naming the path, never a
// default.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isContractLabel } from "./label-contract/contract.ts";
import {
    boolean,
    type Json,
    number,
    object,
    optional,
    ParseError,
    rejectUnknownKeys,
    string,
    stringArray,
} from "./validate.ts";

export const CONFIG_SCHEMA = "autonomous.config.v1";

export const EXAMPLE_PATH = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "config.example.json",
);

export type Scope = "work" | "personal";
export type ContractLabel = "work" | "personal" | "AFK" | "HITL" | "grill-me";
export type Source = "linear" | "beads" | "github";

export interface SourceRules {
    enabled: boolean;
    scope?: Scope;
    aliases?: Partial<Record<ContractLabel, string[]>>;
}

export type LinearConfig = SourceRules;

export interface BeadsConfig extends SourceRules {
    directory: string;
}

export interface GithubConfig extends SourceRules {
    repos: string[];
}

export interface JudgementConfig {
    model: string;
    effort: string;
    threshold: number;
    cap: number;
    batch: number;
}

export interface AutonomousConfig {
    schema: "autonomous.config.v1";
    sources: { linear: LinearConfig; beads: BeadsConfig; github: GithubConfig };
    judgement: JudgementConfig;
}

export type ConfigLoad =
    | { ok: true; path: string; config: AutonomousConfig }
    | { ok: false; path: string; error: string };

export function resolveConfigPath(env: Record<string, string | undefined>): string {
    const override = env.AUTONOMOUS_CONFIG;
    if (override !== undefined && override !== "") {
        return override;
    }
    const home = env.HOME ?? homedir();
    return join(home, ".config", "autonomous", "config.json");
}

export function parseConfig(
    input: unknown,
): { ok: true; value: AutonomousConfig } | { ok: false; error: string } {
    try {
        return { ok: true, value: config(input) };
    } catch (error) {
        if (error instanceof ParseError) {
            return {
                ok: false,
                error: `configuration does not match ${CONFIG_SCHEMA}: ${error.message}`,
            };
        }
        throw error;
    }
}

export function loadConfig(
    env: Record<string, string | undefined>,
    readFile: (path: string) => string = (path) => readFileSync(path, "utf8"),
): ConfigLoad {
    const path = resolveConfigPath(env);
    let raw: string;
    try {
        raw = readFile(path);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return {
                ok: false,
                path,
                error: `configuration file not found at ${path}; create it from the example at ${EXAMPLE_PATH}`,
            };
        }
        return { ok: false, path, error: `${path}: ${(error as Error).message}` };
    }
    let json: unknown;
    try {
        json = JSON.parse(raw);
    } catch (error) {
        return { ok: false, path, error: `${path}: ${(error as Error).message}` };
    }
    const parsed = parseConfig(json);
    if (!parsed.ok) {
        return { ok: false, path, error: `${path}: ${parsed.error}` };
    }
    return { ok: true, path, config: parsed.value };
}

function config(input: unknown): AutonomousConfig {
    const root = object(input, "$");
    rejectUnknownKeys(root, ["schema", "sources", "judgement"], "$");
    const schema = string(root, "schema", "$");
    if (schema !== CONFIG_SCHEMA) {
        throw new ParseError(`$.schema is "${schema}", expected "${CONFIG_SCHEMA}"`);
    }
    const sources = object(root.sources, "$.sources");
    rejectUnknownKeys(sources, ["linear", "beads", "github"], "$.sources");
    return {
        schema: CONFIG_SCHEMA,
        sources: {
            linear: linearConfig(object(sources.linear, "$.sources.linear"), "$.sources.linear"),
            beads: beadsConfig(object(sources.beads, "$.sources.beads"), "$.sources.beads"),
            github: githubConfig(object(sources.github, "$.sources.github"), "$.sources.github"),
        },
        judgement: judgementConfig(object(root.judgement, "$.judgement"), "$.judgement"),
    };
}

function sourceRules(entry: Json, path: string): SourceRules {
    const enabled = boolean(entry, "enabled", path);
    const scope = optional(entry, "scope", path, scopeValue);
    const aliases = optional(entry, "aliases", path, aliasesValue);
    return {
        enabled,
        ...(scope === undefined ? {} : { scope }),
        ...(aliases === undefined ? {} : { aliases }),
    };
}

function scopeValue(parent: Json, key: string, path: string): Scope {
    const value = string(parent, key, path);
    if (value !== "work" && value !== "personal") {
        throw new ParseError(`${path}.${key} must be "work" or "personal"`);
    }
    return value;
}

function aliasesValue(
    parent: Json,
    key: string,
    path: string,
): Partial<Record<ContractLabel, string[]>> {
    const entry = object(parent[key], `${path}.${key}`);
    const aliasPath = `${path}.${key}`;
    const result: Partial<Record<ContractLabel, string[]>> = {};
    for (const label of Object.keys(entry)) {
        if (!isContractLabel(label)) {
            throw new ParseError(`${aliasPath}.${label} is not a recognised field`);
        }
        const values = stringArray(entry, label, aliasPath);
        for (const value of values) {
            if (value === "" || isContractLabel(value)) {
                throw new ParseError(
                    `${aliasPath}.${label} must hold legacy names, not contract labels`,
                );
            }
        }
        result[label] = values;
    }
    return result;
}

function linearConfig(entry: Json, path: string): LinearConfig {
    rejectUnknownKeys(entry, ["enabled", "scope", "aliases"], path);
    return sourceRules(entry, path);
}

function beadsConfig(entry: Json, path: string): BeadsConfig {
    rejectUnknownKeys(entry, ["enabled", "scope", "aliases", "directory"], path);
    const rules = sourceRules(entry, path);
    const directory = string(entry, "directory", path);
    if (directory === "") {
        throw new ParseError(`${path}.directory must not be empty`);
    }
    return { ...rules, directory };
}

const REPO = /^[^/\s]+\/[^/\s]+$/;

function githubConfig(entry: Json, path: string): GithubConfig {
    rejectUnknownKeys(entry, ["enabled", "scope", "aliases", "repos"], path);
    const rules = sourceRules(entry, path);
    const repos = stringArray(entry, "repos", path);
    const invalid = repos.findIndex((repo) => !REPO.test(repo));
    if (invalid !== -1) {
        throw new ParseError(`${path}.repos[${invalid}] must be "owner/name"`);
    }
    return { ...rules, repos };
}

const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

function judgementConfig(entry: Json, path: string): JudgementConfig {
    rejectUnknownKeys(entry, ["model", "effort", "threshold", "cap", "batch"], path);
    const model = string(entry, "model", path);
    if (model === "") {
        throw new ParseError(`${path}.model must not be empty`);
    }
    const effort = string(entry, "effort", path);
    if (!EFFORTS.includes(effort)) {
        throw new ParseError(`${path}.effort must be one of ${EFFORTS.join(", ")}`);
    }
    const threshold = number(entry, "threshold", path);
    if (threshold < 0 || threshold > 1) {
        throw new ParseError(`${path}.threshold must be between 0 and 1`);
    }
    const cap = number(entry, "cap", path);
    if (!Number.isInteger(cap) || cap < 0) {
        throw new ParseError(`${path}.cap must be an integer >= 0`);
    }
    const batch = number(entry, "batch", path);
    if (!Number.isInteger(batch) || batch < 1) {
        throw new ParseError(`${path}.batch must be an integer >= 1`);
    }
    return { model, effort, threshold, cap, batch };
}
