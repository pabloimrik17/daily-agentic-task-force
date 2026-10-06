import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { DropdownRow } from "../domain.ts";
import { parseDropdown } from "../inputs/dropdown.ts";
import { parseListing } from "../ticker.ts";
import type { Listings } from "./listings.ts";
import { searchTerm, select, target } from "./resolve.ts";

const rows = (...symbols: string[]): DropdownRow[] =>
    symbols.map((symbol, index) => ({ index, label: symbol, listing: parseListing(symbol) }));

const none: Listings = {};

describe("target", () => {
    it("uses a learnt US-primary listing", () => {
        const listings: Listings = { HOOL: { symbol: "NasdaqGS:HOOL", name: null, url: "u" } };
        expect(target("HOOL", listings)).toEqual({
            kind: "known",
            listing: { exchange: "NasdaqGS", ticker: "HOOL" },
        });
    });

    it("falls back to any US exchange for an unknown or non-US learnt listing", () => {
        const listings: Listings = { ACME: { symbol: "TSX:ACME", name: null, url: "u" } };
        expect(target("ACME", listings)).toEqual({ kind: "any-us", ticker: "ACME" });
        expect(target("crux", none)).toEqual({ kind: "any-us", ticker: "CRUX" });
    });
});

describe("searchTerm", () => {
    const card = {
        ticker: "ACME",
        averagePrice: null,
        trailing: { activated: false } as const,
        name: "Acme Corp",
    };

    it("prefers the learnt name, then the card name, then null", () => {
        const listings: Listings = {
            ACME: { symbol: "NYSE:ACME", name: "Acme Holdings", url: "u" },
        };
        expect(searchTerm("ACME", listings, [card])).toBe("Acme Holdings");
        expect(searchTerm("ACME", none, [card])).toBe("Acme Corp");
        expect(searchTerm("CRUX", none, [card])).toBeNull();
        expect(searchTerm("ACME", none, [{ ...card, name: null }])).toBeNull();
    });
});

describe("select", () => {
    it("selects only the exact listing among similar tickers", () => {
        const result = select(rows("NYSE:HOO", "LSE:HOOLA", "NasdaqGS:HOOL"), {
            kind: "known",
            listing: { exchange: "NasdaqGS", ticker: "HOOL" },
        });
        expect(result).toMatchObject({ kind: "selected", row: { index: 2 } });
    });

    it("selects the US listing, not the first one", () => {
        const result = select(rows("TSX:ACME", "LSE:ACME", "NYSE:ACME"), {
            kind: "any-us",
            ticker: "ACME",
        });
        expect(result).toMatchObject({ kind: "selected", row: { index: 2 } });
    });

    it("is unresolved when no exact US match exists", () => {
        const result = select(rows("TSX:CRUX", "NYSE:CRUXX", "OTCPK:CRUX"), {
            kind: "any-us",
            ticker: "CRUX",
        });
        expect(result.kind).toBe("unresolved");
        if (result.kind === "unresolved") {
            expect(result.candidates.map((r) => r.index)).toEqual([0, 2]);
        }
    });

    it("is unresolved when two US rows match", () => {
        const result = select(rows("NYSE:ACME", "NasdaqGS:ACME"), {
            kind: "any-us",
            ticker: "ACME",
        });
        expect(result.kind).toBe("unresolved");
    });

    it("matches a tierless Nasdaq slug to any Nasdaq tier", () => {
        const result = select(rows("NasdaqCM:HOOL", "LSE:HOOL"), {
            kind: "known",
            listing: { exchange: "Nasdaq", ticker: "HOOL" },
        });
        expect(result).toMatchObject({ kind: "selected", row: { index: 0 } });
    });

    it("ignores rows without a listing and known-target mismatches", () => {
        const dropdown: DropdownRow[] = [
            { index: 0, label: "x", listing: null },
            ...rows("NYSE:HOOL").map((r) => ({ ...r, index: 1 })),
        ];
        expect(
            select(dropdown, { kind: "known", listing: { exchange: "NasdaqGS", ticker: "HOOL" } })
                .kind,
        ).toBe("unresolved");
    });
});

describe("select on the task 3.4 dropdown fixtures", () => {
    const dropdown = (name: string): DropdownRow[] => {
        const text = readFileSync(
            new URL(`../inputs/fixtures/browser/${name}.json`, import.meta.url),
            "utf8",
        );
        const parsed = parseDropdown(JSON.parse(text), "run-fixture-1");
        if (!parsed.ok) {
            throw new Error(`fixture ${name} does not parse`);
        }
        return parsed.value;
    };

    it("selects NasdaqGS:HOOL among similar tickers", () => {
        expect(select(dropdown("dropdown-hool"), target("HOOL", none))).toMatchObject({
            kind: "selected",
            row: { index: 2, label: "Hoolihan Systems" },
        });
    });

    it("selects NYSE:ACME among the company's expanded listings", () => {
        expect(select(dropdown("dropdown-acme"), target("ACME", none))).toMatchObject({
            kind: "selected",
            row: { index: 5, listing: { exchange: "NYSE", ticker: "ACME" } },
        });
    });

    it("leaves CRUX unresolved when only non-US listings show", () => {
        expect(select(dropdown("dropdown-crux"), target("CRUX", none)).kind).toBe("unresolved");
    });
});
