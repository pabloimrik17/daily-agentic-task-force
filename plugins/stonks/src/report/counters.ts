// Repeat counters (spec stonks-report, design D16): consecutive runs, the
// current one included, in which the same check produced a finding for the
// same ticker. The previous snapshot holds the previous count; a run without
// the finding drops it from the snapshot, which resets the count to 1.

import type { Finding, Snapshot } from "../domain.ts";

export function withRepeatCounts(findings: Finding[], previous: Snapshot | null): Finding[] {
    return findings.map((finding) => {
        const before = previous?.findings.find(
            (f) => f.check === finding.check && f.ticker === finding.ticker,
        );
        return { ...finding, repeat: before === undefined ? 1 : before.repeat + 1 };
    });
}
