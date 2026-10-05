// The state directory and the run directory (design D6). All local state lives
// under one directory; directories are 0700 and files 0600. A run owns one
// directory, and `beginRun` deletes the previous one so that data from before
// is gone by construction, not by instruction.

import { randomBytes } from "node:crypto";
import {
    chmodSync,
    existsSync,
    mkdirSync,
    readFileSync,
    renameSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ActiveRun, RunMode } from "./domain.ts";

/** Captures older than this are ignored (design D6). */
export const RUN_EXPIRY_MS = 6 * 60 * 60 * 1000;

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

export function resolveStateDir(env: Record<string, string | undefined>): string {
    const override = env.STONKS_STATE_DIR;
    if (override !== undefined && override !== "") {
        return override;
    }
    const xdg = env.XDG_STATE_HOME;
    if (xdg !== undefined && xdg !== "") {
        return join(xdg, "stonks");
    }
    return join(env.HOME ?? homedir(), ".local", "state", "stonks");
}

export const activePath = (stateDir: string): string => join(stateDir, "active.json");
export const runsDir = (stateDir: string): string => join(stateDir, "runs");
export const runDir = (stateDir: string, runId: string): string => join(runsDir(stateDir), runId);
export const rawDir = (stateDir: string, runId: string): string =>
    join(runDir(stateDir, runId), "raw");
export const ibkrConfirmedPath = (stateDir: string, runId: string): string =>
    join(runDir(stateDir, runId), "ibkr-confirmed.json");
export const reportPath = (stateDir: string, runId: string): string =>
    join(runDir(stateDir, runId), "report.json");
export const planPath = (stateDir: string, runId: string): string =>
    join(runDir(stateDir, runId), "plan.json");
/** The unknown-IBKR-tool warnings `ibkr-tools` recorded for the report (design D4a). */
export const warningsPath = (stateDir: string, runId: string): string =>
    join(runDir(stateDir, runId), "warnings.json");
/** Present once `phase1` has offered `/mcp` re-authentication in this run (design D4). */
export const reauthOfferedPath = (stateDir: string, runId: string): string =>
    join(runDir(stateDir, runId), "ibkr-reauth-offered.json");
/** The screenshot table awaiting the user's confirmation (design D4). */
export const stagedPath = (stateDir: string, runId: string): string =>
    join(runDir(stateDir, runId), "ibkr-staged.json");
/** The snapshot of the previous run, inside the run that consumed it. */
export const previousPath = (stateDir: string, runId: string): string =>
    join(runDir(stateDir, runId), "previous.json");
/** Where the mod leaves the previous snapshot, before `beginRun` moves it in. */
export const handoffPath = (stateDir: string): string => join(stateDir, "previous.json");
export const listingsPath = (stateDir: string): string => join(stateDir, "listings.json");

/** Creates a directory (and parents) at 0700 whatever the umask. */
export function ensureDir(path: string): void {
    mkdirSync(path, { recursive: true, mode: DIR_MODE });
    chmodSync(path, DIR_MODE);
}

/** Writes a file at 0600 whatever the umask, creating its directory. */
export function writePrivate(path: string, text: string): void {
    ensureDir(join(path, ".."));
    writeFileSync(path, text, { mode: FILE_MODE });
    chmodSync(path, FILE_MODE);
}

function compactUtc(now: Date): string {
    return now
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d+Z$/, "Z");
}

export function beginRun(options: { stateDir: string; mode: RunMode; now: Date }): {
    runId: string;
    runDir: string;
} {
    const { stateDir, mode, now } = options;
    ensureDir(stateDir);
    rmSync(runsDir(stateDir), { recursive: true, force: true });
    const runId = `${compactUtc(now)}-${randomBytes(3).toString("hex")}`;
    const dir = runDir(stateDir, runId);
    ensureDir(dir);
    const active: ActiveRun = { runId, startedAt: now.toISOString(), mode };
    writePrivate(activePath(stateDir), `${JSON.stringify(active)}\n`);
    // Consumed once: the handoff leaves the state directory as it enters the run.
    if (existsSync(handoffPath(stateDir))) {
        renameSync(handoffPath(stateDir), previousPath(stateDir, runId));
        chmodSync(previousPath(stateDir, runId), FILE_MODE);
    }
    return { runId, runDir: dir };
}

/** The open run, or null when there is none, it is unreadable, or it has expired. */
export function readActiveRun(options: { stateDir: string; now: Date }): ActiveRun | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(readFileSync(activePath(options.stateDir), "utf8"));
    } catch {
        return null;
    }
    if (typeof parsed !== "object" || parsed === null) {
        return null;
    }
    const { runId, startedAt, mode } = parsed as Record<string, unknown>;
    if (
        typeof runId !== "string" ||
        typeof startedAt !== "string" ||
        (mode !== "full" && mode !== "sources" && mode !== "watchlist")
    ) {
        return null;
    }
    const started = Date.parse(startedAt);
    if (Number.isNaN(started) || options.now.getTime() - started > RUN_EXPIRY_MS) {
        return null;
    }
    return { runId, startedAt, mode };
}

export function endRun(stateDir: string): void {
    rmSync(activePath(stateDir), { force: true });
}
