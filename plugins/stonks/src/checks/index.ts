// Findings come out in the order the report shows them (spec
// stonks-reconciliation): alerts first, then by check identifier, then by
// ticker. Excluded tickers are normalised here so that the checks compare them
// as they compare everything else.

import type {
    CarteraVivaRead,
    Finding,
    IbkrRead,
    SwsPortfolioRead,
    TrackingSheet,
} from "../domain.ts";
import { normaliseTicker } from "../ticker.ts";
import { checkA } from "./a.ts";
import { checkB } from "./b.ts";
import { checkC } from "./c.ts";

export interface CheckInputs {
    sheet: TrackingSheet;
    ibkr: IbkrRead;
    sws: SwsPortfolioRead;
    carteraViva: CarteraVivaRead;
    excludedTickers: string[];
}

export function runChecks({
    sheet,
    ibkr,
    sws,
    carteraViva,
    excludedTickers,
}: CheckInputs): Finding[] {
    const excluded = new Set(excludedTickers.map(normaliseTicker));
    const findings = [
        ...checkA(sws, ibkr),
        ...checkB(sheet, ibkr, excluded),
        ...checkC(sheet, ibkr, carteraViva, excluded),
    ];
    return findings.sort(compareFindings);
}

const alertsFirst = (item: Finding): number => (item.severity === "alert" ? 0 : 1);

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function compareFindings(a: Finding, b: Finding): number {
    return (
        alertsFirst(a) - alertsFirst(b) ||
        compareText(a.check, b.check) ||
        compareText(a.ticker, b.ticker)
    );
}
