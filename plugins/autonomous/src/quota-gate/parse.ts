// Hand-written validator for `openusage.limits.v2` (design D4): plugins install
// without dependencies, so no schema library is available at runtime. A missing
// required field or a mistyped field is an error with its path, never a default.

import {
    array,
    boolean,
    type Json,
    number,
    object,
    optional,
    ParseError,
    string,
} from "../validate.ts";

const SCHEMA = "openusage.limits.v2";

// What OpenUsage 0.7 printed. 0.8 prints only v2, so v1 means an OpenUsage too old for the gate.
const PREVIOUS_SCHEMA = "openusage.limits.v1";

interface OpenUsageResource {
    kind: string;
    unit: string;
    used?: number;
    available?: number;
    limit?: number;
    resetsAt?: string;
    windowSeconds?: number;
}

export interface OpenUsageProvider {
    displayName: string;
    plan?: string;
    fetchedAt: string;
    expiresAt: string;
    stale: boolean;
    resources: Record<string, OpenUsageResource>;
}

export interface OpenUsageLimits {
    schema: typeof SCHEMA;
    generatedAt: string;
    providers: Record<string, OpenUsageProvider>;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseLimits(input: unknown): ParseResult<OpenUsageLimits> {
    try {
        return { ok: true, value: limits(input) };
    } catch (error) {
        if (error instanceof ParseError) {
            return {
                ok: false,
                error: `openusage output does not match ${SCHEMA}: ${error.message}`,
            };
        }
        throw error;
    }
}

function limits(input: unknown): OpenUsageLimits {
    const root = object(input, "$");
    const schema = string(root, "schema", "$");
    if (schema === PREVIOUS_SCHEMA) {
        throw new ParseError(
            `$.schema is "${schema}", which OpenUsage 0.7 prints; the quota gate needs OpenUsage 0.8 or later`,
        );
    }
    if (schema !== SCHEMA) {
        throw new ParseError(`$.schema is "${schema}", expected "${SCHEMA}"`);
    }
    const providers = object(root.providers, "$.providers");
    return {
        schema: SCHEMA,
        generatedAt: timestamp(root, "generatedAt", "$"),
        providers: Object.fromEntries(
            Object.entries(providers).map(([key, value]) => [
                key,
                provider(value, `$.providers.${key}`),
            ]),
        ),
    };
}

function provider(input: unknown, path: string): OpenUsageProvider {
    const entry = object(input, path);
    const resources = object(entry.resources, `${path}.resources`);
    const plan = optional(entry, "plan", path, string);
    return {
        displayName: string(entry, "displayName", path),
        ...(plan === undefined ? {} : { plan }),
        fetchedAt: timestamp(entry, "fetchedAt", path),
        expiresAt: timestamp(entry, "expiresAt", path),
        stale: boolean(entry, "stale", path),
        resources: Object.fromEntries(
            Object.entries(resources).map(([key, value]) => [
                key,
                resource(value, `${path}.resources.${key}`),
            ]),
        ),
    };
}

// `remaining`, `utilization` and a balance's `expiresAt` are validated, because
// validation covers the whole document, but not kept: the gate reads none of them.
function resource(input: unknown, path: string): OpenUsageResource {
    const entry = object(input, path);
    optional(entry, "remaining", path, number);
    optional(entry, "utilization", path, number);
    optional(entry, "expiresAt", path, timestamps);
    const values: OpenUsageResource = {
        kind: string(entry, "kind", path),
        unit: string(entry, "unit", path),
        used: optional(entry, "used", path, number),
        available: optional(entry, "available", path, number),
        limit: optional(entry, "limit", path, number),
        resetsAt: optional(entry, "resetsAt", path, timestamp),
        windowSeconds: optional(entry, "windowSeconds", path, number),
    };
    // A field the document leaves out stays out, rather than becoming a key set to undefined.
    return Object.fromEntries(
        Object.entries(values).filter(([, value]) => value !== undefined),
    ) as unknown as OpenUsageResource;
}

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isTimestamp(value: unknown): value is string {
    return typeof value === "string" && RFC3339.test(value) && !Number.isNaN(Date.parse(value));
}

function timestamp(parent: Json, key: string, path: string): string {
    const value = string(parent, key, path);
    if (!isTimestamp(value)) {
        throw new ParseError(`${path}.${key} must be an RFC 3339 timestamp`);
    }
    return value;
}

function timestamps(parent: Json, key: string, path: string): string[] {
    return array(parent[key], `${path}.${key}`).map((value, index) => {
        if (!isTimestamp(value)) {
            throw new ParseError(`${path}.${key}[${index}] must be an RFC 3339 timestamp`);
        }
        return value;
    });
}
