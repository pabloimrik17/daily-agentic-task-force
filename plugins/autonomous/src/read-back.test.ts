import { afterEach, describe, expect, it, vi } from "vitest";

import { READ_BACK_DELAYS_MS, READ_BACK_TRIES, readUntil } from "./read-back.ts";

type Read = { ok: true; value: number } | { ok: false; error: string };

function reads(...results: Read[]): () => Promise<Read> {
    const queue = [...results];
    return () => Promise.resolve(queue.length > 1 ? (queue.shift() as Read) : (queue[0] as Read));
}

const value = (n: number): Read => ({ ok: true, value: n });
const atLeast = (n: number) => (v: number) => v >= n;

describe("readUntil", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("returns the first read when it already settles, without waiting", async () => {
        const waits: number[] = [];
        const result = await readUntil(reads(value(2)), atLeast(2), (ms) => {
            waits.push(ms);
            return Promise.resolve();
        });
        expect(result).toEqual(value(2));
        expect(waits).toEqual([]);
    });

    it("reads again after each delay until a read settles", async () => {
        const waits: number[] = [];
        const result = await readUntil(reads(value(0), value(1), value(2)), atLeast(2), (ms) => {
            waits.push(ms);
            return Promise.resolve();
        });
        expect(result).toEqual(value(2));
        expect(waits).toEqual(READ_BACK_DELAYS_MS.slice(0, 2));
    });

    it("returns the last read when none settles, after every delay", async () => {
        const waits: number[] = [];
        let count = 0;
        const result = await readUntil(
            () => Promise.resolve(value(++count)),
            atLeast(100),
            (ms) => {
                waits.push(ms);
                return Promise.resolve();
            },
        );
        expect(waits).toEqual([...READ_BACK_DELAYS_MS]);
        expect(result).toEqual(value(READ_BACK_DELAYS_MS.length + 1));
    });

    it("returns a failed read at once", async () => {
        const waits: number[] = [];
        const failed: Read = { ok: false, error: "linear issue view: boom" };
        const result = await readUntil(reads(value(0), failed, value(5)), atLeast(5), (ms) => {
            waits.push(ms);
            return Promise.resolve();
        });
        expect(result).toEqual(failed);
        expect(waits).toEqual([READ_BACK_DELAYS_MS[0]]);
    });

    it("waits on the global timer by default", async () => {
        vi.useFakeTimers();
        const pending = readUntil(reads(value(0), value(1)), atLeast(1));
        await vi.advanceTimersByTimeAsync(READ_BACK_DELAYS_MS[0] ?? 0);
        await expect(pending).resolves.toEqual(value(1));
    });
});

describe("READ_BACK_TRIES", () => {
    it("names the reads and the time they span", () => {
        expect(READ_BACK_TRIES).toBe("read 6 times over 30 s");
    });
});
