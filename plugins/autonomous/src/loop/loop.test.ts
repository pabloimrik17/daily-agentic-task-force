import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { tempState } from "../attempts/test-fixtures.ts";
import { gateOverLogins } from "../quota-gate/iteration-fixtures.ts";
import { quotaGateStep } from "../quota-gate/step.ts";
import { renderText, type RunReport } from "../report.ts";
import type { StepOutcome } from "../runner.ts";
import { type LoopIo, runLoop } from "./loop.ts";
import { attempt, DEAD, NOW, reconciled, report } from "./test-fixtures.ts";

const STATES: string[] = [];
afterAll(() => {
    for (const dir of STATES) {
        rmSync(dir, { recursive: true, force: true });
    }
});

function state(): string {
    const dir = tempState();
    STATES.push(dir);
    return dir;
}

const INTERVAL_MS = 600_000;

// Each iteration starts a minute after the one before; the loop stops in the wait
// after `iterations` iterations, unless `iterate` stops or throws first.
function harness(
    dir: string,
    iterate: (n: number, stop: AbortController) => Promise<RunReport>,
    iterations: number,
    overrides: Partial<LoopIo> = {},
) {
    const controller = new AbortController();
    const waits: number[] = [];
    const err: string[] = [];
    let count = 0;
    const io: LoopIo = {
        state: dir,
        json: false,
        now: () => NOW,
        wait: (ms, stop) => {
            waits.push(ms);
            if (stop !== controller.signal) {
                return Promise.reject(new Error("the wait is not given the stop signal"));
            }
            if (waits.length >= iterations) {
                controller.abort("received SIGTERM");
            }
            return Promise.resolve();
        },
        stopSignal: () => controller.signal,
        iterate: () => iterate(++count, controller),
        render: (done) => `autonomous run — started ${done.startedAt}\noutcome: ${done.outcome}`,
        intervalMs: () => INTERVAL_MS,
        stderr: (text) => err.push(text),
        ...overrides,
    };
    return { io, waits, err, iterations: () => count };
}

const at = (n: number) => new Date(NOW.getTime() + (n - 1) * 60_000);

const outcomes =
    (...each: StepOutcome[]) =>
    (n: number) =>
        Promise.resolve(report(each[(n - 1) % each.length] ?? "advance", [], at(n)));

const read = (dir: string, name: string) => readFileSync(join(dir, name), "utf8");
const notices = (dir: string) => read(dir, "loop.notices").split("\n").filter(Boolean);

describe("runLoop", () => {
    it("goes on through advance, wait and not-evaluable, the interval apart", async () => {
        const dir = state();
        const h = harness(dir, outcomes("advance", "wait", "not-evaluable"), 3);
        expect(await runLoop(h.io)).toBe(0);
        expect(h.iterations()).toBe(3);
        expect(h.waits).toEqual([INTERVAL_MS, INTERVAL_MS, INTERVAL_MS]);
    });

    it("ends the wait on a stop request, writes the stop notice and releases its lock", async () => {
        const dir = state();
        const h = harness(dir, outcomes("advance"), 1);
        expect(await runLoop(h.io)).toBe(0);
        expect(h.iterations()).toBe(1);
        expect(notices(dir)).toEqual(["loop stopped: received SIGTERM"]);
        expect(existsSync(join(dir, "loop.lock"))).toBe(false);
    });

    it("finishes an iteration during which a stop is asked, then stops without waiting", async () => {
        const dir = state();
        const h = harness(
            dir,
            (n, stop) => {
                stop.abort("received SIGINT");
                return outcomes("advance")(n);
            },
            9,
        );
        expect(await runLoop(h.io)).toBe(0);
        expect(h.iterations()).toBe(1);
        expect(h.waits).toEqual([]);
        expect(read(dir, "loop.log")).toContain("outcome: advance");
        expect(notices(dir)).toEqual(["loop stopped: received SIGINT"]);
    });

    it("stops with code 1 on a thrown error, after the stop notice", async () => {
        const dir = state();
        const h = harness(
            dir,
            (n) => (n === 2 ? Promise.reject(new Error("boom")) : outcomes("advance")(n)),
            9,
        );
        expect(await runLoop(h.io)).toBe(1);
        expect(h.iterations()).toBe(2);
        expect(h.err).toEqual(["autonomous loop failed: boom"]);
        expect(notices(dir)).toEqual(["loop stopped: runner error: boom"]);
        expect(existsSync(join(dir, "loop.lock"))).toBe(false);
    });

    it("refuses to start while another loop is alive, naming it, with code 3", async () => {
        const dir = state();
        const startedAt = "2026-11-14T08:00:00.000Z";
        writeFileSync(join(dir, "loop.lock"), JSON.stringify({ pid: process.pid, startedAt }));
        writeFileSync(join(dir, "loop.log"), "the other loop's log\n");
        writeFileSync(join(dir, "loop.notices"), "the other loop's notice\n");
        const h = harness(dir, outcomes("advance"), 1);
        expect(await runLoop(h.io)).toBe(3);
        expect(h.iterations()).toBe(0);
        expect(h.err).toEqual([
            `another loop holds ${join(dir, "loop.lock")} (pid ${process.pid}, started ${startedAt})`,
        ]);
        expect(read(dir, "loop.log")).toBe("the other loop's log\n");
        expect(read(dir, "loop.notices")).toBe("the other loop's notice\n");
        expect(existsSync(join(dir, "loop.log.1"))).toBe(false);
        expect(existsSync(join(dir, "loop.lock"))).toBe(true);
    });

    it("reclaims the lock of a loop that died, and starts", async () => {
        const dir = state();
        const startedAt = "2026-11-14T08:00:00.000Z";
        writeFileSync(join(dir, "loop.lock"), JSON.stringify({ pid: DEAD, startedAt }));
        const h = harness(dir, outcomes("advance"), 1);
        expect(await runLoop(h.io)).toBe(0);
        expect(h.iterations()).toBe(1);
    });

    it("holds the loop lock with its own pid while it runs", async () => {
        const dir = state();
        let owner: unknown = null;
        const h = harness(
            dir,
            (n) => {
                owner = JSON.parse(read(dir, "loop.lock"));
                return outcomes("advance")(n);
            },
            1,
        );
        await runLoop(h.io);
        expect(owner).toEqual({ pid: process.pid, startedAt: NOW.toISOString() });
    });
});

