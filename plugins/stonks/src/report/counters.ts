// The count is consecutive runs (design D16), this one included, with the same
// check finding the same ticker. A run without the finding drops it from the
// snapshot, which resets the count to 1.

import type { Finding, Snapshot } from "../domain.ts";

export function withRepeatCounts(findings: Finding[], previous: Snapshot | null): Finding[] {
    return findings.map((finding) => {
        const before = previous?.findings.find(
            (f) => f.check === finding.check && f.ticker === finding.ticker,
        );
        return { ...finding, repeat: before === undefined ? 1 : before.repeat + 1 };
    });
}
