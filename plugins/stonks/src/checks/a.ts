// Quantities are not compared. Excluded tickers take part, because the SWS
// portfolio mirrors IBKR fully.

import type { Finding, IbkrRead, SwsPortfolioRead } from "../domain.ts";
import { normaliseTicker } from "../ticker.ts";
import { finding, formatQuantity, heldQuantity, heldTickers } from "./findings.ts";

export function checkA(sws: SwsPortfolioRead, ibkr: IbkrRead): Finding[] {
    const held = heldTickers(ibkr);
    const listed = new Set(sws.tickers.map(normaliseTicker));
    const findings: Finding[] = [];
    for (const ticker of held) {
        if (!listed.has(ticker)) {
            findings.push(
                finding("A1", ticker, {
                    ibkr: `holds ${formatQuantity(heldQuantity(ibkr, ticker))}`,
                    "sws-portfolio": "not listed",
                }),
            );
        }
    }
    for (const ticker of listed) {
        if (!held.has(ticker)) {
            findings.push(finding("A2", ticker, { ibkr: "not held", "sws-portfolio": "listed" }));
        }
    }
    return findings;
}
