import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseCarteraViva } from "./cartera-viva.ts";
import { parseDropdown } from "./dropdown.ts";
import { parseSwsPortfolio } from "./sws-portfolio.ts";
import { parseWatchlist } from "./watchlist.ts";

const RUN = "run-fixture-1";
const CONFIG = {
    watchlist: { name: "Trader Picks", url: "https://simplywall.st/watchlists/fixture" },
};

const fixture = (name: string): unknown =>
    JSON.parse(readFileSync(new URL(`./fixtures/browser/${name}.json`, import.meta.url), "utf8"));

describe("SWS portfolio read", () => {
    it("derives tickers from the holding links only, deduplicated", () => {
        const result = parseSwsPortfolio(fixture("sws-portfolio"), RUN);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.tickers).toEqual(["ACME", "HOOL", "CRUX", "STRK"]);
            expect(result.value.tickers).not.toContain("WNYE");
            expect(result.value.count).toBe(4);
            expect(result.value.links.map((link) => link.listing)).toEqual([
                { exchange: "NYSE", ticker: "ACME" },
                { exchange: "NasdaqGS", ticker: "HOOL" },
                { exchange: "Nasdaq", ticker: "CRUX" },
                { exchange: "tsx", ticker: "STRK" },
            ]);
        }
    });

    it("is unreadable when the count disagrees, naming both counts", () => {
        const result = parseSwsPortfolio(fixture("sws-portfolio-count-mismatch"), RUN);
        expect(result).toEqual({
            ok: false,
            error: {
                kind: "unreadable",
                message: "SWS portfolio shows 5 holdings but 4 tickers were derived",
            },
        });
    });
});

describe("Watchlist read", () => {
    it("reads exchange-qualified items, count and capacity", () => {
        const result = parseWatchlist(fixture("watchlist"), RUN, CONFIG);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.title).toBe("Trader Picks");
            expect(result.value.count).toBe(23);
            expect(result.value.capacity).toBe(50);
            expect(result.value.items.map((item) => item.listing)).toEqual([
                { exchange: "NYSE", ticker: "ACME" },
                { exchange: "NasdaqGS", ticker: "HOOL" },
                { exchange: "Nasdaq", ticker: "CRUX" },
                { exchange: "NYSE", ticker: "GLBX" },
            ]);
        }
    });

    it("is unreadable when another watchlist is open, naming both names", () => {
        const result = parseWatchlist(fixture("watchlist-other-name"), RUN, CONFIG);
        expect(result.ok).toBe(false);
        if (!result.ok && result.error.kind === "unreadable") {
            expect(result.error.message).toContain("Someone Else");
            expect(result.error.message).toContain("Trader Picks");
        }
    });
});

describe("Cartera Viva read", () => {
    const result = parseCarteraViva(fixture("cartera-viva"), RUN);

    it("reads activated trailing with and without a percentage", () => {
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.cards[0]).toEqual({
                ticker: "STRK",
                averagePrice: 12.5,
                trailing: { activated: true, percent: 8.5 },
                name: "Strike Metals",
            });
            expect(result.value.cards[2]).toEqual({
                ticker: "CYBD",
                averagePrice: 45.2,
                trailing: { activated: true, percent: null },
                name: null,
            });
        }
    });

    it("reads a card whose trailing is not activated", () => {
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.cards[1]).toEqual({
                ticker: "INIT",
                averagePrice: 1234.56,
                trailing: { activated: false },
                name: "Initech Holdings",
            });
        }
    });

    it("leaves out the closed-positions section", () => {
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.cards.map((card) => card.ticker)).toEqual(["STRK", "INIT", "CYBD"]);
        }
    });
});

describe("Login walls", () => {
    it("reports a login page as a login-wall error", () => {
        expect(parseCarteraViva(fixture("login-wall"), RUN)).toEqual({
            ok: false,
            error: { kind: "login-wall" },
        });
    });
});

describe("Result from another run", () => {
    it("is rejected naming the other run", () => {
        const result = parseSwsPortfolio(fixture("sws-portfolio"), "run-other");
        expect(result.ok).toBe(false);
        if (!result.ok && result.error.kind === "unreadable") {
            expect(result.error.message).toContain(RUN);
            expect(result.error.message).toContain("run-other");
        }
    });

    it("is rejected when the collector is not the expected one", () => {
        expect(parseWatchlist(fixture("cartera-viva"), RUN, CONFIG).ok).toBe(false);
    });
});

describe("Dropdown rows (design D11)", () => {
    it("reads HOOL with its three listings", () => {
        const result = parseDropdown(fixture("dropdown-hool"), RUN);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.map((row) => row.listing)).toEqual([
                { exchange: "NYSE", ticker: "HOO" },
                { exchange: "LSE", ticker: "HOOLA" },
                { exchange: "NasdaqGS", ticker: "HOOL" },
            ]);
        }
    });

    it("reads ACME on TSX and NYSE", () => {
        const result = parseDropdown(fixture("dropdown-acme"), RUN);
        expect(result.ok && result.value.map((row) => row.listing)).toEqual([
            { exchange: "TSX", ticker: "ACME" },
            { exchange: "NYSE", ticker: "ACME" },
        ]);
    });

    it("keeps a row without a symbol with a null listing", () => {
        const result = parseDropdown(fixture("dropdown-crux"), RUN);
        expect(result.ok && result.value[1]?.listing).toBeNull();
    });
});
