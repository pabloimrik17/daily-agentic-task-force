import { describe, expect, it } from "vitest";

import { claudePrint, parseMessage, PRINT_TIMEOUT_MS, type PrintRequest } from "./claude-print.ts";
import type { Exec, ExecResult } from "./exec.ts";
import { ParseError } from "./validate.ts";

const REQUEST: PrintRequest = {
    model: "claude-sonnet-5",
    effort: "high",
    schema: { type: "object", properties: { pick: { type: "string" } } },
    prompt: "Pick one.",
};

function fakeExec(
    handler: (args: string[], input: string | undefined) => ExecResult,
): Exec & { calls: { args: string[]; input: string | undefined }[] } {
    const calls: { args: string[]; input: string | undefined }[] = [];
    const exec = (args: string[], input?: string) => {
        calls.push({ args, input });
        return Promise.resolve(handler(args, input));
    };
    return Object.assign(exec, { calls });
}

function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        type: "result",
        subtype: "success",
        is_error: false,
        structured_output: { pick: "a" },
        ...overrides,
    };
}

const succeeding = (body: unknown) => fakeExec(() => ({ ok: true, stdout: JSON.stringify(body) }));

describe("claudePrint", () => {
    it("allows 300 s per call", () => {
        expect(PRINT_TIMEOUT_MS).toBe(300_000);
    });

    it("calls claude in isolated print mode with the model, effort and schema, prompt on stdin", async () => {
        const exec = succeeding(envelope());
        await claudePrint(exec, REQUEST);

        expect(exec.calls).toEqual([
            {
                args: [
                    "-p",
                    "--safe-mode",
                    "--tools",
                    "",
                    "--strict-mcp-config",
                    "--no-session-persistence",
                    "--model",
                    "claude-sonnet-5",
                    "--effort",
                    "high",
                    "--output-format",
                    "json",
                    "--json-schema",
                    JSON.stringify(REQUEST.schema),
                ],
                input: "Pick one.",
            },
        ]);
    });

    it("returns the structured output of a successful envelope", async () => {
        const result = await claudePrint(succeeding(envelope()), REQUEST);

        expect(result).toEqual({ ok: true, output: { pick: "a" } });
    });

    it("passes a failed call through unchanged", async () => {
        const exec = fakeExec(() => ({ ok: false, error: "claude timed out after 300 s" }));

        expect(await claudePrint(exec, REQUEST)).toEqual({
            ok: false,
            error: "claude timed out after 300 s",
        });
    });

    it("reports output that is not valid JSON", async () => {
        const result = await claudePrint(
            fakeExec(() => ({ ok: true, stdout: "not json" })),
            REQUEST,
        );

        expect(result.ok).toBe(false);
        expect(!result.ok && result.error).toMatch(/^claude output is not valid JSON: /);
    });

    it.each([
        [{ type: "system" }, 'claude envelope: $.type is "system", expected "result"'],
        [
            { subtype: "error_max_turns" },
            'claude envelope: $.subtype is "error_max_turns", expected "success"',
        ],
        [{ is_error: true }, "claude envelope: $.is_error is true, expected false"],
    ])("rejects an envelope overridden by %j", async (overrides, error) => {
        const result = await claudePrint(succeeding(envelope(overrides)), REQUEST);

        expect(result).toEqual({ ok: false, error });
    });

    it.each([
        ["without structured output", { structured_output: undefined }],
        ["whose structured output is not an object", { structured_output: "text" }],
    ])("rejects an envelope %s", async (_name, overrides) => {
        const result = await claudePrint(succeeding(envelope(overrides)), REQUEST);

        expect(result.ok).toBe(false);
        expect(!result.ok && result.error).toMatch(/^claude envelope: \$\.structured_output /);
    });
});

describe("parseMessage", () => {
    it("returns the message of a parse error", () => {
        expect(parseMessage(new ParseError("$.x is missing"))).toBe("$.x is missing");
    });

    it("rethrows anything else", () => {
        expect(() => parseMessage(new Error("boom"))).toThrow("boom");
    });
});
