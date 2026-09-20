/**
 * Checks the marketplace manifest against the plugins on disk: names match,
 * nothing is unlisted, and all three version anchors agree.
 *
 * Release-please writes those three files through independent `extra-files`
 * rules, and a JSONPath that stops matching after a rename fails silently.
 * Problems are accumulated so one CI run shows all of them.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MARKETPLACE_MANIFEST = join(".claude-plugin", "marketplace.json");
const PLUGIN_MANIFEST = join(".claude-plugin", "plugin.json");
const PACKAGE_MANIFEST = "package.json";
const DEFAULT_PLUGIN_ROOT = "./plugins";

type JsonRecord = Record<string, unknown>;

type ReadResult = { ok: true; value: JsonRecord } | { ok: false; error: string };

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function readJsonObject(absolutePath: string): ReadResult {
    let raw: string;
    try {
        raw = readFileSync(absolutePath, "utf8");
    } catch {
        return { ok: false, error: "could not be read" };
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return { ok: false, error: `is not valid JSON (${detail})` };
    }

    if (!isRecord(parsed)) {
        return { ok: false, error: "does not contain a JSON object" };
    }

    return { ok: true, value: parsed };
}

function isDirectory(absolutePath: string): boolean {
    try {
        return statSync(absolutePath).isDirectory();
    } catch {
        return false;
    }
}

function displayPath(repoRoot: string, absolutePath: string): string {
    const rel = relative(repoRoot, absolutePath);
    return rel === "" || rel.startsWith("..") || isAbsolute(rel) ? absolutePath : rel;
}

/**
 * Checks the marketplace manifest and every plugin it publishes.
 *
 * @returns every problem found, in the order they were discovered. An empty
 *   array means the marketplace is consistent.
 */
export function validateMarketplace(repoRoot: string): string[] {
    const problems: string[] = [];
    const root = resolve(repoRoot);
    const marketplacePath = join(root, MARKETPLACE_MANIFEST);

    if (!existsSync(marketplacePath)) {
        problems.push(`Marketplace manifest is missing: expected ${MARKETPLACE_MANIFEST}`);
        return problems;
    }

    const marketplace = readJsonObject(marketplacePath);
    if (!marketplace.ok) {
        problems.push(`Marketplace manifest ${MARKETPLACE_MANIFEST} ${marketplace.error}`);
        return problems;
    }

    const metadata = isRecord(marketplace.value["metadata"])
        ? marketplace.value["metadata"]
        : undefined;
    const pluginRoot = nonEmptyString(metadata?.["pluginRoot"]) ?? DEFAULT_PLUGIN_ROOT;
    const pluginRootPath = join(root, pluginRoot);

    const entries = marketplace.value["plugins"];
    const listedSources = new Set<string>();

    if (!Array.isArray(entries)) {
        problems.push(`Marketplace manifest ${MARKETPLACE_MANIFEST} has no "plugins" array`);
    } else {
        for (const [index, entry] of entries.entries()) {
            checkEntry({ root, entry, index, problems, listedSources });
        }
    }

    checkForUnlistedPlugins({ root, pluginRoot, pluginRootPath, problems, listedSources });

    return problems;
}

function checkEntry(args: {
    root: string;
    entry: unknown;
    index: number;
    problems: string[];
    listedSources: Set<string>;
}): void {
    const { root, entry, index, problems, listedSources } = args;
    const position = `Marketplace entry #${index + 1}`;

    if (!isRecord(entry)) {
        problems.push(`${position} is not a JSON object`);
        return;
    }

    const { label, listedName, listedVersion, source } = readEntryFields(entry, position, problems);
    if (source === undefined) {
        return;
    }

    const pluginDir = resolve(root, source);
    listedSources.add(pluginDir);

    if (!isDirectory(pluginDir)) {
        problems.push(`${label} source "${source}" does not resolve to a directory`);
        return;
    }

    const manifestVersion = checkPluginManifest({
        root,
        pluginDir,
        source,
        label,
        listedName,
        problems,
    });
    const packageVersion = readPackageVersion({ root, pluginDir, label, problems });

    checkVersionAgreement({ label, problems, listedVersion, manifestVersion, packageVersion });
}

type EntryFields = {
    label: string;
    listedName: string | undefined;
    listedVersion: string | undefined;
    source: string | undefined;
};

function readEntryFields(entry: JsonRecord, position: string, problems: string[]): EntryFields {
    const listedName = nonEmptyString(entry["name"]);
    const label = listedName === undefined ? position : `Plugin "${listedName}"`;

    if (listedName === undefined) {
        problems.push(`${position} has no "name"`);
    }

    const listedVersion = nonEmptyString(entry["version"]);
    if (listedVersion === undefined) {
        problems.push(`${label} has no "version" in the marketplace manifest`);
    }

    const source = nonEmptyString(entry["source"]);
    if (source === undefined) {
        problems.push(`${label} has no "source" in the marketplace manifest`);
    }

    return { label, listedName, listedVersion, source };
}

