import { describe, expect, it } from "vitest";

import type { ExecResult } from "../exec.ts";
import { readLogin } from "./login.ts";
import { ANA, authStatus, fakeLogin } from "./test-fixtures.ts";

const answering = (result: ExecResult) => () => Promise.resolve(result);

// How `execCommand` returns an exit it keeps the output of.
const exited = (code: number, stdout: string): ExecResult => ({
    ok: false,
    error: "claude failed: Command failed: claude auth status",
    exit: { code, stdout },
});

const unreadable = "the output of claude auth status could not be read";

describe("readLogin", () => {
    it("returns the email address of a login, asking claude auth status", async () => {
        const exec = fakeLogin(ANA);
        expect(await readLogin(exec)).toEqual({ ok: true, email: ANA });
        expect(exec.calls).toEqual([["auth", "status"]]);
    });

    it("reads exit 1 as the answer for no login", async () => {
        const result = await readLogin(answering(exited(1, JSON.stringify(authStatus()))));
        expect(result).toEqual({
            ok: false,
            error: "Claude Code has no login: claude auth status reports loggedIn false",
        });
    });

    it.each([
        ["no email field", { loggedIn: true, authMethod: "api_key" }],
        ["an empty email", { ...authStatus(ANA), email: " " }],
        ["a null email", { ...authStatus(ANA), email: null }],
    ])("names the missing email address of a login with %s", async (_name, status) => {
        const result = await readLogin(answering({ ok: true, stdout: JSON.stringify(status) }));
        expect(result).toEqual({
            ok: false,
            error: "the Claude Code login has no email address to match: claude auth status reports no email",
        });
    });

    it.each([
        ["a missing CLI", { ok: false, error: "claude CLI not found on PATH" }],
        ["a timeout", { ok: false, error: "claude timed out after 120 s" }],
    ] as const)("passes on %s", async (_name, failure) => {
        expect(await readLogin(answering(failure))).toEqual(failure);
    });

    it("does not read the output of another exit code, and names it", async () => {
        const result = await readLogin(answering(exited(2, JSON.stringify(authStatus(ANA)))));
        expect(result).toEqual({
            ok: false,
            error: "claude failed: Command failed: claude auth status (exit 2)",
        });
    });

    it.each([
        ["text that is not JSON", "Logged in as someone", /: not valid JSON \(/],
        ["JSON that is not an object", "[]", /: \$ must be an object$/],
        ["no loggedIn field", JSON.stringify({ email: ANA }), /: \$\.loggedIn must be a boolean$/],
    ])("says the output could not be read on %s", async (_name, stdout, detail) => {
        const result = await readLogin(answering({ ok: true, stdout }));
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error).toMatch(new RegExp(`^${unreadable}`));
        expect(!result.ok && result.error).toMatch(detail);
    });
});
