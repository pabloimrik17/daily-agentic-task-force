// An issue without relations omits the lists, so an absent list is an empty one.

import type { BeadsConfig } from "../config.ts";
import type { Exec } from "../exec.ts";
import { authoredComments, runJson } from "../label-triage/trackers/cli-json.ts";
import { array, type Json, object, optional, ParseError, string } from "../validate.ts";
import { absent, emptyContext, nullableString } from "./shared.ts";
import type { ContextReader, RelatedTask, TaskContext } from "./types.ts";

interface Edge {
    type: string;
    task: RelatedTask;
    description: string | null;
}

function list(entry: Json, key: string, path: string): unknown[] {
    return absent(entry[key]) ? [] : array(entry[key], `${path}.${key}`);
}

function edges(entry: Json, key: string, path: string): Edge[] {
    return list(entry, key, path).map((item, index) => {
        const edgePath = `${path}.${key}[${index}]`;
        const edge = object(item, edgePath);
        return {
            type: string(edge, "dependency_type", edgePath),
            task: {
                id: string(edge, "id", edgePath),
                title: string(edge, "title", edgePath),
                state: string(edge, "status", edgePath),
                url: null,
            },
            description: optional(edge, "description", edgePath, string) ?? null,
        };
    });
}

function ofType(edgesOf: Edge[], ...types: string[]): RelatedTask[] {
    return edgesOf.filter(({ type }) => types.includes(type)).map(({ task }) => task);
}

function parseContext(value: unknown): TaskContext {
    const items = array(value, "$");
    if (items.length !== 1) {
        throw new ParseError("$ must hold exactly one element");
    }
    const entry = object(items[0], "$[0]");
    const dependencies = edges(entry, "dependencies", "$[0]");
    const dependents = edges(entry, "dependents", "$[0]");
    const parent = dependencies.find(({ type }) => type === "parent-child");
    return {
        ...emptyContext(),
        comments: authoredComments(
            list(entry, "comments", "$[0]"),
            "$[0].comments",
            { body: "text", createdAt: "created_at" },
            (comment, path) => nullableString(comment, "author", path),
        ),
        parent: parent === undefined ? null : { ...parent.task, description: parent.description },
        children: ofType(dependents, "parent-child"),
        blockedBy: ofType(dependencies, "blocks"),
        blocks: ofType(dependents, "blocks"),
        related: ofType([...dependencies, ...dependents], "related", "relates-to"),
        duplicates: ofType([...dependencies, ...dependents], "duplicates"),
    };
}

export function beadsContext(exec: Exec, config: BeadsConfig): ContextReader {
    return {
        source: "beads",
        read(task) {
            return runJson(
                exec,
                `bd show ${task.id} --json --include-comments --include-dependents`,
                [
                    "-C",
                    config.directory,
                    "show",
                    task.id,
                    "--json",
                    "--include-comments",
                    "--include-dependents",
                ],
                parseContext,
            );
        },
    };
}
