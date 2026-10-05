// Runs the mod's tests under `claude plugin test` (design D17). The runner
// takes a plugin root and runs every `*.test.ts` beneath it, so pointed at
// this plugin it would also load the Vitest suites, which cannot import
// `vitest` there. This builds a scratch plugin root holding the manifest and
// the mod alone, runs the tests in it, and removes it.

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const plugin = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = mkdtempSync(join(tmpdir(), "stonks-mod-"));
try {
    mkdirSync(join(root, ".claude-plugin"));
    mkdirSync(join(root, "hooks"));
    cpSync(
        join(plugin, ".claude-plugin", "plugin.json"),
        join(root, ".claude-plugin", "plugin.json"),
    );
    // Only the module: the command hook of the real hooks.json points at src/, absent here.
    writeFileSync(
        join(root, "hooks", "hooks.json"),
        `${JSON.stringify({ modules: ["../mod/register.ts"] })}\n`,
    );
    cpSync(join(plugin, "mod"), join(root, "mod"), { recursive: true });
    const result = spawnSync("claude", ["plugin", "test", root], { stdio: "inherit" });
    process.exitCode = result.status ?? 1;
} finally {
    rmSync(root, { recursive: true, force: true });
}
