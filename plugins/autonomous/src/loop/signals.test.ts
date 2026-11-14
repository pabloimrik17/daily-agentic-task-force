import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import { sleep, stopOnSignals } from "./signals.ts";

describe("sleep", () => {
    it("resolves at once when the stop is already asked", async () => {
        const controller = new AbortController();
        controller.abort("received SIGINT");
        const started = Date.now();
        await sleep(3_600_000, controller.signal);
        expect(Date.now() - started).toBeLessThan(1_000);
    });

    it("ends the wait when the stop is asked during it", async () => {
        const controller = new AbortController();
        const waiting = sleep(3_600_000, controller.signal);
        controller.abort("received SIGTERM");
        await expect(waiting).resolves.toBeUndefined();
    });

    it("resolves after the time without a stop signal", async () => {
        await expect(sleep(1)).resolves.toBeUndefined();
    });
});

describe("stopOnSignals", () => {
    it.each(["SIGINT", "SIGTERM"] as const)("is aborted by %s, with it as the reason", (name) => {
        const target = new EventEmitter();
        const stop = stopOnSignals(target);
        expect(stop.aborted).toBe(false);
        target.emit(name);
        expect(stop.aborted).toBe(true);
        expect(stop.reason).toBe(`received ${name}`);
    });

    it("listens once to each signal", () => {
        const target = new EventEmitter();
        stopOnSignals(target);
        target.emit("SIGINT");
        expect(target.listenerCount("SIGINT")).toBe(0);
        expect(target.listenerCount("SIGTERM")).toBe(1);
    });
});
