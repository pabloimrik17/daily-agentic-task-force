// Hand-written validator for `openusage.limits.v1` (design D4): plugins install
// without dependencies, so no schema library is available at runtime. A missing
// or mistyped field is an error with its path, never a default.

const SCHEMA = "openusage.limits.v1";

export interface OpenUsageResource {
    kind: string;
    unit: string;
    used?: number;
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

export interface OpenUsageError {
    providerId: string;
    message: string;
}

export interface OpenUsageLimits {
    schema: typeof SCHEMA;
    generatedAt: string;
    providers: Record<string, OpenUsageProvider>;
    errors: OpenUsageError[];
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

class ParseError extends Error {}

type Json = Record<string, unknown>;

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
    if (schema !== SCHEMA) {
        throw new ParseError(`$.schema is "${schema}", expected "${SCHEMA}"`);
    }
    const providers = object(root.providers, "$.providers");
    const errors = array(root.errors, "$.errors");
    return {
        schema: SCHEMA,
        generatedAt: timestamp(root, "generatedAt", "$"),
        providers: Object.fromEntries(
            Object.entries(providers).map(([key, value]) => [
                key,
                provider(value, `$.providers.${key}`),
            ]),
        ),
        errors: errors.map((value, index) => {
            const path = `$.errors[${index}]`;
            const entry = object(value, path);
            return {
                providerId: string(entry, "providerId", path),
                message: string(entry, "message", path),
            };
        }),
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

function resource(input: unknown, path: string): OpenUsageResource {
    const entry = object(input, path);
    const result: OpenUsageResource = {
        kind: string(entry, "kind", path),
        unit: string(entry, "unit", path),
    };
    const used = optional(entry, "used", path, number);
    const limit = optional(entry, "limit", path, number);
    const resetsAt = optional(entry, "resetsAt", path, timestamp);
    const windowSeconds = optional(entry, "windowSeconds", path, number);
    if (used !== undefined) result.used = used;
    if (limit !== undefined) result.limit = limit;
    if (resetsAt !== undefined) result.resetsAt = resetsAt;
    if (windowSeconds !== undefined) result.windowSeconds = windowSeconds;
    return result;
}

function object(value: unknown, path: string): Json {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new ParseError(`${path} must be an object`);
    }
    return value as Json;
}

function array(value: unknown, path: string): unknown[] {
    if (!Array.isArray(value)) {
        throw new ParseError(`${path} must be an array`);
    }
    return value;
}

function optional<T>(
    parent: Json,
    key: string,
    path: string,
    read: (parent: Json, key: string, path: string) => T,
): T | undefined {
    return key in parent ? read(parent, key, path) : undefined;
}

function string(parent: Json, key: string, path: string): string {
    const value = parent[key];
    if (typeof value !== "string") {
        throw new ParseError(`${path}.${key} must be a string`);
    }
    return value;
}

function number(parent: Json, key: string, path: string): number {
    const value = parent[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new ParseError(`${path}.${key} must be a finite number`);
    }
    return value;
}

function boolean(parent: Json, key: string, path: string): boolean {
    const value = parent[key];
    if (typeof value !== "boolean") {
        throw new ParseError(`${path}.${key} must be a boolean`);
    }
    return value;
}

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function timestamp(parent: Json, key: string, path: string): string {
    const value = string(parent, key, path);
    if (!RFC3339.test(value) || Number.isNaN(Date.parse(value))) {
        throw new ParseError(`${path}.${key} must be an ISO 8601 timestamp`);
    }
    return value;
}
