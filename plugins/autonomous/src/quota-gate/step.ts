import type { Step, StepResult } from "../runner.ts";
import {
    type AccountReport,
    evaluateAccount,
    type OtherResource,
    type WindowReport,
} from "./decide.ts";
import { readOpenUsage } from "./openusage.ts";
import type { OpenUsageProvider } from "./parse.ts";
import { renderQuotaGate } from "./render.ts";
import { type Account, selectAccount } from "./select.ts";

export interface QuotaGateData {
    account: AccountReport | null;
    accounts: Account[];
    windows: WindowReport[];
    otherResources: OtherResource[];
}

const EMPTY: QuotaGateData = { account: null, accounts: [], windows: [], otherResources: [] };

function result(
    outcome: StepResult["outcome"],
    reasons: string[],
    data: QuotaGateData,
): StepResult<QuotaGateData> {
    return { step: "quota-gate", tier: "code", outcome, reasons, data };
}

function accountReport(key: string, provider: OpenUsageProvider): AccountReport {
    const { displayName, plan, fetchedAt, expiresAt, stale } = provider;
    return { key, displayName, plan: plan ?? null, fetchedAt, expiresAt, stale };
}

export const quotaGateStep: Step<QuotaGateData> = {
    id: "quota-gate",
    async run(ctx) {
        // `--force` is still accepted by the run, but OpenUsage 0.8 has no refresh to ask for.
        const read = await readOpenUsage(ctx.io.openUsage);
        if (!read.ok) {
            return result("not-evaluable", [read.error], EMPTY);
        }

        const selection = selectAccount(read.limits, ctx.args.account);
        if (!selection.ok) {
            return result("not-evaluable", [selection.reason], {
                ...EMPTY,
                accounts: selection.accounts,
            });
        }

        const { provider } = selection;
        const account = accountReport(selection.key, provider);
        const evaluation = evaluateAccount(account, provider, ctx.now);
        return result(evaluation.outcome, evaluation.reasons, {
            account,
            accounts: selection.accounts,
            windows: evaluation.windows,
            otherResources: evaluation.otherResources,
        });
    },
    render: renderQuotaGate,
};
