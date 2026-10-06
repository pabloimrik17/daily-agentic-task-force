// The PostToolUse capture hook (design D5): the engine reads the run's data
// from files, never from what Claude retyped. An IBKR read is stored as the
// server returned it; a `javascript_tool` result is stored only when it is an
// envelope of the active run, so unrelated JavaScript and another run's
// results leave nothing behind. The hook never blocks a tool: every failure
// returns a reason and the process exits 0.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { rawDir, readActiveRun, resolveStateDir, writePrivate } from "./state.ts";

const IBKR_READS = new Set(["mcp__ibkr__get_account_positions", "mcp__ibkr__get_account_orders"]);
const JAVASCRIPT_TOOL = /^mcp__(?:claude-in-chrome|Claude_in_Chrome)__javascript_tool$/;
const ENVELOPE_NAME = /^([a-z][a-z0-9-]*)\.v\d+$/;

export interface CaptureResult {
    written: string | null;
    reason: string;
}

const skipped = (reason: string): CaptureResult => ({ written: null, reason });

const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

function parseCandidate(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}");
        if (start === -1 || end <= start) {
            return null;
        }
        try {
            return JSON.parse(text.slice(start, end + 1));
        } catch {
            return null;
        }
    }
}

/**
 * The content blocks of a tool result. Claude in Chrome's `javascript_tool`
 * hands the hook a bare array of `{ type: "text", text }` blocks, the result
 * first and a "Tab Context" block after it (task 1.5); a `{ content }` object
 * is the MCP result shape.
 */
function blocksOf(response: unknown): unknown[] {
    if (Array.isArray(response)) {
        return response as unknown[];
    }
    return isObject(response) && Array.isArray(response.content)
        ? (response.content as unknown[])
        : [];
}

function candidates(response: unknown): unknown[] {
    if (typeof response === "string") {
        return [parseCandidate(response)];
    }
    const found = blocksOf(response)
        .filter((item) => isObject(item) && typeof item.text === "string")
        .map((item) => parseCandidate((item as { text: string }).text));
    if (isObject(response)) {
        found.push(response);
    }
    return found;
}

/** The envelope of `runId` among the candidates, with the name it is stored under. */
function findEnvelope(
    response: unknown,
    runId: string,
): { name: string; envelope: Record<string, unknown> } | CaptureResult {
    let sawEnvelope = false;
    for (const candidate of candidates(response)) {
        if (!isObject(candidate) || typeof candidate.stonks !== "string") {
            continue;
        }
        const name = ENVELOPE_NAME.exec(candidate.stonks)?.[1];
        if (name === undefined) {
            continue;
        }
        sawEnvelope = true;
        if (candidate.run === runId) {
            return { name, envelope: candidate };
        }
    }
    return skipped(sawEnvelope ? "envelope belongs to another run" : "no stonks envelope");
}

export function capture(
    payload: string,
    options: { env: Record<string, string | undefined>; now: Date },
): CaptureResult {
    let parsed: unknown;
    try {
        parsed = JSON.parse(payload);
    } catch {
        return skipped("malformed payload");
    }
    if (!isObject(parsed) || typeof parsed.tool_name !== "string") {
        return skipped("malformed payload");
    }
    const toolName = parsed.tool_name;
    const isIbkr = IBKR_READS.has(toolName);
    if (!isIbkr && !JAVASCRIPT_TOOL.test(toolName)) {
        return skipped("tool not captured");
    }
    const stateDir = resolveStateDir(options.env);
    const run = readActiveRun({ stateDir, now: options.now });
    if (run === null) {
        return skipped("no active run");
    }
    let kind = toolName;
    let text: string;
    if (isIbkr) {
        const response = parsed.tool_response;
        if (response === undefined) {
            return skipped("no tool_response");
        }
        text = typeof response === "string" ? response : JSON.stringify(response);
    } else {
        const found = findEnvelope(parsed.tool_response, run.runId);
        if (!("name" in found)) {
            return found;
        }
        kind = found.name;
        text = JSON.stringify(found.envelope);
    }
    const seq = String(options.now.getTime()).padStart(15, "0");
    const path = join(rawDir(stateDir, run.runId), `${seq}-${kind}.json`);
    writePrivate(path, text);
    return { written: path, reason: "captured" };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        capture(readFileSync(0, "utf8"), { env: process.env, now: new Date() });
    } catch {
        // never block the tool
    }
    process.exit(0);
}
