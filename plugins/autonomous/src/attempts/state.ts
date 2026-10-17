// The local state directory (spec stage-sessions, "Local state directory";
// design D1): where attempt records, prompts, result markers and captures
// live. Task 3.1 adds the attempt paths, the atomic writes, the strict record
// parser and the listing.

import { homedir } from "node:os";
import { join } from "node:path";

// `$AUTONOMOUS_STATE`, else `$XDG_STATE_HOME/autonomous`, else `~/.local/state/autonomous`.
export function resolveStateDir(env: Record<string, string | undefined>): string {
    const override = env.AUTONOMOUS_STATE;
    if (override !== undefined && override !== "") {
        return override;
    }
    const xdg = env.XDG_STATE_HOME;
    if (xdg !== undefined && xdg !== "") {
        return join(xdg, "autonomous");
    }
    const home = env.HOME ?? homedir();
    return join(home, ".local", "state", "autonomous");
}
