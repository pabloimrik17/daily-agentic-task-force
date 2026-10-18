// The user configuration file (spec label-contract, "User configuration
// file"): per-user parts of the label contract live in one JSON file outside
// the plugin, validated strictly. A missing file, a missing required field, a
// mistyped field or an unknown field is an error naming the path, never a
// default. The one exception is the optional `sessions`, `workspace` and
// `naming` blocks: a key absent from the file takes the shipped default, and
// the load records which keys did (design D13).

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
    type ContractLabel,
    isContractLabel,
    isScope,
    type Scope,
} from "./label-contract/contract.ts";
import type { SessionTool } from "./sessions/manager.ts";
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

export const DEFAULTS_PATH = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "config.defaults.json",
);

export type { ContractLabel, Scope };
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

export interface SelectionConfig {
    model: string;
    effort: string;
}

export interface SessionsConfig {
    tool: SessionTool;
    profile: string | null; // the session manager's profile; null for its default
    binary: string | null; // the agent binary or wrapper; null for the tool's own
}

export interface WorkspaceConfig {
    root: string; // `~` already expanded with HOME at load
}

export type NamingConfig = SelectionConfig;

export interface AutonomousConfig {
    schema: "autonomous.config.v1";
    sources: { linear: LinearConfig; beads: BeadsConfig; github: GithubConfig };
    judgement: JudgementConfig;
    selection: SelectionConfig;
    sessions: SessionsConfig;
    workspace: WorkspaceConfig;
    naming: NamingConfig;
}

// The shipped values of the optional blocks, as the JSON file holds them.
export interface ConfigDefaults {
    sessions: Json;
    workspace: Json;
    naming: Json;
}

export type ConfigLoad =
    | { ok: true; path: string; config: AutonomousConfig; defaulted: string[] }
    | { ok: false; path: string; error: string };

export function resolveConfigPath(env: Record<string, string | undefined>): string {
    const override = env.AUTONOMOUS_CONFIG;
    if (override !== undefined && override !== "") {
        return override;
    }
    const home = env.HOME ?? homedir();
    return join(home, ".config", "autonomous", "config.json");
}

