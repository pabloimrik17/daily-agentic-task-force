// Task 2.4 of add-loop-stop: --stop-loop against a real loop process. The child holds
// the loop lock and stops on signals as the loop does; --stop-loop runs as a real
// subprocess, so the real SIGTERM goes through the real lock.

import { type ChildProcess, execFile, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const RUN = join(import.meta.dirname, "..", "run.ts");

// The loop's end, run by `bun -e` so no fixture file is left unreferenced: it takes the
// loop lock, stops on signals and writes the stop notice the way runLoop does, then
// releases the lock. It prints `ready` once the lock is held and the handlers are set.
const LOOP = `
import { acquireLoopLock } from ${JSON.stringify(join(import.meta.dirname, "..", "attempts", "lock.ts"))};
import { appendNotices, startFiles } from ${JSON.stringify(join(import.meta.dirname, "files.ts"))};
import { stopNotice } from ${JSON.stringify(join(import.meta.dirname, "notices.ts"))};
import { sleep, stopOnSignals } from ${JSON.stringify(join(import.meta.dirname, "signals.ts"))};

const state = process.env.AUTONOMOUS_STATE;
const lock = await acquireLoopLock(state, process.pid, new Date());
if (!lock.ok) {
    throw new Error(lock.error);
}
const stop = stopOnSignals();
await startFiles(state);
process.stdout.write("ready\\n");
await sleep(60_000, stop);
await appendNotices(state, [stopNotice("10:30", String(stop.reason))]);
await lock.release();
`;

const dirs: string[] = [];
const children: ChildProcess[] = [];

afterEach(() => {
    for (const child of children.splice(0)) {
        child.kill("SIGKILL");
    }
    for (const dir of dirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

// Resolves when the child has taken the lock and installed its signal handlers.
function startLoop(env: NodeJS.ProcessEnv): Promise<void> {
    const child = spawn("bun", ["-e", LOOP], { env, stdio: ["ignore", "pipe", "inherit"] });
    children.push(child);
    return new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code) => reject(new Error(`the loop fixture exited with ${code}`)));
        child.stdout?.on("data", (chunk: Buffer) => {
            if (chunk.toString().includes("ready")) {
                resolve();
            }
        });
    });
}

describe("--stop-loop against a real loop process", () => {
    it("stops the loop, which writes its notice and releases the lock", async () => {
        const state = mkdtempSync(join(tmpdir(), "autonomous-stop-process-"));
        dirs.push(state);
        const env = { ...process.env, AUTONOMOUS_STATE: state };

        await startLoop(env);
        expect(existsSync(join(state, "loop.lock"))).toBe(true);

        const { stdout } = await execFileAsync("bun", [RUN, "--stop-loop"], { env });

        expect(stdout).toBe("loop stopped\n");
        expect(readFileSync(join(state, "loop.notices"), "utf8")).toMatch(
            /10:30 ■ loop stopped: received SIGTERM\n$/,
        );
        expect(existsSync(join(state, "loop.lock"))).toBe(false);
    }, 30_000);
});
