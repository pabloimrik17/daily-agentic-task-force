// Hand-written validation primitives shared by every strict parser in this
// plugin: plugins install without dependencies, so no schema library is
// available at runtime. A missing required field, a mistyped field or an
// unknown field is an error naming its path, never a default.

export class ParseError extends Error {}

export type Json = Record<string, unknown>;

export function object(value: unknown, path: string): Json {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new ParseError(`${path} must be an object`);
    }
    return value as Json;
}

export function array(value: unknown, path: string): unknown[] {
    if (!Array.isArray(value)) {
        throw new ParseError(`${path} must be an array`);
    }
    return value;
}

export function optional<T>(
    parent: Json,
    key: string,
    path: string,
    read: (parent: Json, key: string, path: string) => T,
): T | undefined {
    return key in parent ? read(parent, key, path) : undefined;
}

export function string(parent: Json, key: string, path: string): string {
    const value = parent[key];
    if (typeof value !== "string") {
        throw new ParseError(`${path}.${key} must be a string`);
    }
    return value;
}

export function number(parent: Json, key: string, path: string): number {
    const value = parent[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new ParseError(`${path}.${key} must be a finite number`);
    }
    return value;
}

export function boolean(parent: Json, key: string, path: string): boolean {
    const value = parent[key];
    if (typeof value !== "boolean") {
        throw new ParseError(`${path}.${key} must be a boolean`);
    }
    return value;
}

export function stringArray(parent: Json, key: string, path: string): string[] {
    const values = array(parent[key], `${path}.${key}`);
    return values.map((value, index) => {
        if (typeof value !== "string") {
            throw new ParseError(`${path}.${key}[${index}] must be a string`);
        }
        return value;
    });
}

export function rejectUnknownKeys(parent: Json, allowed: readonly string[], path: string): void {
    for (const key of Object.keys(parent)) {
        if (!allowed.includes(key)) {
            throw new ParseError(`${path}.${key} is not a recognised field`);
        }
    }
}
