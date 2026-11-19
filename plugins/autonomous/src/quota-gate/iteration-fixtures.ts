// The quota gate as each run of the pipeline meets it, for tests that take their clock from
// another fixture module: importing `test-fixtures.ts` beside one would give them two `NOW`s.

import { quotaGateStep } from "./step.ts";
import {
    ACCOUNT,
    ANA,
    context,
    fakeExec,
    fakeLogin,
    limits,
    LUIS,
    provider,
    session,
    weekly,
} from "./test-fixtures.ts";

const WORK = "claude@9f8e7d6c";

const capacity = (email: string) =>
    provider({ session: session(20), weekly: weekly(30) }, { displayName: `Claude · ${email}` });

// Two accounts with capacity, ana's and luis's, and a login that answers each email address
// in turn, one per gate run.
export function gateOverLogins(...emails: string[]) {
    const openUsage = fakeExec(limits({ [ACCOUNT]: capacity(ANA), [WORK]: capacity(LUIS) }));
    const login = fakeLogin(...emails);
    const ctx = context(openUsage, {}, login);
    return { login, run: () => quotaGateStep.run(ctx) };
}
