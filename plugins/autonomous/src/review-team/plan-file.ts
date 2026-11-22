// Reading the report directory's JSON files back (design D11): `plan.json`,
// validated as strictly as a reviewer's output, so `run` and `collect` never
// act on a plan they cannot trust.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Result } from "../result.ts";
import {
    array,
    boolean,
    type Json,
    object,
    optional,
    ParseError,
    rejectUnknownKeys,
    string,
} from "../validate.ts";
import {
    choice,
    engine,
    measure,
    nonEmpty,
    security,
    subject,
    tierChoice,
    toResult,
} from "./schema.ts";
import {
    type Plan,
    PLAN_SCHEMA,
    type PlannedReviewer,
    REVIEWER_IDS,
    type SkippedReviewer,
} from "./types.ts";

export function readJson(path: string): Result<unknown> {
    try {
        return { ok: true, value: JSON.parse(readFileSync(path, "utf8")) as unknown };
    } catch (error) {
        return { ok: false, error: (error as Error).message };
    }
}

function withOptional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
    return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}

// The plan names files of the report directory: never absolute, never outside it.
function insidePath(parent: Json, key: string, path: string): string {
    const value = nonEmpty(parent, key, path);
    if (value.startsWith("/") || value.includes("\\") || value.split("/").includes("..")) {
        throw new ParseError(`${path}.${key} must be a path inside the report directory`);
    }
    return value;
}

function createdAt(parent: Json, path: string): string {
    const value = nonEmpty(parent, "createdAt", path);
    if (Number.isNaN(Date.parse(value))) {
        throw new ParseError(`${path}.createdAt must be an ISO 8601 date`);
    }
    return value;
}

function plannedReviewer(value: unknown, path: string): PlannedReviewer {
    const parent = object(value, path);
    rejectUnknownKeys(
        parent,
        ["reviewer", "angle", "kind", "required", "engine", "brief", "output"],
        path,
    );
    return {
        reviewer: choice(parent, "reviewer", path, REVIEWER_IDS),
        angle: nonEmpty(parent, "angle", path),
        kind: choice(parent, "kind", path, ["cli", "teammate"]),
        required: boolean(parent, "required", path),
        engine: engine(parent.engine, `${path}.engine`),
        ...withOptional("brief", optional(parent, "brief", path, insidePath)),
        output: insidePath(parent, "output", path),
    };
}

function skippedReviewer(value: unknown, path: string): SkippedReviewer {
    const parent = object(value, path);
    rejectUnknownKeys(parent, ["reviewer", "reason"], path);
    return {
        reviewer: choice(parent, "reviewer", path, REVIEWER_IDS),
        reason: nonEmpty(parent, "reason", path),
    };
}

function guide(value: unknown, path: string): Plan["guide"] {
    const parent = object(value, path);
    rejectUnknownKeys(parent, ["available", "reason"], path);
    return {
        available: boolean(parent, "available", path),
        ...withOptional("reason", optional(parent, "reason", path, nonEmpty)),
    };
}

function list<T>(parent: Json, key: string, read: (value: unknown, path: string) => T): T[] {
    return array(parent[key], `$.${key}`).map((entry, index) => read(entry, `$.${key}[${index}]`));
}

function plan(input: unknown): Plan {
    const parent = object(input, "$");
    rejectUnknownKeys(
        parent,
        [
            "schema",
            "createdAt",
            "subject",
            "status",
            "measure",
            "tier",
            "security",
            "team",
            "skipped",
            "guide",
        ],
        "$",
    );
    return {
        schema: choice(parent, "schema", "$", [PLAN_SCHEMA]),
        createdAt: createdAt(parent, "$"),
        subject: subject(parent.subject, "$.subject"),
        status: string(parent, "status", "$"),
        measure: measure(parent.measure, "$.measure"),
        tier: tierChoice(parent.tier, "$.tier"),
        security: security(parent.security, "$.security"),
        team: list(parent, "team", plannedReviewer),
        skipped: list(parent, "skipped", skippedReviewer),
        guide: guide(parent.guide, "$.guide"),
    };
}

// Strict: an unknown key, a missing field or a path outside the report
// directory is an error naming its path.
export function parsePlan(input: unknown): Result<Plan> {
    return toResult(() => plan(input));
}

export function readPlan(dir: string): Result<Plan> {
    const json = readJson(join(dir, "plan.json"));
    if (!json.ok) {
        return { ok: false, error: `reading plan.json: ${json.error}` };
    }
    const parsed = parsePlan(json.value);
    return parsed.ok ? parsed : { ok: false, error: `plan.json is not valid: ${parsed.error}` };
}
