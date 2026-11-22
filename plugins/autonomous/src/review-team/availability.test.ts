import { describe, expect, it } from "vitest";

import type { Exec, ExecResult } from "../exec.ts";
import {
    type AvailabilityDeps,
    checkAvailability,
    engineVersion,
    guideAvailability,
} from "./availability.ts";

type Answers = Record<string, ExecResult>;

const OK: ExecResult = { ok: true, stdout: "" };

// An exec factory answering by command name; a command with no answer is not on the PATH.
function fakeExec(answers: Answers, calls: string[][] = []): AvailabilityDeps["exec"] {
    return (command): Exec =>
        (args) => {
            calls.push([command, ...args]);
            return Promise.resolve(
                answers[command] ?? { ok: false, error: `${command} CLI not found on PATH` },
            );
        };
}

function deps(overrides: Partial<AvailabilityDeps> = {}, answers: Answers = {}): AvailabilityDeps {
    return {
        exec: fakeExec(answers),
        exists: () => false,
        home: "/home/u",
        repoRoot: "/work/repo",
        fallowPlugin: () => Promise.resolve(true),
        ...overrides,
    };
}

const reasonOf = (result: Awaited<ReturnType<typeof checkAvailability>>): string | undefined =>
    result.available ? undefined : result.reason;

describe("checkAvailability", () => {
    it("always finds the walkthrough and the tests lens available", async () => {
        expect(await checkAvailability("walkthrough", deps())).toEqual({ available: true });
        expect(await checkAvailability("tests-lens", deps())).toEqual({ available: true });
    });

    describe("codex", () => {
        it("is available when login status exits 0", async () => {
            const calls: string[][] = [];
            const result = await checkAvailability(
                "codex",
                deps({ exec: fakeExec({ codex: OK }, calls) }),
            );
            expect(result).toEqual({ available: true });
            expect(calls).toEqual([["codex", "login", "status"]]);
        });

        it("Codex not logged in: is skipped as not logged in", async () => {
            const failing = { codex: { ok: false, error: "codex failed: Not logged in" } as const };
            const result = await checkAvailability("codex", deps({}, failing));
            expect(reasonOf(result)).toBe("not logged in");
        });

        it("is skipped with the missing tool as its reason", async () => {
            const result = await checkAvailability("codex", deps());
            expect(reasonOf(result)).toBe("codex CLI not found on PATH");
        });

        it("is skipped with the timeout as its reason", async () => {
            const slow = { codex: { ok: false, error: "codex timed out after 10 s" } as const };
            const result = await checkAvailability("codex", deps({}, slow));
            expect(reasonOf(result)).toBe("codex timed out after 10 s");
        });
    });

    describe("coderabbit", () => {
        const status = (stdout: string): Answers => ({ coderabbit: { ok: true, stdout } });

        it("is available when a status line says authenticated", async () => {
            const stdout = '{"type":"status","authenticated":true,"user":"u"}\n';
            const result = await checkAvailability("coderabbit", deps({}, status(stdout)));
            expect(result).toEqual({ available: true });
        });

        it("is skipped when no line says authenticated", async () => {
            const stdout = 'not json\n{"type":"status","authenticated":false}\n';
            const result = await checkAvailability("coderabbit", deps({}, status(stdout)));
            expect(reasonOf(result)).toBe("not logged in");
        });

        it("is skipped as not logged in when the command exits non-zero", async () => {
            const failing = {
                coderabbit: { ok: false, error: "coderabbit failed: no auth" } as const,
            };
            const result = await checkAvailability("coderabbit", deps({}, failing));
            expect(reasonOf(result)).toBe("not logged in");
        });

        it("is skipped with the timeout as its reason", async () => {
            const slow = {
                coderabbit: { ok: false, error: "coderabbit timed out after 10 s" } as const,
            };
            const result = await checkAvailability("coderabbit", deps({}, slow));
            expect(reasonOf(result)).toBe("coderabbit timed out after 10 s");
        });
    });

    describe.each(["code-review", "security-review"] as const)("%s", (id) => {
        it("is available when no skill of that name exists", async () => {
            expect(await checkAvailability(id, deps())).toEqual({ available: true });
        });

        it("Built-in shadowed: a user skill directory names itself as the shadow", async () => {
            const shadow = `/home/u/.claude/skills/${id}`;
            const result = await checkAvailability(id, deps({ exists: (p) => p === shadow }));
            expect(reasonOf(result)).toBe(`a skill named ${id} in ${shadow} shadows the built-in`);
        });

        it("Built-in shadowed: a repository skill directory counts too", async () => {
            const shadow = `/work/repo/.claude/skills/${id}`;
            const result = await checkAvailability(id, deps({ exists: (p) => p === shadow }));
            expect(reasonOf(result)).toContain(shadow);
        });
    });

    describe("fallow-review", () => {
        const withPackage = (path: string): boolean => path === "/work/repo/package.json";

        it("is available with a package.json, fallow and its plugin", async () => {
            const result = await checkAvailability(
                "fallow-review",
                deps({ exists: withPackage }, { fallow: OK }),
            );
            expect(result).toEqual({ available: true });
        });

        it("Not a JavaScript repository: is skipped as not applicable, running nothing", async () => {
            const calls: string[][] = [];
            const result = await checkAvailability(
                "fallow-review",
                deps({ exec: fakeExec({ fallow: OK }, calls) }),
            );
            expect(reasonOf(result)).toBe("not applicable: no package.json");
            expect(calls).toEqual([]);
        });

        it("is skipped when fallow is not on the PATH", async () => {
            const result = await checkAvailability("fallow-review", deps({ exists: withPackage }));
            expect(reasonOf(result)).toBe("fallow CLI not found on PATH");
        });

        it("is skipped when the fallow check times out", async () => {
            const slow = { fallow: { ok: false, error: "fallow timed out after 10 s" } as const };
            const result = await checkAvailability(
                "fallow-review",
                deps({ exists: withPackage }, slow),
            );
            expect(reasonOf(result)).toBe("fallow timed out after 10 s");
        });

        it("is skipped when the fallow plugin is not installed", async () => {
            const result = await checkAvailability(
                "fallow-review",
                deps(
                    { exists: withPackage, fallowPlugin: () => Promise.resolve(false) },
                    { fallow: OK },
                ),
            );
            expect(reasonOf(result)).toBe("the fallow plugin is not installed");
        });
    });
});

