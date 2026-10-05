import { describe, expect, it } from "vitest";

import type { Finding, Snapshot } from "../domain.ts";
import { withRepeatCounts } from "./counters.ts";

const finding = (check: Finding["check"], ticker: string): Finding => ({
    check,
    ticker,
    sides: {},
    severity: "warning",
    affectsWatchlist: false,
});

const previous = (findings: Snapshot["findings"]): Snapshot => ({
    schema: "stonks.snapshot.v1",
    date: "2026-10-03T20:11:00Z",
    positions: [],
    orders: [],
    findings,
});

describe("withRepeatCounts", () => {
    it("counts a persisting finding as the previous count plus one", () => {
        const result = withRepeatCounts(
            [finding("C6", "INIT")],
            previous([{ check: "C6", ticker: "INIT", repeat: 2 }]),
        );
        expect(result[0]?.repeat).toBe(3);
    });

    it("restarts at 1 for a finding that was absent from the previous run", () => {
        const result = withRepeatCounts(
            [finding("C6", "INIT")],
            previous([{ check: "C6", ticker: "ACME", repeat: 5 }]),
        );
        expect(result[0]?.repeat).toBe(1);
    });

    it("starts every finding at 1 without a previous snapshot", () => {
        expect(withRepeatCounts([finding("A2", "TYRL")], null)[0]?.repeat).toBe(1);
    });
});
