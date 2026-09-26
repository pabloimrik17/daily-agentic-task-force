import { describe, expect, it } from "vitest";

import type { Exec, ExecResult } from "../../exec.ts";
import { ParseError } from "../../validate.ts";
import { parseError, parseJson, run, runJson } from "./cli-json.ts";

function fakeExec(handler: (args: string[]) => ExecResult): Exec & { calls: string[][] } {
    const calls: string[][] = [];
    const exec = (args: string[]) => {
        calls.push(args);
        return Promise.resolve(handler(args));
    };
    return Object.assign(exec, { calls });
}

describe("parseError", () => {
    it("names the command and the shape error for a ParseError", () => {
        expect(parseError("bd list --json", new ParseError("$.id must be a string"))).toBe(
            "bd list --json: output does not match the expected shape: $.id must be a string",
        );
    });

    it("names the command and the underlying message for any other error", () => {
        expect(parseError("bd list --json", new Error("Unexpected token"))).toBe(
            "bd list --json: output is not valid JSON: Unexpected token",
        );
    });
});

describe("parseJson", () => {
    it("parses valid JSON", () => {
        expect(parseJson("cmd", '{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    });

    it("reports invalid JSON naming the command", () => {
        const result = parseJson("cmd", "not json");
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error).toMatch(/^cmd: output is not valid JSON: /);
    });
});

describe("runJson", () => {
    it("runs the exec, parses stdout and returns the parsed value on success", async () => {
        const exec = fakeExec(() => ({ ok: true, stdout: JSON.stringify({ id: "x" }) }));
        const result = await runJson(exec, "cmd", ["a", "b"], (value) => {
            const object = value as { id: string };
            return object.id;
        });

        expect(exec.calls).toEqual([["a", "b"]]);
        expect(result).toEqual({ ok: true, value: "x" });
    });

    it("maps an exec failure to the command and the error, by default", async () => {
        const exec = fakeExec(() => ({ ok: false, error: "cmd CLI not found on PATH" }));
        const result = await runJson(exec, "cmd", [], () => "unused");

        expect(result).toEqual({ ok: false, error: "cmd: cmd CLI not found on PATH" });
    });

    it("routes an exec failure through a custom mapError", async () => {
        const exec = fakeExec(() => ({ ok: false, error: "not authenticated" }));
        const result = await runJson(
            exec,
            "cmd",
            [],
            () => "unused",
            () => "cmd: mapped",
        );

        expect(result).toEqual({ ok: false, error: "cmd: mapped" });
    });

    it("reports invalid JSON naming the command", async () => {
        const exec = fakeExec(() => ({ ok: true, stdout: "not json" }));
        const result = await runJson(exec, "cmd", [], () => "unused");

        expect(result.ok).toBe(false);
        expect(!result.ok && result.error).toMatch(/^cmd: output is not valid JSON: /);
    });

    it("reports a shape error thrown by the parser, naming the command", async () => {
        const exec = fakeExec(() => ({ ok: true, stdout: "{}" }));
        const result = await runJson(exec, "cmd", [], () => {
            throw new ParseError("$.id must be a string");
        });

        expect(result).toEqual({
            ok: false,
            error: "cmd: output does not match the expected shape: $.id must be a string",
        });
    });
});

describe("run", () => {
    it("succeeds with no value on a successful exec", async () => {
        const exec = fakeExec(() => ({ ok: true, stdout: "" }));
        const result = await run(exec, "cmd", ["a"]);

        expect(exec.calls).toEqual([["a"]]);
        expect(result).toEqual({ ok: true, value: undefined });
    });

    it("maps an exec failure to the command and the error, by default", async () => {
        const exec = fakeExec(() => ({ ok: false, error: "cmd failed: boom" }));
        const result = await run(exec, "cmd", []);

        expect(result).toEqual({ ok: false, error: "cmd: cmd failed: boom" });
    });

    it("routes an exec failure through a custom mapError", async () => {
        const exec = fakeExec(() => ({ ok: false, error: "not authenticated" }));
        const result = await run(exec, "cmd", [], () => "cmd: mapped");

        expect(result).toEqual({ ok: false, error: "cmd: mapped" });
    });
});
