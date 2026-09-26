// The watchdog in execCommand, with execFile replaced so a child's exit can be
// withheld on purpose: the failure Bun produced in the --apply run (a child
// whose exit is never reported) cannot be triggered on demand with a real
// process. Kept apart from exec.test.ts, whose tests need the real execFile.

import { EventEmitter } from "node:events";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { execCommand, WATCHDOG_GRACE_MS } from "./exec.ts";

type Callback = (error: Error | null, stdout: string, stderr: string) => void;

const execFileMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile: execFileMock }));

function fakeChild() {
    return Object.assign(new EventEmitter(), { stdin: null, kill: vi.fn(() => true) });
}

describe("execCommand watchdog", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        execFileMock.mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("settles as a timeout and kills the child when its exit is never reported", async () => {
        const child = fakeChild();
        execFileMock.mockReturnValue(child); // never calls back, like the lost exit
        let settled = false;
        const exec = execCommand("bd", 1_000);
        const pending = exec(["show", "x"]).finally(() => {
            settled = true;
        });

        await vi.advanceTimersByTimeAsync(1_000 + WATCHDOG_GRACE_MS - 1);
        expect(settled).toBe(false);

        await vi.advanceTimersByTimeAsync(1);
        await expect(pending).resolves.toEqual({
            ok: false,
            error: "bd timed out after 1 s (exit never reported)",
        });
        expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    });

    it("keeps the execFile result and leaves no timer behind when the exit is reported", async () => {
        const child = fakeChild();
        execFileMock.mockImplementation(
            (_file: string, _args: string[], _options: unknown, callback: Callback) => {
                queueMicrotask(() => callback(null, "{}", ""));
                return child;
            },
        );

        await expect(execCommand("bd", 1_000)(["show", "x"])).resolves.toEqual({
            ok: true,
            stdout: "{}",
        });
        expect(vi.getTimerCount()).toBe(0);
        expect(child.kill).not.toHaveBeenCalled();
    });

    it("ignores a callback that arrives after the watchdog settled the call", async () => {
        let late: Callback | undefined;
        execFileMock.mockImplementation(
            (_file: string, _args: string[], _options: unknown, callback: Callback) => {
                late = callback;
                return fakeChild();
            },
        );
        const pending = execCommand("bd", 1_000)(["show", "x"]);

        await vi.advanceTimersByTimeAsync(1_000 + WATCHDOG_GRACE_MS);
        late?.(null, "{}", "");

        await expect(pending).resolves.toMatchObject({ ok: false });
    });
});