/** @returns the version the plugin manifest declares, if it could be read. */
function checkPluginManifest(args: {
    root: string;
    pluginDir: string;
    source: string;
    label: string;
    listedName: string | undefined;
    problems: string[];
}): string | undefined {
    const { root, pluginDir, source, label, listedName, problems } = args;
    const manifestPath = join(pluginDir, PLUGIN_MANIFEST);

    if (!existsSync(manifestPath)) {
        problems.push(
            `${label} source "${source}" has no plugin manifest at ${displayPath(root, manifestPath)}`,
        );
        return undefined;
    }

    const manifest = readJsonObject(manifestPath);
    if (!manifest.ok) {
        problems.push(`${label} manifest ${displayPath(root, manifestPath)} ${manifest.error}`);
        return undefined;
    }

    const manifestName = nonEmptyString(manifest.value["name"]);
    if (manifestName === undefined) {
        problems.push(`${label} manifest ${displayPath(root, manifestPath)} has no "name"`);
    } else if (listedName !== undefined && manifestName !== listedName) {
        problems.push(
            `${label} is listed as "${listedName}" but its manifest declares "${manifestName}"`,
        );
    }

    const manifestVersion = nonEmptyString(manifest.value["version"]);
    if (manifestVersion === undefined) {
        problems.push(`${label} manifest ${displayPath(root, manifestPath)} has no "version"`);
    }

    return manifestVersion;
}

function readPackageVersion(args: {
    root: string;
    pluginDir: string;
    label: string;
    problems: string[];
}): string | undefined {
    const { root, pluginDir, label, problems } = args;
    const packagePath = join(pluginDir, PACKAGE_MANIFEST);

    if (!existsSync(packagePath)) {
        problems.push(`${label} has no package manifest at ${displayPath(root, packagePath)}`);
        return undefined;
    }

    const packageManifest = readJsonObject(packagePath);
    if (!packageManifest.ok) {
        problems.push(
            `${label} package manifest ${displayPath(root, packagePath)} ${packageManifest.error}`,
        );
        return undefined;
    }

    const version = nonEmptyString(packageManifest.value["version"]);
    if (version === undefined) {
        problems.push(
            `${label} package manifest ${displayPath(root, packagePath)} has no "version"`,
        );
    }

    return version;
}

function checkVersionAgreement(args: {
    label: string;
    problems: string[];
    listedVersion: string | undefined;
    manifestVersion: string | undefined;
    packageVersion: string | undefined;
}): void {
    const { label, problems, listedVersion, manifestVersion, packageVersion } = args;

    const known = [
        { source: "marketplace.json", version: listedVersion },
        { source: PLUGIN_MANIFEST, version: manifestVersion },
        { source: PACKAGE_MANIFEST, version: packageVersion },
    ].filter(
        (candidate): candidate is { source: string; version: string } =>
            candidate.version !== undefined,
    );

    const distinct = new Set(known.map((candidate) => candidate.version));
    if (distinct.size <= 1) {
        return;
    }

    const detail = known.map((candidate) => `${candidate.source}=${candidate.version}`).join(", ");
    problems.push(`${label} has disagreeing versions: ${detail}`);
}

function checkForUnlistedPlugins(args: {
    root: string;
    pluginRoot: string;
    pluginRootPath: string;
    problems: string[];
    listedSources: Set<string>;
}): void {
    const { root, pluginRoot, pluginRootPath, problems, listedSources } = args;

    if (!isDirectory(pluginRootPath)) {
        problems.push(`Plugin root "${pluginRoot}" does not resolve to a directory`);
        return;
    }

    for (const dirent of readdirSync(pluginRootPath, { withFileTypes: true })) {
        if (!dirent.isDirectory()) {
            continue;
        }

        const candidate = join(pluginRootPath, dirent.name);
        if (listedSources.has(candidate) || !existsSync(join(candidate, PLUGIN_MANIFEST))) {
            continue;
        }

        problems.push(
            `Plugin directory ${displayPath(root, candidate)} has a plugin manifest but no entry in the marketplace manifest`,
        );
    }
}

function isRunDirectly(): boolean {
    const invoked = process.argv[1];
    return invoked !== undefined && resolve(invoked) === fileURLToPath(import.meta.url);
}

if (isRunDirectly()) {
    const problems = validateMarketplace(process.cwd());

    if (problems.length > 0) {
        for (const problem of problems) {
            console.error(`✖ ${problem}`);
        }
        console.error(
            `\n${problems.length} marketplace ${problems.length === 1 ? "problem" : "problems"} found.`,
        );
        process.exit(1);
    }

    console.log("✔ Marketplace is consistent.");
}
