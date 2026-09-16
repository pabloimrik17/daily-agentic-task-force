import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { validateMarketplace } from "./validate-marketplace.ts";

let root: string;

function write(relativePath: string, contents: string): void {
    const absolute = join(root, relativePath);
    mkdirSync(join(absolute, ".."), { recursive: true });
    writeFileSync(absolute, contents, "utf8");
}

function writeJson(relativePath: string, value: unknown): void {
    write(relativePath, JSON.stringify(value, null, 4));
}

function marketplace(plugins: unknown[]): unknown {
    return {
        name: "daily-agentic-task-force",
        owner: { name: "Owner", email: "owner@example.invalid" },
        metadata: { description: "test marketplace", pluginRoot: "./plugins" },
        plugins,
    };
}

function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        name: "datf-lab",
        source: "./plugins/datf-lab",
        version: "0.1.0",
        description: "staging area",
        ...overrides,
    };
}

/** Writes a complete, internally consistent plugin at `plugins/<name>`. */
function writePlugin(name: string, versions: { plugin?: string; package?: string } = {}): void {
    writeJson(`plugins/${name}/.claude-plugin/plugin.json`, {
        name,
        version: versions.plugin ?? "0.1.0",
        description: "staging area",
    });
    writeJson(`plugins/${name}/package.json`, {
        name: `@daily-agentic-task-force/plugin-${name}`,
        version: versions.package ?? "0.1.0",
        private: true,
    });
}

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "datf-marketplace-"));
    mkdirSync(join(root, "plugins"), { recursive: true });
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
});

describe("validateMarketplace", () => {
    it("succeeds when every version agrees across all three manifests", () => {
        writeJson(".claude-plugin/marketplace.json", marketplace([entry()]));
        writePlugin("datf-lab");

        expect(validateMarketplace(root)).toEqual([]);
    });

    it("fails when the marketplace manifest is missing", () => {
        const problems = validateMarketplace(root);

        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(/marketplace manifest is missing/i);
    });

    it("fails when the marketplace manifest is not parseable", () => {
        write(".claude-plugin/marketplace.json", "{ not json");

        const problems = validateMarketplace(root);

        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(/not valid JSON/i);
    });

    it("fails when a listed plugin's source does not resolve", () => {
        writeJson(
            ".claude-plugin/marketplace.json",
            marketplace([entry({ source: "./plugins/missing" })]),
        );

        const problems = validateMarketplace(root);

        expect(problems.some((p) => /"datf-lab".*does not resolve to a directory/.test(p))).toBe(
            true,
        );
    });

    it("fails when a listed plugin has no plugin manifest", () => {
        writeJson(".claude-plugin/marketplace.json", marketplace([entry()]));
        mkdirSync(join(root, "plugins/datf-lab"), { recursive: true });

        const problems = validateMarketplace(root);

        expect(problems.some((p) => /has no plugin manifest/.test(p))).toBe(true);
    });

    it("fails when a plugin manifest is not parseable", () => {
        writeJson(".claude-plugin/marketplace.json", marketplace([entry()]));
        writePlugin("datf-lab");
        write("plugins/datf-lab/.claude-plugin/plugin.json", "{ not json");

        const problems = validateMarketplace(root);

        expect(problems.some((p) => /plugin\.json is not valid JSON/.test(p))).toBe(true);
    });

    it("fails when a plugin manifest omits its name", () => {
        writeJson(".claude-plugin/marketplace.json", marketplace([entry()]));
        writePlugin("datf-lab");
        writeJson("plugins/datf-lab/.claude-plugin/plugin.json", { version: "0.1.0" });

        const problems = validateMarketplace(root);

        expect(problems.some((p) => /has no "name"/.test(p))).toBe(true);
    });

    it("fails when a plugin manifest omits its version", () => {
        writeJson(".claude-plugin/marketplace.json", marketplace([entry()]));
        writePlugin("datf-lab");
        writeJson("plugins/datf-lab/.claude-plugin/plugin.json", { name: "datf-lab" });

        const problems = validateMarketplace(root);

        expect(problems.some((p) => /plugin\.json has no "version"/.test(p))).toBe(true);
    });

    it("fails when the manifest name disagrees with the listed name", () => {
        writeJson(".claude-plugin/marketplace.json", marketplace([entry()]));
        writePlugin("datf-lab");
        writeJson("plugins/datf-lab/.claude-plugin/plugin.json", {
            name: "experiments",
            version: "0.1.0",
        });

        const problems = validateMarketplace(root);

        expect(
            problems.some((p) =>
                /listed as "datf-lab" but its manifest declares "experiments"/.test(p),
            ),
        ).toBe(true);
    });

    it("fails when the three recorded versions disagree, naming the plugin and every value", () => {
        writeJson(".claude-plugin/marketplace.json", marketplace([entry({ version: "0.1.0" })]));
        writePlugin("datf-lab", { plugin: "0.2.0", package: "0.3.0" });

        const problems = validateMarketplace(root);
        const disagreement = problems.find((p) => /disagreeing versions/.test(p));

        expect(disagreement).toBeDefined();
        expect(disagreement).toContain("datf-lab");
        expect(disagreement).toContain("0.1.0");
        expect(disagreement).toContain("0.2.0");
        expect(disagreement).toContain("0.3.0");
    });

    it("fails when a plugin directory exists on disk but is unlisted", () => {
        writeJson(".claude-plugin/marketplace.json", marketplace([entry()]));
        writePlugin("datf-lab");
        writePlugin("datf-orphan");

        const problems = validateMarketplace(root);

        expect(
            problems.some((p) => /datf-orphan.*no entry in the marketplace manifest/.test(p)),
        ).toBe(true);
    });

    it("ignores directories under the plugin root that carry no plugin manifest", () => {
        writeJson(".claude-plugin/marketplace.json", marketplace([entry()]));
        writePlugin("datf-lab");
        mkdirSync(join(root, "plugins/scratch"), { recursive: true });

        expect(validateMarketplace(root)).toEqual([]);
    });

    it("reports every problem in a single run", () => {
        writeJson(
            ".claude-plugin/marketplace.json",
            marketplace([
                entry({ version: "0.1.0" }),
                entry({ name: "datf-broken", source: "./plugins/datf-broken" }),
            ]),
        );
        writePlugin("datf-lab", { plugin: "9.9.9" });
        writePlugin("datf-orphan");

        const problems = validateMarketplace(root);

        expect(problems.some((p) => /disagreeing versions/.test(p))).toBe(true);
        expect(problems.some((p) => /datf-broken.*does not resolve/.test(p))).toBe(true);
        expect(problems.some((p) => /datf-orphan.*no entry/.test(p))).toBe(true);
        expect(problems.length).toBeGreaterThanOrEqual(3);
    });
});
