// The two files of a loop in the state directory (design D7): the iteration log and
// the notices. Both belong to the current loop, which resets them when it starts.

import { appendFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

function logPath(state: string): string {
    return join(state, "loop.log");
}

function noticesPath(state: string): string {
    return join(state, "loop.notices");
}

function isMissing(error: unknown): boolean {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
}

// The previous log becomes `loop.log.1`, so the log is bounded to two loops.
export async function startFiles(state: string): Promise<void> {
    await mkdir(state, { recursive: true });
    await rename(logPath(state), `${logPath(state)}.1`).catch((error: unknown) => {
        if (!isMissing(error)) {
            throw error;
        }
    });
    await writeFile(noticesPath(state), "");
}

export function appendLog(state: string, entry: string): Promise<void> {
    return appendFile(logPath(state), `${entry}\n`);
}

export async function appendNotices(state: string, notices: readonly string[]): Promise<void> {
    if (notices.length > 0) {
        await appendFile(noticesPath(state), notices.map((line) => `${line}\n`).join(""));
    }
}

// A file last written before `since` belongs to an earlier loop and counts as empty.
export async function readNotices(state: string, since: Date | null = null): Promise<string[]> {
    try {
        const file = noticesPath(state);
        if (since !== null && (await stat(file)).mtimeMs < since.getTime()) {
            return [];
        }
        const text = await readFile(file, "utf8");
        return text.split("\n").filter((line) => line !== "");
    } catch (error) {
        if (isMissing(error)) {
            return [];
        }
        throw error;
    }
}