describe("runLoop log", () => {
    it("appends one text entry per iteration, with its start time", async () => {
        const dir = state();
        const h = harness(dir, outcomes("wait", "advance"), 2);
        await runLoop(h.io);
        expect(read(dir, "loop.log")).toBe(
            [
                `autonomous run — started ${at(1).toISOString()}\noutcome: wait\n`,
                `autonomous run — started ${at(2).toISOString()}\noutcome: advance\n`,
                "",
            ].join("\n"),
        );
    });

    it("appends one JSON line per iteration with --json", async () => {
        const dir = state();
        const h = harness(dir, outcomes("wait", "advance"), 2, { json: true });
        await runLoop(h.io);
        const lines = read(dir, "loop.log").split("\n").filter(Boolean);
        expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([
            report("wait", [], at(1)),
            report("advance", [], at(2)),
        ]);
    });

    it("renames the previous loop's log to loop.log.1", async () => {
        const dir = state();
        await runLoop(harness(dir, outcomes("wait"), 1).io);
        const first = read(dir, "loop.log");
        await runLoop(harness(dir, outcomes("advance"), 1).io);
        expect(read(dir, "loop.log.1")).toBe(first);
        expect(read(dir, "loop.log")).toContain("outcome: advance");
        expect(read(dir, "loop.log")).not.toContain("outcome: wait");
    });
});

describe("runLoop notices", () => {
    it("empties the previous loop's notices when it starts", async () => {
        const dir = state();
        writeFileSync(join(dir, "loop.notices"), "loop stopped: received SIGINT\n");
        await runLoop(harness(dir, outcomes("advance"), 1).io);
        expect(notices(dir)).toEqual(["loop stopped: received SIGTERM"]);
    });

    it("records the notices of each iteration, then the stop notice", async () => {
        const dir = state();
        const finalised = attempt({
            state: "completed",
            action: "finalised",
            stageNow: "proposal",
        });
        const retained = attempt({
            id: "linear:DOT-77:grill-me:1",
            state: "retained",
            action: "retained",
            detail: "session exited; stage grill-me check does not hold",
        });
        const still = { ...retained, before: "retained" as const, action: "none" as const };
        const byIteration = [[retained], [still, finalised], [still]];
        const h = harness(
            dir,
            (n) => Promise.resolve(report("advance", [reconciled(byIteration[n - 1] ?? [])])),
            3,
        );
        await runLoop(h.io);
        expect(notices(dir)).toEqual([
            "retained linear:DOT-77:grill-me:1: session exited; stage grill-me check does not hold",
            "linear:DOT-98 grill-me → proposal",
            "loop stopped: received SIGTERM",
        ]);
    });

    it("records nothing for an iteration with nothing to tell", async () => {
        const dir = state();
        const waiting = attempt({
            session: { state: "open", status: "waiting", busy: false, needsHuman: true },
        });
        const h = harness(
            dir,
            () => Promise.resolve(report("advance", [reconciled([waiting])])),
            2,
        );
        await runLoop(h.io);
        expect(notices(dir)).toEqual(["loop stopped: received SIGTERM"]);
    });
});

describe("runLoop and the active account", () => {
    it("evaluates, in each iteration, the account Claude Code is logged in as then", async () => {
        const dir = state();
        // The login is switched from ana to luis between the two iterations.
        const gate = gateOverLogins("ana@example.com", "luis@example.com");
        const h = harness(
            dir,
            async (n) => {
                const result = await gate.run();
                return report(result.outcome, [result], at(n));
            },
            2,
            { render: (done) => renderText(done, [quotaGateStep]) },
        );
        expect(await runLoop(h.io)).toBe(0);
        expect(gate.login.calls).toHaveLength(2);
        const accounts = read(dir, "loop.log")
            .split("\n")
            .filter((line) => line.startsWith("  account "));
        expect(accounts).toEqual([
            "  account   ana@example.com — claude@1a2b3c4d · Claude · ana@example.com · Pro",
            "  account   luis@example.com — claude@9f8e7d6c · Claude · luis@example.com · Pro",
        ]);
    });
});
