import { describe, expect, it } from "vitest";

import { parseLimits } from "./parse.ts";
import { selectAccount } from "./select.ts";
import { limits, provider, session } from "./test-fixtures.ts";

function parsed(input: unknown) {
    const result = parseLimits(input);
    if (!result.ok) throw new Error(result.error);
    return result.value;
}

const personal = provider({ session: session(10) });
const work = provider({ session: session(20) }, { displayName: "Claude: Work (me@work.example)" });

describe("selectAccount", () => {
    it("uses the only Claude account", () => {
        const selection = selectAccount(
            parsed(limits({ claude: personal, codex: personal })),
            undefined,
        );
        expect(selection.ok && selection.key).toBe("claude");
    });

    it("refuses to choose between several accounts and lists them", () => {
        const selection = selectAccount(
            parsed(limits({ claude: personal, "claude@123": work })),
            undefined,
        );
        expect(selection).toEqual({
            ok: false,
            reason: "ambiguous account: 2 Claude accounts present, pass --account <provider-key>",
            candidates: [
                { key: "claude", displayName: "Claude: Personal (me@example.com)" },
                { key: "claude@123", displayName: "Claude: Work (me@work.example)" },
            ],
        });
    });

    it("uses an explicit key", () => {
        const selection = selectAccount(
            parsed(limits({ claude: personal, "claude@123": work })),
            "claude@123",
        );
        expect(selection.ok && selection.provider?.displayName).toBe(
            "Claude: Work (me@work.example)",
        );
    });

    it("reports an unknown key with the available ones", () => {
        const selection = selectAccount(
            parsed(limits({ claude: personal, "claude@123": work })),
            "claude@999",
        );
        expect(selection.ok).toBe(false);
        expect(!selection.ok && selection.reason).toBe('unknown account "claude@999"');
        expect(!selection.ok && selection.candidates.map((c) => c.key)).toEqual([
            "claude",
            "claude@123",
        ]);
    });

    it("selects an account known only from an error, carrying the error", () => {
        const selection = selectAccount(
            parsed(limits({}, [{ providerId: "claude", message: "token expired" }])),
            undefined,
        );
        expect(selection).toMatchObject({
            ok: true,
            key: "claude",
            provider: undefined,
            errors: ["token expired"],
        });
    });
});
