// The real wait and stop request of the loop (design D5); tests inject their own.

import { setTimeout as delay } from "node:timers/promises";

// Resolves after `ms`, or at once when `stop` is aborted.
export type Wait = (ms: number, stop?: AbortSignal) => Promise<void>;

export const sleep: Wait = (ms, stop) =>
    delay(ms, undefined, { signal: stop }).catch((error: unknown) => {
        if (!(stop?.aborted ?? false)) {
            throw error;
        }
    });

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