describe("guideAvailability", () => {
    it("is available with plannotator on the PATH", async () => {
        const calls: string[][] = [];
        const result = await guideAvailability({ exec: fakeExec({ plannotator: OK }, calls) });
        expect(result).toEqual({ available: true });
        expect(calls).toEqual([["plannotator", "--version"]]);
    });

    it("is unavailable, with the reason, without plannotator", async () => {
        expect(await guideAvailability({ exec: fakeExec({}) })).toEqual({
            available: false,
            reason: "plannotator CLI not found on PATH",
        });
    });
});

describe("engineVersion", () => {
    it("returns the trimmed output of `<tool> --version`", async () => {
        const answers = { codex: { ok: true, stdout: "codex-cli 0.5.1\n" } as const };
        expect(await engineVersion("codex", { exec: fakeExec(answers) })).toBe("codex-cli 0.5.1");
    });

    it("asks `claude` for the claude-code engine", async () => {
        const calls: string[][] = [];
        const answers = { claude: { ok: true, stdout: "2.1.0 (Claude Code)\n" } as const };
        const version = await engineVersion("claude-code", { exec: fakeExec(answers, calls) });
        expect(version).toBe("2.1.0 (Claude Code)");
        expect(calls).toEqual([["claude", "--version"]]);
    });

    it("falls back to unknown on a failure or an empty answer", async () => {
        expect(await engineVersion("codex", { exec: fakeExec({}) })).toBe("unknown");
        const blank = { codex: { ok: true, stdout: "  \n" } as const };
        expect(await engineVersion("codex", { exec: fakeExec(blank) })).toBe("unknown");
    });
});
