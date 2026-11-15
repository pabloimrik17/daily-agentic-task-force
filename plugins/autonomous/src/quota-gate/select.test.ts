import { describe, expect, it } from "vitest";

import { parseLimits } from "./parse.ts";
import { selectAccount } from "./select.ts";
import { ACCOUNT, limits, provider, session } from "./test-fixtures.ts";

function parsed(input: unknown) {
    const result = parseLimits(input);
    if (!result.ok) throw new Error(result.error);
    return result.value;
}

const WORK = "claude@9f8e7d6c";
const personal = provider({ session: session(10) });
const work = provider({ session: session(20) }, { displayName: "Claude · Work" });

describe("selectAccount", () => {
    it("uses the only Claude account", () => {
        const selection = selectAccount(
            parsed(limits({ [ACCOUNT]: personal, "codex@0a0b0c0d": personal })),
            undefined,
        );
        expect(selection.ok && selection.key).toBe(ACCOUNT);
    });

    it("refuses to choose between several accounts and lists them", () => {
        const selection = selectAccount(
            parsed(limits({ [WORK]: work, [ACCOUNT]: personal })),
            undefined,
        );
        expect(selection).toEqual({
            ok: false,
            reason: "ambiguous account: 2 Claude accounts present, pass --account <provider-key>",
            accounts: [
                { key: ACCOUNT, displayName: "Claude · Personal" },
                { key: WORK, displayName: "Claude · Work" },
            ],
        });
    });

    it("uses an explicit key", () => {
        const selection = selectAccount(
            parsed(limits({ [ACCOUNT]: personal, [WORK]: work })),
            WORK,
        );
        expect(selection.ok && selection.provider.displayName).toBe("Claude · Work");
    });

    it("reports an unknown key with the available ones", () => {
        const selection = selectAccount(
            parsed(limits({ [ACCOUNT]: personal, [WORK]: work })),
            "claude@00000000",
        );
        expect(selection.ok).toBe(false);
        expect(!selection.ok && selection.reason).toBe('unknown account "claude@00000000"');
        expect(!selection.ok && selection.accounts.map((a) => a.key)).toEqual([ACCOUNT, WORK]);
    });

    it("treats the provider kind as an unknown key, since 0.8 never uses it as an account id", () => {
        const selection = selectAccount(parsed(limits({ [ACCOUNT]: personal })), "claude");
        expect(selection.ok).toBe(false);
        expect(!selection.ok && selection.reason).toBe('unknown account "claude"');
    });

    it.each([
        ["no provider at all", {}],
        ["only a non-Claude provider", { "codex@0a0b0c0d": personal }],
    ])("reports no Claude account when OpenUsage has %s", (_, providers) => {
        const selection = selectAccount(parsed(limits(providers)), undefined);
        expect(selection).toEqual({
            ok: false,
            reason: "OpenUsage reported no Claude account",
            accounts: [],
        });
    });
});
