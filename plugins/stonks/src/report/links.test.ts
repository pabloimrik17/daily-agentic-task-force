import { describe, expect, it } from "vitest";

import { SEARCH_URL, tickerLinks } from "./links.ts";

const page = "https://simplywall.st/stocks/us/capital-goods/nyse-acme/acme";

describe("tickerLinks", () => {
    it("links a ticker read in this run to its page, ahead of a learnt one", () => {
        const links = tickerLinks(["ACME"], {
            runLinks: [
                {
                    href: page,
                    text: "ACME",
                    listing: { exchange: "NYSE", ticker: "ACME" },
                    name: null,
                },
            ],
            listings: { ACME: { symbol: "ACME", name: null, url: "https://simplywall.st/old" } },
        });
        expect(links).toEqual({ ACME: page });
    });

    it("falls back to a learnt page", () => {
        const links = tickerLinks(["HOOL"], {
            runLinks: [],
            listings: {
                "NasdaqGS:HOOL": {
                    symbol: "HOOL",
                    name: "Hooli",
                    url: "https://simplywall.st/hool",
                },
            },
        });
        expect(links).toEqual({ HOOL: "https://simplywall.st/hool" });
    });

    it("links an unknown ticker to a search", () => {
        expect(tickerLinks(["CRUX"], { runLinks: [], listings: {} })).toEqual({
            CRUX: "https://simplywall.st/search?q=CRUX",
        });
        expect(SEARCH_URL("CRUX")).toBe("https://simplywall.st/search?q=CRUX");
    });
});
