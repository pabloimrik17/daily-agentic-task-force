// The active account (ADR 0006): the email address Claude Code reports for its login, read with
// `claude auth status`. Only `loggedIn` and `email` are read, so a field that a later Claude
// Code adds or drops elsewhere does not stop the gate.

import type { Exec, ExecResult } from "../exec.ts";
import { boolean, object, ParseError } from "../validate.ts";

type LoginRead = { ok: true; email: string } | { ok: false; error: string };

// What the CLI printed: an answer about the login, or text that is no answer at all.
type Status = { read: true; login: LoginRead } | { read: false; detail: string };

const COMMAND = "claude auth status";

function failure(result: Extract<ExecResult, { ok: false }>): string {
    return result.exit ? `${result.error} (exit ${result.exit.code})` : result.error;
}

function unreadable(detail: string): LoginRead {
    return { ok: false, error: `the output of ${COMMAND} could not be read: ${detail}` };
}

function loginOf(status: Record<string, unknown>): LoginRead {
    if (!boolean(status, "loggedIn", "$")) {
        return { ok: false, error: `Claude Code has no login: ${COMMAND} reports loggedIn false` };
    }
    return emailOf(status);
}

function emailOf(status: Record<string, unknown>): LoginRead {
    const { email } = status;
    if (typeof email !== "string" || email.trim() === "") {
        return {
            ok: false,
            error: `the Claude Code login has no email address to match: ${COMMAND} reports no email`,
        };
    }
    return { ok: true, email: email.trim() };
}

function parseStatus(stdout: string): Status {
    let json: unknown;
    try {
        json = JSON.parse(stdout);
    } catch (error) {
        return { read: false, detail: `not valid JSON (${(error as Error).message})` };
    }
    try {
        return { read: true, login: loginOf(object(json, "$")) };
    } catch (error) {
        if (error instanceof ParseError) return { read: false, detail: error.message };
        throw error;
    }
}

// Exit 1 is how Claude Code answers "nobody is logged in", so its output is read like exit 0's.
// It is also how a CLI fails, so an exit 1 that prints no answer is reported as the failure it
// is, with its stderr. Any other exit is a CLI failure.
export async function readLogin(exec: Exec): Promise<LoginRead> {
    const result = await exec(["auth", "status"]);
    if (result.ok) {
        const status = parseStatus(result.stdout);
        return status.read ? status.login : unreadable(status.detail);
    }
    if (result.exit?.code === 1) {
        const status = parseStatus(result.exit.stdout);
        if (status.read) return status.login;
    }
    return { ok: false, error: failure(result) };
}
