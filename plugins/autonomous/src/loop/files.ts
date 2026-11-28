import { appendFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

function logPath(state: string): string {
    return join(state, "loop.log");
}

function noticesPath(state: string): string {
    return join(state, "loop.notices");
}

function stuckPath(state: string): string {
    return join(state, "loop.stuck");
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
    await writeFile(stuckPath(state), "");
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

// A task that cannot launch, one JSON object per line; `task` is `<source>:<id>`.
// A damaged line is skipped, so at worst a notice is told again or a prerequisite is checked again.
export type StuckEntry = { task: string; exclusion: string; detail: string };

// The exclusion of an entry that is only a memory: the task's prerequisites could not be read
// once, and no task was excluded for it.
export const UNREAD_ONCE = "unreadable-once";

export function appendStuck(state: string, entry: StuckEntry): Promise<void> {
    return appendFile(stuckPath(state), `${JSON.stringify(entry)}\n`);
}

function isStuckEntry(value: unknown): value is StuckEntry {
    const entry = value as Record<string, unknown> | null;
    return (
        typeof entry?.task === "string" &&
        typeof entry.exclusion === "string" &&
        typeof entry.detail === "string"
    );
}

function parseStuck(line: string): StuckEntry[] {
    try {
        const entry: unknown = JSON.parse(line);
        return isStuckEntry(entry) ? [entry] : [];
    } catch {
        return [];
    }
}

export async function readStuck(state: string): Promise<StuckEntry[]> {
    try {
        const text = await readFile(stuckPath(state), "utf8");
        return text
            .split("\n")
            .filter((line) => line.trim() !== "")
            .flatMap(parseStuck);
    } catch (error) {
        if (isMissing(error)) {
            return [];
        }
        throw error;
    }
}
