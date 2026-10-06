import { describe, expect, it } from "vitest";

import type { StockLink } from "../domain.ts";
import {
    isUsPrimary,
    learnAddition,
    learnFromLinks,
    parseListings,
    serialiseListings,
} from "./listings.ts";

const link = (exchange: string, ticker: string, name: string | null = null): StockLink => ({
    href: `https://example.test/${exchange}/${ticker}`,
    text: ticker,
    listing: { exchange, ticker },
    name,
});

describe("isUsPrimary", () => {
    it("accepts NYSE and the Nasdaq tiers only", () => {
        expect(["NYSE", "NasdaqGS", "NasdaqGM", "NasdaqCM", "Nasdaq"].every(isUsPrimary)).toBe(
            true,
        );
        expect(["LSE", "TSX", "OTCPK"].some(isUsPrimary)).toBe(false);
    });
});

describe("learnFromLinks", () => {
    it("learns symbol, name and url keyed by ticker", () => {
        const result = learnFromLinks({}, [link("NasdaqGS", "HOOL", "Hool Inc")]);
        expect(result).toEqual({
            HOOL: {
                symbol: "NasdaqGS:HOOL",
                name: "Hool Inc",
                url: "https://example.test/NasdaqGS/HOOL",
            },
        });
    });

    it("lets a US-primary listing replace a non-US one", () => {
        const result = learnFromLinks({}, [link("TSX", "ACME", "Acme"), link("NYSE", "ACME")]);
        expect(result.ACME?.symbol).toBe("NYSE:ACME");
        expect(result.ACME?.name).toBe("Acme");
    });

    it("keeps the first learnt otherwise", () => {
        const us = learnFromLinks({}, [link("NYSE", "ACME"), link("NasdaqGS", "ACME")]);
        expect(us.ACME?.symbol).toBe("NYSE:ACME");
        const foreign = learnFromLinks({}, [link("TSX", "ACME"), link("LSE", "ACME")]);
        expect(foreign.ACME?.symbol).toBe("TSX:ACME");
    });

    it("does not mutate its input", () => {
        const before = {};
        learnAddition(before, { exchange: "NYSE", ticker: "ACME" }, null, "u");
        expect(before).toEqual({});
    });
});

describe("parseListings and serialiseListings", () => {
    it("round-trips", () => {
        const listings = learnFromLinks({}, [
            link("NYSE", "ZETA"),
            link("NasdaqGS", "HOOL", "Hool"),
        ]);
        expect(parseListings(serialiseListings(listings))).toEqual({ listings, warning: null });
    });

    it("treats empty text as no listings", () => {
        expect(parseListings("")).toEqual({ listings: {}, warning: null });
    });

    it.each([
        "{",
        "[]",
        '{"HOOL":1}',
        '{"HOOL":{"symbol":"HOOL","name":null,"url":"u"}}',
        '{"HOOL":{"symbol":"NYSE:HOOL","name":3,"url":"u"}}',
        '{"HOOL":{"symbol":"NYSE:ACME","name":null,"url":"u"}}',
    ])("returns empty with a warning for %s", (text) => {
        const result = parseListings(text);
        expect(result.listings).toEqual({});
        expect(result.warning).toMatch(/listings\.json ignored/);
    });
});
