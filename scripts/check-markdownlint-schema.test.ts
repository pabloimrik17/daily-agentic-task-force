import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = join(import.meta.dirname, "check-markdownlint-schema.cjs");

let root: string;

function writeJson(path: string, value: unknown): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(value), "utf8");
}

function installEngine(directory: string, version: string): void {
    writeJson(join(directory, "package.json"), {
        name: "markdownlint",
        version,
        main: "index.js",
    });
    writeFileSync(join(directory, "index.js"), "", "utf8");
}

function schemaUrl(version: string): string {
    return `https://raw.githubusercontent.com/DavidAnson/markdownlint/v${version}/schema/markdownlint-config-schema.json`;
}

function fixture(options: { schema: string | null; root: string; cli: string }): void {
    writeJson(join(root, "package.json"), { name: "fixture" });
    writeFileSync(
        join(root, ".markdownlint.jsonc"),
        options.schema === null ? "{}" : `{ "$schema": "${schemaUrl(options.schema)}" }`,
        "utf8",
    );
    installEngine(join(root, "node_modules/markdownlint"), options.root);
    writeJson(join(root, "node_modules/markdownlint-cli/package.json"), {
        name: "markdownlint-cli",
        version: "0.0.0",
    });
    installEngine(
        join(root, "node_modules/markdownlint-cli/node_modules/markdownlint"),
        options.cli,
    );
}

function run(): { status: number | null; output: string } {
    const result = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
    return { status: result.status, output: result.stdout + result.stderr };
}

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "datf-md-schema-"));
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
});

describe("check-markdownlint-schema", () => {
    it("passes when the schema, root engine and CLI engine agree", () => {
        fixture({ schema: "0.42.1", root: "0.42.1", cli: "0.42.1" });
        const { status, output } = run();
        expect(status).toBe(0);
        expect(output).toContain("agree: 0.42.1");
    });

    it("fails when the CLI engine differs from the schema version", () => {
        fixture({ schema: "0.42.1", root: "0.42.1", cli: "0.41.1" });
        const { status, output } = run();
        expect(status).not.toBe(0);
        expect(output).toContain("CLI engine differs from schema version");
    });

    it("fails when the root engine differs from the schema version", () => {
        fixture({ schema: "0.42.1", root: "0.41.1", cli: "0.42.1" });
        const { status, output } = run();
        expect(status).not.toBe(0);
        expect(output).toContain("Root engine differs from schema version");
    });

    it("fails when the config has no versioned schema URL", () => {
        fixture({ schema: null, root: "0.42.1", cli: "0.42.1" });
        const { status, output } = run();
        expect(status).not.toBe(0);
        expect(output).toContain("Expected a versioned markdownlint schema URL");
    });
});
