// The team a tier resolves to (spec review-team, "Reviewers per tier" and "The security
// trigger"). The rows come from the configuration; the security reviewer joins at any tier.

import type { ReviewConfig, Tier, TeamRow } from "./types.ts";

const SECURITY: TeamRow = { reviewer: "security-review" };

export function resolveTeam(
    tier: Tier,
    team: ReviewConfig["team"],
    securityTriggered: boolean,
): TeamRow[] {
    const rows = team[tier];
    const needsSecurity =
        securityTriggered && !rows.some((row) => row.reviewer === SECURITY.reviewer);
    return needsSecurity ? [...rows, { ...SECURITY }] : [...rows];
}
