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
import { type Candidate, selectAccount } from "./select.ts";

export interface QuotaGateData {
    account: AccountReport | null;
    candidates: Candidate[];
    windows: WindowReport[];
    otherResources: OtherResource[];
}

const EMPTY: QuotaGateData = { account: null, candidates: [], windows: [], otherResources: [] };

function result(
    outcome: StepResult["outcome"],
    reasons: string[],
    data: QuotaGateData,
): StepResult<QuotaGateData> {
    return { step: "quota-gate", tier: "code", outcome, reasons, data };
}

function accountReport(
    key: string,
    provider: OpenUsageProvider | undefined,
    errors: string[],
): AccountReport {
    if (provider === undefined) {
        const none = { displayName: null, plan: null, fetchedAt: null, expiresAt: null };
        return { key, ...none, stale: false, errors };
    }
    const { displayName, plan, fetchedAt, expiresAt, stale } = provider;
    return { key, displayName, plan: plan ?? null, fetchedAt, expiresAt, stale, errors };
}

export const quotaGateStep: Step<QuotaGateData> = {
    id: "quota-gate",
    async run(ctx) {
        const read = await readOpenUsage(ctx.io.openUsage, ctx.args.force);
        if (!read.ok) {
            return result("not-evaluable", [read.error], EMPTY);
        }

        const selection = selectAccount(read.limits, ctx.args.account);
        if (!selection.ok) {
            return result("not-evaluable", [selection.reason], {
                ...EMPTY,
                candidates: selection.candidates,
            });
        }

        const { provider } = selection;
        const account = accountReport(selection.key, provider, selection.errors);
        const evaluation = evaluateAccount(account, provider, ctx.now);
        return result(evaluation.outcome, evaluation.reasons, {
            account,
            candidates: selection.candidates,
            windows: evaluation.windows,
            otherResources: evaluation.otherResources,
        });
    },
    render: renderQuotaGate,
};
