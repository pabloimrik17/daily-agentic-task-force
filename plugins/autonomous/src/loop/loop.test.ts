import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { tempState } from "../attempts/test-fixtures.ts";
import { gateOverLogins } from "../quota-gate/iteration-fixtures.ts";
import { quotaGateStep } from "../quota-gate/step.ts";
import { renderText, type RunReport } from "../report.ts";
import type { StepOutcome } from "../runner.ts";
import { type LoopIo, runLoop } from "./loop.ts";
import { attempt, DEAD, NOW, reconciled, report, selected, stuckTask } from "./test-fixtures.ts";
import type { FormatTime } from "./time.ts";

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

// The times read the same on every machine: UTC, hours and minutes.
const formatTime: FormatTime = (date) => date.toISOString().slice(11, 16);

// The summary line of an iteration that ended at 09:00 with the 10-minute interval, and the stop line.
const summary = (what = "⏸ nothing to launch") => `09:00 ${what} · next 09:10`;
const SELECT = "⏸ nothing to launch: select";
const stopLine = (reason = "received SIGTERM") => `09:00 ■ loop stopped: ${reason}`;

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
        formatTime,
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
        expect(notices(dir)).toEqual([summary(), stopLine()]);
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
        expect(notices(dir)).toEqual([summary(), stopLine("received SIGINT")]);
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
        expect(notices(dir)).toEqual([summary(), stopLine("runner error: boom")]);
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
        writeFileSync(join(dir, "loop.notices"), "09:00 ■ loop stopped: received SIGINT\n");
        await runLoop(harness(dir, outcomes("advance"), 1).io);
        expect(notices(dir)).toEqual([summary(), stopLine()]);
    });

    it("records the lines of each iteration, then the stop line", async () => {
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
            summary(),
            "  ⚠ retained linear:DOT-77:grill-me:1: session exited; stage grill-me check does not hold",
            summary(),
            "  ✔ linear:DOT-98 grill-me → proposal",
            summary(),
            stopLine(),
        ]);
    });

    it("records the summary line alone for an iteration with nothing else to tell", async () => {
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
        expect(notices(dir)).toEqual([summary(), summary(), stopLine()]);
    });
});

// Moves the clock by each wait, as the loop's own waits would.
function ticking(h: ReturnType<typeof harness>, clock: { now: Date }): void {
    const wait = h.io.wait;
    h.io.now = () => clock.now;
    h.io.wait = (ms, signal) => {
        clock.now = new Date(clock.now.getTime() + ms);
        return wait(ms, signal);
    };
}

describe("runLoop stop line", () => {
    it("carries the time of the stop and the symbol, for a stop request", async () => {
        const dir = state();
        const h = harness(dir, outcomes("advance"), 1);
        ticking(h, { now: NOW });
        await runLoop(h.io);
        expect(notices(dir)).toEqual([summary(), "09:10 ■ loop stopped: received SIGTERM"]);
    });

    it("carries the time of the failure, for a runner error", async () => {
        const dir = state();
        const h = harness(
            dir,
            (n) => (n === 2 ? Promise.reject(new Error("boom")) : outcomes("advance")(n)),
            9,
        );
        ticking(h, { now: NOW });
        expect(await runLoop(h.io)).toBe(1);
        expect(notices(dir)).toEqual([summary(), "09:10 ■ loop stopped: runner error: boom"]);
    });

    it("has no next time", async () => {
        const dir = state();
        await runLoop(harness(dir, outcomes("advance"), 1).io);
        expect(notices(dir).at(-1)).not.toContain("next");
    });
});

describe("runLoop lines of an iteration", () => {
    const REASON_LINE =
        "  ⚠ stuck beads:X-12: no repository label names a directory of the workspace";

    it("records the summary line and its detail lines together, in order", async () => {
        const dir = state();
        const finalised = attempt({
            state: "completed",
            action: "finalised",
            stageNow: "proposal",
        });
        const h = harness(
            dir,
            () =>
                Promise.resolve(
                    report("advance", [reconciled([finalised]), selected([stuckTask("X-12")])]),
                ),
            1,
        );
        let before = "";
        const wait = h.io.wait;
        h.io.wait = (ms, signal) => {
            before = read(dir, "loop.notices");
            return wait(ms, signal);
        };
        await runLoop(h.io);
        expect(before.split("\n").filter(Boolean)).toEqual([
            summary("⏸ nothing to launch: select · 1 need you"),
            "  ✔ linear:DOT-98 grill-me → proposal",
            REASON_LINE,
        ]);
    });

    it("tells nothing between iterations: one summary line each, the details, then the stop line", async () => {
        const dir = state();
        const clock = { now: NOW };
        const h = harness(dir, outcomes("wait", "advance", "not-evaluable", "wait"), 4);
        ticking(h, clock);
        await runLoop(h.io);
        expect(notices(dir)).toEqual([
            "09:00 ⏸ nothing to launch · next 09:10",
            "09:10 ⏸ nothing to launch · next 09:20",
            "09:20 ✖ not evaluable · next 09:30",
            "09:30 ⏸ nothing to launch · next 09:40",
            "09:40 ■ loop stopped: received SIGTERM",
        ]);
    });

    it("takes the next time from the end of the iteration plus a 5-minute interval", async () => {
        const dir = state();
        const h = harness(dir, outcomes("wait"), 2, { intervalMs: () => 300_000 });
        await runLoop(h.io);
        expect(h.waits).toEqual([300_000, 300_000]);
        expect(notices(dir)[0]).toBe("09:00 ⏸ nothing to launch · next 09:05");
    });

    it("reads the interval once an iteration: the next time is the interval it then waits", async () => {
        const dir = state();
        let reads = 0;
        const h = harness(dir, outcomes("wait"), 2, { intervalMs: () => ++reads * 60_000 });
        await runLoop(h.io);
        expect(h.waits).toEqual([60_000, 120_000]);
        expect(notices(dir).slice(0, 2)).toEqual([
            "09:00 ⏸ nothing to launch · next 09:01",
            "09:00 ⏸ nothing to launch · next 09:02",
        ]);
    });
});

