// User configuration (spec stonks-sync): validated strictly before any input
// is read. Every violation is an error naming the path, never a default.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CONFIG_SCHEMA, type StonksConfig } from "./domain.ts";
import {
    type Json,
    object,
    ParseError,
    rejectUnknownKeys,
    string,
    stringArray,
} from "./validate.ts";

export const EXAMPLE_PATH = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "config.example.json",
);

export type ConfigLoad =
    | { ok: true; path: string; config: StonksConfig }
    | { ok: false; path: string; error: string };

export function resolveConfigPath(env: Record<string, string | undefined>): string {
    const override = env.STONKS_CONFIG;
    if (override !== undefined && override !== "") {
        return override;
    }
    const home = env.HOME ?? homedir();
    return join(home, ".config", "stonks", "config.json");
}

export function parseConfig(
    text: string,
    path: string,
): { ok: true; value: StonksConfig } | { ok: false; error: string } {
    let json: unknown;
    try {
        json = JSON.parse(text);
    } catch (error) {
        return { ok: false, error: `${path}: ${(error as Error).message}` };
    }
    try {
        return { ok: true, value: config(json) };
    } catch (error) {
        if (error instanceof ParseError) {
            return {
                ok: false,
                error: `${path}: configuration does not match ${CONFIG_SCHEMA}: ${error.message}`,
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
    const parsed = parseConfig(raw, path);
    return parsed.ok
        ? { ok: true, path, config: parsed.value }
        : { ok: false, path, error: parsed.error };
}

function config(input: unknown): StonksConfig {
    const root = object(input, "$");
    rejectUnknownKeys(
        root,
        ["schema", "trackingSheet", "swsPortfolio", "watchlist", "carteraViva", "excludedTickers"],
        "$",
    );
    const schema = string(root, "schema", "$");
    if (schema !== CONFIG_SCHEMA) {
        throw new ParseError(`$.schema is "${schema}", expected "${CONFIG_SCHEMA}"`);
    }
    const trackingSheet = object(root.trackingSheet, "$.trackingSheet");
    rejectUnknownKeys(trackingSheet, ["spreadsheetId", "tab"], "$.trackingSheet");
    const swsPortfolio = object(root.swsPortfolio, "$.swsPortfolio");
    rejectUnknownKeys(swsPortfolio, ["url"], "$.swsPortfolio");
    const watchlist = object(root.watchlist, "$.watchlist");
    rejectUnknownKeys(watchlist, ["name", "url"], "$.watchlist");
    const carteraViva = object(root.carteraViva, "$.carteraViva");
    rejectUnknownKeys(carteraViva, ["url"], "$.carteraViva");
    return {
        schema: CONFIG_SCHEMA,
        trackingSheet: {
            spreadsheetId: nonEmpty(trackingSheet, "spreadsheetId", "$.trackingSheet"),
            tab: nonEmpty(trackingSheet, "tab", "$.trackingSheet"),
        },
        swsPortfolio: { url: httpsUrl(swsPortfolio, "url", "$.swsPortfolio") },
        watchlist: {
            name: nonEmpty(watchlist, "name", "$.watchlist"),
            url: httpsUrl(watchlist, "url", "$.watchlist"),
        },
        carteraViva: { url: httpsUrl(carteraViva, "url", "$.carteraViva") },
        excludedTickers: tickers(root, "excludedTickers", "$"),
    };
}

function nonEmpty(parent: Json, key: string, path: string): string {
    const value = string(parent, key, path);
    if (value === "") {
        throw new ParseError(`${path}.${key} must not be empty`);
    }
    if (value !== value.trim()) {
        throw new ParseError(`${path}.${key} must not have leading or trailing whitespace`);
    }
    return value;
}

// A scheme check, not a full URL parse: the shipped example holds placeholders
// such as `https://<PAGE>`, and it must load as a document of this schema.
function httpsUrl(parent: Json, key: string, path: string): string {
    const value = nonEmpty(parent, key, path);
    if (!/^https:\/\/\S+$/.test(value)) {
        throw new ParseError(`${path}.${key} must be an https URL`);
    }
    return value;
}

function tickers(parent: Json, key: string, path: string): string[] {
    const values = stringArray(parent, key, path);
    const seen = new Set<string>();
    values.forEach((value, index) => {
        const where = `${path}.${key}[${index}]`;
        if (value === "") {
            throw new ParseError(`${where} must not be empty`);
        }
        if (value !== value.trim()) {
            throw new ParseError(`${where} must not have leading or trailing whitespace`);
        }
        if (value !== value.toUpperCase()) {
            throw new ParseError(`${where} must be upper-case`);
        }
        if (seen.has(value)) {
            throw new ParseError(`${where} duplicates ${value}`);
        }
        seen.add(value);
    });
    return values;
}
