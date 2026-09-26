export interface RunArgs {
    account: string | undefined;
    force: boolean;
    json: boolean;
    apply: boolean;
    bootstrapLabels: boolean;
}

export type ParseArgsResult = { ok: true; args: RunArgs } | { ok: false; error: string };

export const USAGE =
    "Usage: /autonomous:run [--account <provider-key>] [--force] [--json] [--apply]\n       /autonomous:run --bootstrap-labels [--json]";

export function parseArgs(argv: readonly string[]): ParseArgsResult {
    const args: RunArgs = {
        account: undefined,
        force: false,
        json: false,
        apply: false,
        bootstrapLabels: false,
    };
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
            case "--apply":
                args.apply = true;
                break;
            case "--bootstrap-labels":
                args.bootstrapLabels = true;
                break;
            default:
                return { ok: false, error: `unrecognised argument: ${arg}` };
        }
    }
    if (args.bootstrapLabels && (args.account !== undefined || args.force || args.apply)) {
        return { ok: false, error: "--bootstrap-labels can only be combined with --json" };
    }
    return { ok: true, args };
}