// `defaulted` lists the keys that took a shipped value, as dotted paths.
export function parseConfig(
    input: unknown,
    defaults: ConfigDefaults = SHIPPED_DEFAULTS,
    home: string = homedir(),
): { ok: true; value: AutonomousConfig; defaulted: string[] } | { ok: false; error: string } {
    try {
        return { ok: true, ...config(input, defaults, home) };
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
    const parsed = parseConfig(json, SHIPPED_DEFAULTS, env.HOME ?? homedir());
    if (!parsed.ok) {
        return { ok: false, path, error: `${path}: ${parsed.error}` };
    }
    return { ok: true, path, config: parsed.value, defaulted: parsed.defaulted };
}

function config(
    input: unknown,
    defaults: ConfigDefaults,
    home: string,
): { value: AutonomousConfig; defaulted: string[] } {
    const root = object(input, "$");
    rejectUnknownKeys(
        root,
        ["schema", "sources", "judgement", "selection", "sessions", "workspace", "naming"],
        "$",
    );
    const schema = string(root, "schema", "$");
    if (schema !== CONFIG_SCHEMA) {
        throw new ParseError(`$.schema is "${schema}", expected "${CONFIG_SCHEMA}"`);
    }
    const sources = object(root.sources, "$.sources");
    rejectUnknownKeys(sources, ["linear", "beads", "github"], "$.sources");
    const { defaulted, ...optionalBlocks } = optionalConfig(root, defaults, home);
    return {
        value: {
            schema: CONFIG_SCHEMA,
            sources: {
                linear: linearConfig(
                    object(sources.linear, "$.sources.linear"),
                    "$.sources.linear",
                ),
                beads: beadsConfig(object(sources.beads, "$.sources.beads"), "$.sources.beads"),
                github: githubConfig(
                    object(sources.github, "$.sources.github"),
                    "$.sources.github",
                ),
            },
            judgement: judgementConfig(object(root.judgement, "$.judgement"), "$.judgement"),
            selection: selectionConfig(object(root.selection, "$.selection"), "$.selection"),
            ...optionalBlocks,
        },
        defaulted,
    };
}

const SESSIONS_KEYS = ["tool", "profile", "binary"];
const WORKSPACE_KEYS = ["root"];
const NAMING_KEYS = ["model", "effort"];

// Design D13. The filled values are validated afterwards, by the caller.
function overlay(
    root: Json,
    block: keyof ConfigDefaults,
    keys: readonly string[],
    defaults: ConfigDefaults,
    defaulted: string[],
): Json {
    const path = `$.${block}`;
    const given = block in root ? object(root[block], path) : {};
    rejectUnknownKeys(given, keys, path);
    const filled: Json = { ...given };
    for (const key of keys) {
        if (!(key in given)) {
            filled[key] = defaults[block][key];
            defaulted.push(`${block}.${key}`);
        }
    }
    return filled;
}

function optionalConfig(
    root: Json,
    defaults: ConfigDefaults,
    home: string,
): Pick<AutonomousConfig, "sessions" | "workspace" | "naming"> & { defaulted: string[] } {
    const defaulted: string[] = [];
    const sessions = overlay(root, "sessions", SESSIONS_KEYS, defaults, defaulted);
    const workspace = overlay(root, "workspace", WORKSPACE_KEYS, defaults, defaulted);
    const naming = overlay(root, "naming", NAMING_KEYS, defaults, defaulted);
    return {
        sessions: sessionsConfig(sessions, "$.sessions"),
        workspace: workspaceConfig(workspace, "$.workspace", home),
        naming: modelSettings(naming, "$.naming"),
        defaulted,
    };
}

const SESSION_TOOLS: readonly string[] = ["claude", "codex"];

function isSessionTool(value: string): value is SessionTool {
    return SESSION_TOOLS.includes(value);
}

function nullableString(entry: Json, key: string, path: string): string | null {
    const value = entry[key];
    if (value === null) {
        return null;
    }
    if (typeof value !== "string") {
        throw new ParseError(`${path}.${key} must be a string or null`);
    }
    if (value === "") {
        throw new ParseError(`${path}.${key} must not be empty`);
    }
    return value;
}

function sessionsConfig(entry: Json, path: string): SessionsConfig {
    const tool = string(entry, "tool", path);
    if (!isSessionTool(tool)) {
        throw new ParseError(`${path}.tool must be "claude" or "codex"`);
    }
    return {
        tool,
        profile: nullableString(entry, "profile", path),
        binary: nullableString(entry, "binary", path),
    };
}

function workspaceConfig(entry: Json, path: string, home: string): WorkspaceConfig {
    const root = string(entry, "root", path);
    if (root === "") {
        throw new ParseError(`${path}.root must not be empty`);
    }
    return { root: expandHome(root, home) };
}

function expandHome(value: string, home: string): string {
    if (value === "~") {
        return home;
    }
    return value.startsWith("~/") ? join(home, value.slice(2)) : value;
}

// The defaults file ships with the plugin, so one that does not parse is a
// defect of the plugin, not user input: it throws.
function readDefaults(): ConfigDefaults {
    try {
        const root = object(JSON.parse(readFileSync(DEFAULTS_PATH, "utf8")), "$");
        rejectUnknownKeys(root, ["sessions", "workspace", "naming"], "$");
        const defaults = {
            sessions: object(root.sessions, "$.sessions"),
            workspace: object(root.workspace, "$.workspace"),
            naming: object(root.naming, "$.naming"),
        };
        optionalConfig({}, defaults, "/");
        return defaults;
    } catch (error) {
        throw new Error(`${DEFAULTS_PATH}: ${(error as Error).message}`, { cause: error });
    }
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
    if (!isScope(value)) {
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
        // taken is set by hand or by an agent, never inferred, so it has no aliases.
        if (!isContractLabel(label) || label === "taken") {
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

function modelSettings(entry: Json, path: string): SelectionConfig {
    const model = string(entry, "model", path);
    if (model === "") {
        throw new ParseError(`${path}.model must not be empty`);
    }
    const effort = string(entry, "effort", path);
    if (!EFFORTS.includes(effort)) {
        throw new ParseError(`${path}.effort must be one of ${EFFORTS.join(", ")}`);
    }
    return { model, effort };
}

function judgementConfig(entry: Json, path: string): JudgementConfig {
    rejectUnknownKeys(entry, ["model", "effort", "threshold", "cap", "batch"], path);
    const { model, effort } = modelSettings(entry, path);
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

function selectionConfig(entry: Json, path: string): SelectionConfig {
    rejectUnknownKeys(entry, ["model", "effort"], path);
    return modelSettings(entry, path);
}

// Last, so every constant the validators read is initialised first.
const SHIPPED_DEFAULTS = readDefaults();
