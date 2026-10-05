// The arguments of `/stonks:sync` (spec stonks-sync, "Phases and modes"): one
// optional `--only sources|watchlist`. Anything else is a usage error.

export interface SyncArgs {
    only: "sources" | "watchlist" | null;
}

export type ParseArgsResult = { ok: true; args: SyncArgs } | { ok: false; error: string };

export const USAGE = "Usage: /stonks:sync [--only sources|watchlist]";

export function parseArgs(argv: readonly string[]): ParseArgsResult {
    if (argv.length === 0) {
        return { ok: true, args: { only: null } };
    }
    if (argv[0] !== "--only") {
        return { ok: false, error: `unrecognised argument: ${argv[0]}` };
    }
    const value = argv[1];
    if (value !== "sources" && value !== "watchlist") {
        return { ok: false, error: "--only requires sources or watchlist" };
    }
    if (argv.length > 2) {
        return { ok: false, error: `unrecognised argument: ${argv[2]}` };
    }
    return { ok: true, args: { only: value } };
}
