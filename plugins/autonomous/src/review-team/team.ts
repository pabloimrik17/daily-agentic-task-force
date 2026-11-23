// The team a tier resolves to (spec review-team, "Reviewers per tier" and "The security
// trigger"). The rows come from the configuration; the security reviewer joins at any tier,
// on the model and effort of `review.security`.

import type { ReviewConfig, Tier, TeamRow } from "./types.ts";

const SECURITY_ID = "security-review";

function securityRow({ model, effort }: ReviewConfig["security"]): TeamRow {
    return {
        reviewer: SECURITY_ID,
        ...(model === undefined ? {} : { model }),
        ...(effort === undefined ? {} : { effort }),
    };
}

export function resolveTeam(
    tier: Tier,
    team: ReviewConfig["team"],
    security: ReviewConfig["security"],
    securityTriggered: boolean,
): TeamRow[] {
    const rows = team[tier];
    const needsSecurity = securityTriggered && !rows.some((row) => row.reviewer === SECURITY_ID);
    return needsSecurity ? [...rows, securityRow(security)] : [...rows];
}
