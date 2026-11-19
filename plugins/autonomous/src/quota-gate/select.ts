import type { QuotaAccount } from "./source.ts";

export interface Account {
    key: string;
    email: string | null;
    displayName: string;
}

export type Selection =
    | { ok: true; account: QuotaAccount; accounts: Account[] }
    | { ok: false; reason: string; accounts: Account[] };

export function listAccounts(accounts: readonly QuotaAccount[]): Account[] {
    return accounts.map(({ id, email, displayName }) => ({ key: id, email, displayName }));
}

function sameEmail(a: string, b: string): boolean {
    return a.toLowerCase() === b.toLowerCase();
}

// The gate evaluates the active account and no other (ADR 0006): with one account or with
// several, the account is the one whose email address is the login's. Two matches are refused,
// since one email address can belong to two organisations and the login names neither.
export function selectAccount(accounts: readonly QuotaAccount[], email: string): Selection {
    const listed = listAccounts(accounts);
    if (accounts.length === 0) {
        return { ok: false, reason: "the quota source reported no Claude account", accounts: [] };
    }
    const matches = accounts.filter((a) => a.email !== null && sameEmail(a.email, email));
    const [match] = matches;
    if (match === undefined) {
        return {
            ok: false,
            reason: `the active account ${email} is not reported`,
            accounts: listed,
        };
    }
    if (matches.length > 1) {
        return {
            ok: false,
            reason: `the active account ${email} is reported by ${matches.length} accounts, so none can be chosen: ${matches.map((a) => a.id).join(", ")}`,
            accounts: listed,
        };
    }
    return { ok: true, account: match, accounts: listed };
}
