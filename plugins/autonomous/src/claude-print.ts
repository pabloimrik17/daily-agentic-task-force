// The one `claude -p` call every LLM step of this plugin makes: an isolated
// print-mode session with a JSON schema and the prompt on stdin, whose
// envelope is checked here. The caller validates the payload it gets back.

import type { Exec } from "./exec.ts";
import { boolean, type Json, object, ParseError, string } from "./validate.ts";

export const PRINT_TIMEOUT_MS = 300_000;

export interface PrintRequest {
    model: string;
    effort: string;
    schema: object;
    prompt: string;
}

export type PrintResult = { ok: true; output: Json } | { ok: false; error: string };

export async function claudePrint(exec: Exec, request: PrintRequest): Promise<PrintResult> {
    // The prompt carries issue bodies anyone can write, so the session runs with every
    // customisation off, no tools, no MCP servers and no transcript. `--bare` would also
    // drop the keychain OAuth the subscription needs.
    const result = await exec(
        [
            "-p",
            "--safe-mode",
            "--tools",
            "",
            "--strict-mcp-config",
            "--no-session-persistence",
            "--model",
            request.model,
            "--effort",
            request.effort,
            "--output-format",
            "json",
            "--json-schema",
            JSON.stringify(request.schema),
        ],
        request.prompt,
    );
    if (!result.ok) {
        return result;
    }
    let json: unknown;
    try {
        json = JSON.parse(result.stdout);
    } catch (error) {
        return {
            ok: false,
            error: `claude output is not valid JSON: ${(error as Error).message}`,
        };
    }
    try {
        return { ok: true, output: envelope(json) };
    } catch (error) {
        return { ok: false, error: `claude envelope: ${parseMessage(error)}` };
    }
}

export function parseMessage(error: unknown): string {
    if (error instanceof ParseError) {
        return error.message;
    }
    throw error;
}

function envelope(input: unknown): Json {
    const root = object(input, "$");
    const type = string(root, "type", "$");
    if (type !== "result") {
        throw new ParseError(`$.type is "${type}", expected "result"`);
    }
    const subtype = string(root, "subtype", "$");
    if (subtype !== "success") {
        throw new ParseError(`$.subtype is "${subtype}", expected "success"`);
    }
    if (boolean(root, "is_error", "$")) {
        throw new ParseError("$.is_error is true, expected false");
    }
    return object(root.structured_output, "$.structured_output");
}
