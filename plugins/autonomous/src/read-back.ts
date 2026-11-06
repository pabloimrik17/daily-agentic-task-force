// A read that follows a tracker write. Linear can serve a read that lags a committed write by
// seconds (DOT-121), so a read that does not show the write yet is repeated after each delay.
// Only a read that settles counts; a failed read is returned at once, and the last read when
// none settles.

export const READ_BACK_DELAYS_MS: readonly number[] = [1000, 2000, 4000, 8000, 15000];

// Appended to a read-back mismatch, so the report says the lag was waited out.
export const READ_BACK_TRIES = `read ${READ_BACK_DELAYS_MS.length + 1} times over ${
    READ_BACK_DELAYS_MS.reduce((sum, ms) => sum + ms, 0) / 1000
} s`;

export type Wait = (ms: number) => Promise<unknown>;

// The global timer, so tests drive it with vi.useFakeTimers().
const sleep: Wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The shape of TrackerResult and Result, so either is accepted and returned.
type Read<T> = { ok: true; value: T } | { ok: false; error: string };

export async function readUntil<T>(
    read: () => Promise<Read<T>>,
    settled: (value: T) => boolean,
    wait: Wait = sleep,
): Promise<Read<T>> {
    let last = await read();
    for (const delay of READ_BACK_DELAYS_MS) {
        if (!last.ok || settled(last.value)) {
            return last;
        }
        await wait(delay);
        last = await read();
    }
    return last;
}
