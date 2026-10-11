import { describe, expect, it } from "vitest";

import type { Exec } from "../exec.ts";
import { readMachineScope } from "./machine-scope.ts";

// chezmoi data carries many keys besides machineType; the fake keeps a few of them.
const data = (fields: Record<string, unknown>): string =>
    JSON.stringify({ chezmoi: { os: "darwin" }, name: "Someone", ...fields });

const stdoutExec =
    (stdout: string, calls: string[][] = []): Exec =>
    (args) => {
        calls.push(args);
        return Promise.resolve({ ok: true, stdout });
    };

describe("readMachineScope", () => {
    it("reads personal through chezmoi data as JSON", async () => {
        const calls: string[][] = [];
        expect(
            await readMachineScope(stdoutExec(data({ machineType: "personal" }), calls)),
        ).toEqual({ ok: true, scope: "personal" });
        expect(calls).toEqual([["data", "--format", "json"]]);
    });

    it("reads work", async () => {
        expect(await readMachineScope(stdoutExec(data({ machineType: "work" })))).toEqual({
            ok: true,
            scope: "work",
        });
    });

    it("names chezmoi data and machineType when the value is missing", async () => {
        expect(await readMachineScope(stdoutExec(data({})))).toEqual({
            ok: false,
            error: "chezmoi data: output.machineType is missing",
        });
    });

    it("rejects another value", async () => {
        expect(await readMachineScope(stdoutExec(data({ machineType: "server" })))).toEqual({
            ok: false,
            error: 'chezmoi data: output.machineType "server" is not personal or work',
        });
    });

    it("rejects invalid JSON", async () => {
        const result = await readMachineScope(stdoutExec("not json"));
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error).toMatch(/^chezmoi data: output is not valid JSON: /);
    });

    it("passes a failing exec through under chezmoi data", async () => {
        const exec: Exec = () =>
            Promise.resolve({ ok: false, error: "chezmoi CLI not found on PATH" });
        expect(await readMachineScope(exec)).toEqual({
            ok: false,
            error: "chezmoi data: chezmoi CLI not found on PATH",
        });
    });
});