describe("runLoop stuck notices", () => {
    const REASON = "no repository label names a directory of the workspace";
    const NEED_YOU = `${SELECT} · 1 need you`;
    const stuckReport = (...tasks: Parameters<typeof selected>[0]) =>
        Promise.resolve(report("wait", [selected(tasks)]));

    it("tells a stuck task once, not in the iterations after", async () => {
        const dir = state();
        await runLoop(harness(dir, () => stuckReport(stuckTask("X-12")), 3).io);
        expect(notices(dir)).toEqual([
            summary(NEED_YOU),
            `  ⚠ stuck beads:X-12: ${REASON}`,
            summary(NEED_YOU),
            summary(NEED_YOU),
            stopLine(),
        ]);
    });

    it("tells the task again when its reason changes", async () => {
        const dir = state();
        const later = stuckTask("X-12", {
            reason: "repository-prerequisites",
            detail: "no OpenSpec root",
        });
        const h = harness(
            dir,
            (n) => (n === 1 ? stuckReport(stuckTask("X-12")) : stuckReport(later)),
            3,
        );
        await runLoop(h.io);
        expect(notices(dir)).toEqual([
            summary(NEED_YOU),
            `  ⚠ stuck beads:X-12: ${REASON}`,
            summary(NEED_YOU),
            "  ⚠ stuck beads:X-12: no OpenSpec root",
            summary(NEED_YOU),
            stopLine(),
        ]);
    });

    it("names five of 56 and counts the rest, once", async () => {
        const dir = state();
        const tasks = Array.from({ length: 56 }, (_, n) => stuckTask(`X-${n}`));
        await runLoop(harness(dir, () => stuckReport(...tasks), 2).io);
        expect(notices(dir)).toEqual([
            summary(`${SELECT} · 56 need you`),
            ...[0, 1, 2, 3, 4].map((n) => `  ⚠ stuck beads:X-${n}: ${REASON}`),
            "  ⚠ stuck +51 more: see loop.log",
            summary(`${SELECT} · 56 need you`),
            stopLine(),
        ]);
    });

    it("records a task of another scope without a detail line or a count", async () => {
        const dir = state();
        await runLoop(harness(dir, () => stuckReport(stuckTask("W-1", { scope: "work" })), 2).io);
        expect(notices(dir)).toEqual([summary(SELECT), summary(SELECT), stopLine()]);
        expect(
            read(dir, "loop.stuck")
                .split("\n")
                .filter(Boolean)
                .map((line) => JSON.parse(line) as unknown),
        ).toEqual([{ task: "beads:W-1", exclusion: "repository", detail: REASON, scope: "work" }]);
    });

    it("remembers a task whose prerequisites could not be read, with no detail line", async () => {
        const dir = state();
        const unreadable = { source: "linear" as const, id: "DOT-1", reason: "cannot read" };
        const iteration = report("not-evaluable", [selected([], "personal", unreadable)]);
        await runLoop(harness(dir, () => Promise.resolve(iteration), 2).io);
        expect(notices(dir)).toEqual([summary(SELECT), summary(SELECT), stopLine()]);
        expect(read(dir, "loop.stuck").trim().split("\n")).toEqual([
            JSON.stringify({
                task: "linear:DOT-1",
                exclusion: "unreadable-once",
                detail: "cannot read",
            }),
        ]);
    });

    it("tells the task again in a new loop", async () => {
        const dir = state();
        await runLoop(harness(dir, () => stuckReport(stuckTask("X-12")), 1).io);
        await runLoop(harness(dir, () => stuckReport(stuckTask("X-12")), 1).io);
        expect(notices(dir)).toEqual([
            summary(NEED_YOU),
            `  ⚠ stuck beads:X-12: ${REASON}`,
            stopLine(),
        ]);
    });

    it("follows the other detail lines of the iteration", async () => {
        const dir = state();
        const finalised = attempt({
            state: "completed",
            action: "finalised",
            stageNow: "proposal",
        });
        const h = harness(
            dir,
            () =>
                Promise.resolve(
                    report("advance", [reconciled([finalised]), selected([stuckTask("X-12")])]),
                ),
            1,
        );
        await runLoop(h.io);
        expect(notices(dir).slice(1, 3)).toEqual([
            "  ✔ linear:DOT-98 grill-me → proposal",
            `  ⚠ stuck beads:X-12: ${REASON}`,
        ]);
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
