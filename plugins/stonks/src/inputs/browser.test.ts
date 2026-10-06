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

// The page fixtures mirror the envelopes the collectors return on the real
// pages, with every value fictional: a holding link's text is its ticker, a
// Nasdaq slug carries no tier, watchlist rows embed no `uniqueSymbol`, and the
// watchlist counter reads `N/M stocks`.

describe("SWS portfolio read", () => {
    it("derives tickers from the holding links only", () => {
        const result = parseSwsPortfolio(fixture("sws-portfolio"), RUN);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.tickers).toEqual(["ACME", "HOOL", "CRUX", "GLBX", "FFIX"]);
            expect(result.value.count).toBe(5);
            expect(result.value.links.map((link) => link.listing)).toEqual([
                { exchange: "NYSE", ticker: "ACME" },
                { exchange: "Nasdaq", ticker: "HOOL" },
                { exchange: "Nasdaq", ticker: "CRUX" },
                { exchange: "NYSE", ticker: "GLBX" },
                { exchange: "lse", ticker: "FFIX" },
            ]);
            expect(result.value.links[0]?.href).toBe(
                "https://simplywall.st/stocks/us/software/nyse-acme/acme-corp",
            );
        }
    });

    it("counts a holding linked twice once", () => {
        const envelope = fixture("sws-portfolio") as { data: { links: unknown[] } };
        envelope.data.links.push({ href: "/stocks/us/software/nyse-acme/acme-corp", text: "Acme" });
        const result = parseSwsPortfolio(envelope, RUN);
        expect(result.ok && result.value.tickers).toEqual(["ACME", "HOOL", "CRUX", "GLBX", "FFIX"]);
    });

    it("is unreadable when the count disagrees, naming both counts", () => {
        const result = parseSwsPortfolio(fixture("sws-portfolio-count-mismatch"), RUN);
        expect(result).toEqual({
            ok: false,
            error: {
                kind: "unreadable",
                message: "SWS portfolio shows 6 holdings but 5 tickers were derived",
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
            expect(result.value.count).toBe(4);
            expect(result.value.capacity).toBe(50);
            expect(result.value.items.map((item) => item.listing)).toEqual([
                { exchange: "NYSE", ticker: "ACME" },
                { exchange: "Nasdaq", ticker: "HOOL" },
                { exchange: "Nasdaq", ticker: "CRUX" },
                { exchange: "NYSE", ticker: "GLBX" },
            ]);
        }
    });

    it("prefers an embedded uniqueSymbol over the link slug", () => {
        const envelope = fixture("watchlist") as { data: { rows: { uniqueSymbol: unknown }[] } };
        const row = envelope.data.rows[1];
        if (row !== undefined) {
            row.uniqueSymbol = "NasdaqGS:HOOL";
        }
        const result = parseWatchlist(envelope, RUN, CONFIG);
        expect(result.ok && result.value.items[1]?.listing).toEqual({
            exchange: "NasdaqGS",
            ticker: "HOOL",
        });
    });

    it("is unreadable when the rows disagree with the counter, naming both counts", () => {
        const envelope = fixture("watchlist") as { data: { rows: unknown[] } };
        envelope.data.rows.pop();
        expect(parseWatchlist(envelope, RUN, CONFIG)).toEqual({
            ok: false,
            error: { kind: "unreadable", message: "watchlist shows 4 stocks but 3 rows were read" },
        });
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
    const mutated = (change: (data: Record<string, unknown>) => void): unknown => {
        const envelope = fixture("cartera-viva") as { data: Record<string, unknown> };
        change(envelope.data);
        return envelope;
    };
    const message = (envelope: unknown): string | null => {
        const read = parseCarteraViva(envelope, RUN);
        return !read.ok && read.error.kind === "unreadable" ? read.error.message : null;
    };

    it("reads an activated trailing with its percentage, and the company name", () => {
        expect(result.ok && result.value.cards[0]).toEqual({
            ticker: "HOOL",
            averagePrice: 98.4,
            trailing: { activated: true, percent: 15 },
            name: "Hoolihan Systems Inc.",
        });
    });

    it("reads the page's es-ES numbers", () => {
        expect(result.ok && result.value.cards[1]).toEqual({
            ticker: "ACME",
            averagePrice: 1234.56,
            trailing: { activated: true, percent: 8.5 },
            name: "ACME CORP",
        });
    });

    it("reads a card whose trailing is not activated", () => {
        expect(result.ok && result.value.cards[2]).toEqual({
            ticker: "STRK",
            averagePrice: 12.5,
            trailing: { activated: false },
            name: "Strike Metals",
        });
    });

    it("reads every card of the counter", () => {
        expect(result.ok && result.value.cards.map((card) => card.ticker)).toEqual([
            "HOOL",
            "ACME",
            "STRK",
            "INIT",
        ]);
    });

    it("is unreadable while the cards are still loading", () => {
        expect(message(fixture("cartera-viva-loading"))).toBe(
            "the Cartera Viva positions are still loading; run its collector again",
        );
    });

    it("is unreadable when the counter disagrees with the cards", () => {
        expect(message(mutated((data) => (data.counter = "5 posiciones")))).toBe(
            "Cartera Viva shows 5 positions but 4 cards were read",
        );
    });

    it("is unreadable on another page", () => {
        expect(message(mutated((data) => (data.title = "Cartera en espera")))).toBe(
            'the page is not the Cartera Viva (title "Cartera en espera")',
        );
    });

    it("is unreadable on a trailing line it does not know, rather than guessing", () => {
        const envelope = mutated((data) => {
            const cards = data.cards as { texts: string[] }[];
            cards[0]?.texts.splice(-1, 1, "Trailing activado");
        });
        expect(message(envelope)).toBe("Cartera Viva card HOOL shows no known trailing line");
    });

    it("is unreadable without an average price", () => {
        const envelope = mutated((data) => {
            const cards = data.cards as { texts: string[] }[];
            cards[2]?.texts.splice(5, 1, "n/d");
        });
        expect(message(envelope)).toBe("Cartera Viva card STRK shows no average price");
    });
});

describe("Login walls", () => {
    it("reports a login page as a login-wall error", () => {
        expect(parseCarteraViva(fixture("login-wall"), RUN)).toEqual({
            ok: false,
            error: { kind: "login-wall" },
        });
    });

    it("reports Simply Wall St's logged-out welcome page as a login wall", () => {
        expect(parseWatchlist(fixture("sws-login-wall"), RUN, CONFIG)).toEqual({
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

describe("Result truncated by javascript_tool (task 1.5)", () => {
    // The tool cuts arrays after 100 items, strings after 1,000 characters and
    // values nested six levels deep, and the hook receives the cut result.
    it.each([
        ["an array", "", "[TRUNCATED: 380 more items]"],
        ["a string", ".href", { href: "/x [TRUNCATED]", text: "" }],
        ["a nested value", ".text", { href: "/x", text: "[TRUNCATED: Max depth exceeded]" }],
    ])("is unreadable when %s was cut", (_kind, suffix, cut) => {
        const envelope = fixture("sws-portfolio") as { data: { links: unknown[] } };
        const at = `sws-portfolio.data.links[${envelope.data.links.length}]${suffix}`;
        envelope.data.links.push(cut);
        expect(parseSwsPortfolio(envelope, RUN)).toEqual({
            ok: false,
            error: {
                kind: "unreadable",
                message: `sws-portfolio: javascript_tool truncated the result at ${at}`,
            },
        });
    });
});

describe("Dropdown rows (design D11)", () => {
    it("reads HOOL among similar tickers", () => {
        const result = parseDropdown(fixture("dropdown-hool"), RUN);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.map((row) => row.listing)).toEqual([
                { exchange: "NYSE", ticker: "HOO" },
                { exchange: "LSE", ticker: "HOOLA" },
                { exchange: "NasdaqGS", ticker: "HOOL" },
                { exchange: "NEOE", ticker: "HOOY" },
            ]);
        }
    });

    it("reads ACME's expanded listings under the company's name", () => {
        const result = parseDropdown(fixture("dropdown-acme"), RUN);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.map((row) => row.listing)).toEqual([
                { exchange: "TSX", ticker: "ACME" },
                { exchange: "BASE", ticker: "ACME" },
                { exchange: "BMV", ticker: "ACME.N" },
                { exchange: "DB", ticker: "AC3" },
                { exchange: "LSE", ticker: "0ACM" },
                { exchange: "NYSE", ticker: "ACME" },
                { exchange: "SWX", ticker: "ACME" },
                { exchange: "NEOE", ticker: "ACMC" },
            ]);
            expect(result.value[5]).toEqual({
                index: 5,
                label: "Acme Corp",
                listing: { exchange: "NYSE", ticker: "ACME" },
            });
        }
    });

    it("reads CRUX with no US listing", () => {
        const result = parseDropdown(fixture("dropdown-crux"), RUN);
        expect(result.ok && result.value.map((row) => row.listing?.exchange)).toEqual([
            "TSX",
            "DB",
            "LSE",
            "NEOE",
        ]);
    });

    it("keeps a row without a symbol with a null listing", () => {
        const envelope = fixture("dropdown-crux") as { data: { rows: { symbol: unknown }[] } };
        const row = envelope.data.rows[1];
        if (row !== undefined) {
            row.symbol = null;
        }
        const result = parseDropdown(envelope, RUN);
        expect(result.ok && result.value[1]?.listing).toBeNull();
    });
});
