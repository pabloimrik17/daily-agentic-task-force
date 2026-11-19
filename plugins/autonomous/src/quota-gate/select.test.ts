import { describe, expect, it } from "vitest";

import { selectAccount } from "./select.ts";
import { ACCOUNT, ANA, LUIS, provider, quotaAccounts, session } from "./test-fixtures.ts";

const WORK = "claude@9f8e7d6c";
const OTHER = "claude@5e6f7a8b";
const named = (displayName: string) => provider({ session: session(10) }, { displayName });
const ana = named(`Claude · ${ANA}`);
const luis = named(`Claude · ${LUIS}`);

async function select(providers: Record<string, unknown>, email = ANA) {
    return selectAccount(await quotaAccounts(providers), email);
}

describe("selectAccount", () => {
    it("evaluates the account of the active email address among several", async () => {
        const selection = await select({
            [WORK]: luis,
            [ACCOUNT]: ana,
            [OTHER]: named("Claude · eva@example.com"),
        });
        expect(selection.ok && selection.account.id).toBe(ACCOUNT);
        expect(selection.accounts).toHaveLength(3);
    });

    it("evaluates a single account that is the active one", async () => {
        const selection = await select({ [ACCOUNT]: ana, "codex@0a0b0c0d": ana });
        expect(selection.ok && selection.account.id).toBe(ACCOUNT);
    });

    it("does not evaluate a single account that is not the active one", async () => {
        const selection = await select({ [WORK]: luis });
        expect(selection).toEqual({
            ok: false,
            reason: `the active account ${ANA} is not reported`,
            accounts: [{ key: WORK, email: LUIS, displayName: `Claude · ${LUIS}` }],
        });
    });

    it("names the active email address and lists the accounts with theirs", async () => {
        const selection = await select({ [ACCOUNT]: named("Claude · Personal"), [WORK]: luis });
        expect(selection).toEqual({
            ok: false,
            reason: `the active account ${ANA} is not reported`,
            accounts: [
                { key: ACCOUNT, email: null, displayName: "Claude · Personal" },
                { key: WORK, email: LUIS, displayName: `Claude · ${LUIS}` },
            ],
        });
    });

    it("compares email addresses without regard to case", async () => {
        const selection = await select({ [WORK]: luis, [ACCOUNT]: ana }, "Ana@Example.com");
        expect(selection.ok && selection.account.id).toBe(ACCOUNT);
    });

    it("refuses two accounts with the active email address, listing both ids", async () => {
        const selection = await select({ [ACCOUNT]: ana, [WORK]: named(`Claude · ${ANA}`) });
        expect(selection.ok).toBe(false);
        expect(!selection.ok && selection.reason).toBe(
            `the active account ${ANA} is reported by 2 accounts, so none can be chosen: ${ACCOUNT}, ${WORK}`,
        );
    });

    it("never matches an account whose display name carries no email address", async () => {
        const selection = await select({ [ACCOUNT]: named("Claude") });
        expect(selection.ok).toBe(false);
        expect(!selection.ok && selection.reason).toBe(`the active account ${ANA} is not reported`);
    });

    it.each([
        ["no provider at all", {}],
        ["only a non-Claude provider", { "codex@0a0b0c0d": ana }],
    ])("reports no Claude account when the source has %s", async (_, providers) => {
        expect(await select(providers)).toEqual({
            ok: false,
            reason: "the quota source reported no Claude account",
            accounts: [],
        });
    });
});
