import type { AutonomousConfig } from "../config.ts";
import type { Result } from "../result.ts";
import { type AttemptId, type AttemptRecord, holdsTask } from "./record.ts";
import { attemptDir, readRecord, recordPath } from "./state.ts";

export interface OpenAttempt {
    record: AttemptRecord;
    dir: string;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function readOpenAttempt(
    state: string,
    attempt: AttemptId,
    config: AutonomousConfig,
): Promise<Result<OpenAttempt>> {
    const dir = attemptDir(state, attempt);
    let record: AttemptRecord;
    try {
        record = await readRecord(recordPath(dir));
    } catch (error) {
        const missing = (error as { cause?: NodeJS.ErrnoException }).cause?.code === "ENOENT";
        return {
            ok: false,
            error: missing
                ? `unknown attempt ${attempt}: no record at ${recordPath(dir)}`
                : messageOf(error),
        };
    }
    if (!holdsTask(record)) {
        return { ok: false, error: `attempt ${record.id} is ${record.state}, not open` };
    }
    const { source } = record.task;
    return config.sources[source].enabled
        ? { ok: true, value: { record, dir } }
        : { ok: false, error: `${source} is not enabled` };
}
