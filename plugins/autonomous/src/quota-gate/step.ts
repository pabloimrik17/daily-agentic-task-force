import type { Step, StepResult } from "../runner.ts";
import {
    type AccountReport,
    evaluateAccount,
    type OtherResource,
    type WindowReport,
} from "./decide.ts";
import { readLogin } from "./login.ts";
import { renderQuotaGate } from "./render.ts";
import { type Account, listAccounts, selectAccount } from "./select.ts";
import type { QuotaAccount } from "./source.ts";

// Another account whose own data would advance; null `email` when its source carries none.
export interface CapacityAccount {
    email: string | null;
    key: string;
}

export interface QuotaGateData {
    account: AccountReport | null;
    accounts: Account[];
    windows: WindowReport[];
    otherResources: OtherResource[];
    // Only on a wait, and only when another account would advance.
    accountsWithCapacity?: CapacityAccount[];
}

const EMPTY: QuotaGateData = { account: null, accounts: [], windows: [], otherResources: [] };

function result(
    outcome: StepResult["outcome"],
    reasons: string[],
    data: QuotaGateData,
): StepResult<QuotaGateData> {
    return { step: "quota-gate", tier: "code", outcome, reasons, data };
}

function accountReport(account: QuotaAccount): AccountReport {
    const { id, email, displayName, plan, fetchedAt, expiresAt, stale } = account;
    return { key: id, email, displayName, plan, fetchedAt, expiresAt, stale };
}

// Information only: the run never uses another account (ADR 0006), but a wait while another
// account has capacity shows that the login was not switched in time.
function capacityElsewhere(
    accounts: readonly QuotaAccount[],
    active: QuotaAccount,
    now: Date,
): Pick<QuotaGateData, "accountsWithCapacity"> {
    const advancing = accounts
        .filter((a) => a.id !== active.id)
        .filter((a) => evaluateAccount(accountReport(a), a, now).outcome === "advance")
        .map((a) => ({ email: a.email, key: a.id }));
    return advancing.length > 0 ? { accountsWithCapacity: advancing } : {};
}

export const quotaGateStep: Step<QuotaGateData> = {
    id: "quota-gate",
    async run(ctx) {
        // The quota is read first: when it fails, the login is not worth reading.
        const read = await ctx.io.quota.read();
        if (!read.ok) {
            return result("not-evaluable", [read.error], EMPTY);
        }

        const login = await readLogin(ctx.io.login);
        if (!login.ok) {
            return result("not-evaluable", [login.error], {
                ...EMPTY,
                accounts: listAccounts(read.accounts),
            });
        }

        const selection = selectAccount(read.accounts, login.email);
        if (!selection.ok) {
            return result("not-evaluable", [selection.reason], {
                ...EMPTY,
                accounts: selection.accounts,
            });
        }

        const account = accountReport(selection.account);
        const evaluation = evaluateAccount(account, selection.account, ctx.now);
        return result(evaluation.outcome, evaluation.reasons, {
            account,
            accounts: selection.accounts,
            windows: evaluation.windows,
            otherResources: evaluation.otherResources,
            ...(evaluation.outcome === "wait"
                ? capacityElsewhere(read.accounts, selection.account, ctx.now)
                : {}),
        });
    },
    render: renderQuotaGate,
};
