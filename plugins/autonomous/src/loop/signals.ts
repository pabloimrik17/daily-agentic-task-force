// The real wait and stop request of the loop (design D5); tests inject their own.

import { setTimeout as delay } from "node:timers/promises";

// Resolves after `ms`, or at once when `stop` is aborted.
export type Wait = (ms: number, stop?: AbortSignal) => Promise<void>;

// The longest delay a timer takes; Bun turns a longer one into 1 ms.
const MAX_TIMER_MS = 2_147_483_647;

type Delay = (ms: number, value: undefined, options: { signal?: AbortSignal }) => Promise<unknown>;

async function delayAll(delayOnce: Delay, ms: number, stop?: AbortSignal): Promise<void> {
    for (let left = ms; left > 0; left -= MAX_TIMER_MS) {
        await delayOnce(Math.min(left, MAX_TIMER_MS), undefined, { signal: stop });
    }
}

// A wait longer than one timer takes is made of several, so no interval is too long.
export const sleepWith =
    (delayOnce: Delay): Wait =>
    (ms, stop) =>
        delayAll(delayOnce, ms, stop).catch((error: unknown) => {
            if (!(stop?.aborted ?? false)) {
                throw error;
            }
        });

export const sleep: Wait = sleepWith(delay);

interface SignalTarget {
    once(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}

// Aborted, with the signal as its reason, by the first SIGINT or SIGTERM. The same
// signal again finds no listener and ends the process as usual.
export function stopOnSignals(target: SignalTarget = process): AbortSignal {
    const controller = new AbortController();
    for (const name of ["SIGINT", "SIGTERM"] as const) {
        target.once(name, () => controller.abort(`received ${name}`));
    }
    return controller.signal;
}
