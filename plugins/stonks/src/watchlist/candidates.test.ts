import { describe, expect, it } from "vitest";

import type { Entry, Estado, TrackingSheet } from "../domain.ts";
import { candidates } from "./candidates.ts";

const entry = (ticker: string, estado: Estado, row = 2): Entry => ({
    row,
    ticker,
    estado,
    cantidad: 1,
    pricePerUnit: 10,
});

const sheet = (...entries: Entry[]): TrackingSheet => ({ entries });

describe("candidates", () => {
    it("qualifies a ticker whose entries are all Roger or Operativa", () => {
        expect(candidates(sheet(entry("HOOL", "Roger"), entry("HOOL", "Operativa")))).toEqual([
            "HOOL",
        ]);
    });

    it("disqualifies a ticker with one entry in another estado", () => {
        const result = candidates(
            sheet(entry("ACME", "Roger"), entry("ACME", "Comprar"), entry("ACME", "Invertido")),
        );
        expect(result).toEqual([]);
    });

    it("does not list a ticker absent from the sheet", () => {
        expect(candidates(sheet(entry("GLBX", "Comprar")))).not.toContain("OSCP");
    });

    it("disqualifies regardless of entry order and returns sorted unique tickers", () => {
        const result = candidates(
            sheet(
                entry("ACME", "Invertido"),
                entry("ACME", "Roger"),
                entry("ZETA", "Comprar"),
                entry("glbx", "Roger"),
                entry("GLBX", "Roger"),
            ),
        );
        expect(result).toEqual(["GLBX", "ZETA"]);
    });

    it("is empty for an empty sheet", () => {
        expect(candidates(sheet())).toEqual([]);
    });
});
