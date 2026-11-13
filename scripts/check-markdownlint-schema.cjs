// Run from the repository root after its frozen dependency install.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { createRequire } = require("node:module");
const path = require("node:path");

const rootRequire = createRequire(path.resolve("package.json"));
const cliRequire = createRequire(rootRequire.resolve("markdownlint-cli/package.json"));
function engineVersion(resolveFrom) {
    let directory = path.dirname(resolveFrom.resolve("markdownlint"));
    for (;;) {
        try {
            const metadata = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));
            if (metadata.name === "markdownlint") return metadata.version;
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
        }
        const parent = path.dirname(directory);
        if (parent === directory) throw new Error("Cannot locate markdownlint package metadata");
        directory = parent;
    }
}
const content = readFileSync(".markdownlint.jsonc", "utf8");
const schemaVersion = content.match(
    /"\$schema"\s*:\s*"https:\/\/raw\.githubusercontent\.com\/DavidAnson\/markdownlint\/v(\d+\.\d+\.\d+)\/schema\/markdownlint-config-schema\.json"/,
)?.[1];
assert.ok(schemaVersion, "Expected a versioned markdownlint schema URL");
assert.equal(engineVersion(cliRequire), schemaVersion, "CLI engine differs from schema version");
assert.equal(engineVersion(rootRequire), schemaVersion, "Root engine differs from schema version");
console.log(`markdownlint engine and schema agree: ${schemaVersion}`);
