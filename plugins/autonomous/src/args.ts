export interface RunArgs {
    account: string | undefined;
    force: boolean;
    json: boolean;
}

export type ParseArgsResult = { ok: true; args: RunArgs } | { ok: false; error: string };

export const USAGE = "Usage: /autonomous:run [--account <provider-key>] [--force] [--json]";

export function parseArgs(argv: readonly string[]): ParseArgsResult {
    const args: RunArgs = { account: undefined, force: false, json: false };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        switch (arg) {
            case "--account": {
                const value = argv[i + 1];
                if (value === undefined || value.startsWith("--")) {
                    return { ok: false, error: "--account requires a provider key" };
                }
                if (args.account !== undefined) {
                    return { ok: false, error: "--account given more than once" };
                }
                args.account = value;
                i++;
                break;
            }
            case "--force":
                args.force = true;
                break;
            case "--json":
                args.json = true;
                break;
            default:
                return { ok: false, error: `unrecognised argument: ${arg}` };
        }
    }
    return { ok: true, args };
}
