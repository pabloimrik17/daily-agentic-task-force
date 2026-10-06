import { describe, expect, it } from "vitest";

import {
    buildArgs,
    buildRange,
    readSheetValues,
    type Runner,
    type RunnerResult,
} from "./sheet-gws.ts";

const location = { spreadsheetId: "sheet-id-123", tab: "Mi cartera" };

const KEYRING = "Using keyring backend: keyring\n";

const runnerOf =
    (result: Partial<RunnerResult>): Runner =>
    () =>
        Promise.resolve({ code: 0, stdout: "", stderr: KEYRING, ...result });

describe("buildRange", () => {
    it("wraps the tab in single quotes", () => {
        expect(buildRange("Mi cartera")).toBe("'Mi cartera'!A:E");
    });

    it("doubles apostrophes inside the tab name", () => {
        expect(buildRange("Pablo's tab")).toBe("'Pablo''s tab'!A:E");
    });
});

describe("buildArgs", () => {
    it("builds the exact command", () => {
        expect(buildArgs(location)).toMatchInlineSnapshot(`
          [
            "gws",
            "sheets",
            "spreadsheets",
            "values",
            "get",
            "--params",
            "{"spreadsheetId":"sheet-id-123","range":"'Mi cartera'!A:E","valueRenderOption":"UNFORMATTED_VALUE"}",
          ]
        `);
    });
});

describe("readSheetValues", () => {
    it("passes the argv to the runner", async () => {
        let seen: string[] = [];
        await readSheetValues(location, (argv) => {
            seen = argv;
            return Promise.resolve({ code: 0, stdout: '{"values":[]}', stderr: "" });
        });
        expect(seen).toEqual(buildArgs(location));
    });

    it("returns the values on success", async () => {
        const stdout = JSON.stringify({
            majorDimension: "ROWS",
            range: "'Mi cartera'!A1:E2",
            values: [["a"], ["b", 1]],
        });
        expect(await readSheetValues(location, runnerOf({ stdout }))).toEqual({
            ok: true,
            values: [["a"], ["b", 1]],
        });
    });

    it("reports a missing gws, naming it", async () => {
        const spawnError = Object.assign(new Error("spawn gws ENOENT"), { code: "ENOENT" });
        const result = await readSheetValues(location, runnerOf({ code: null, spawnError }));
        expect(result).toMatchObject({ ok: false, error: { kind: "gws-missing" } });
        expect(!result.ok && result.error.message).toContain("gws is not on PATH");
    });

    it.each([
        "error[auth]: no credentials",
        "HTTP 401 Unauthorized",
        "request had invalid token",
        "please login",
    ])("classifies %j as unauthorised", async (text) => {
        const result = await readSheetValues(
            location,
            runnerOf({ code: 1, stderr: KEYRING + text }),
        );
        expect(result).toMatchObject({ ok: false, error: { kind: "gws-unauthorised" } });
    });

    it("reports an unknown tab as a failure carrying the message", async () => {
        const stdout = "error[api]: Unable to parse range: 'Nope'!A:E";
        const result = await readSheetValues(location, runnerOf({ code: 1, stdout }));
        expect(result).toMatchObject({ ok: false, error: { kind: "gws-failed" } });
        expect(!result.ok && result.error.message).toContain("Unable to parse range: 'Nope'!A:E");
        expect(!result.ok && result.error.message).not.toContain("keyring");
    });

    it("reports a killed gws as a failure", async () => {
        const result = await readSheetValues(
            location,
            runnerOf({ code: null, stderr: "gws was stopped by SIGTERM" }),
        );
        expect(result).toMatchObject({ ok: false, error: { kind: "gws-failed" } });
    });

    it("reports non-JSON stdout as bad output", async () => {
        const result = await readSheetValues(location, runnerOf({ stdout: "not json" }));
        expect(result).toMatchObject({ ok: false, error: { kind: "gws-bad-output" } });
    });

    it("reports JSON without a values array as bad output", async () => {
        const result = await readSheetValues(location, runnerOf({ stdout: '{"values":"x"}' }));
        expect(result).toMatchObject({ ok: false, error: { kind: "gws-bad-output" } });
    });
});
