import { describe, expect, it } from "vitest";

import type { WatchlistRead } from "../domain.ts";
import { plan } from "./plan.ts";
import { verifyChange, verifyFinal } from "./verify.ts";

const watchlist = (tickers: string[]): WatchlistRead => ({
    title: "Roger",
    items: tickers.map((ticker) => ({ listing: { exchange: "NYSE", ticker }, link: null })),
    count: tickers.length,
    capacity: 50,
});

describe("verifyChange", () => {
    it("accepts exactly the expected addition", () => {
        expect(
            verifyChange(["GLBX"], ["GLBX", "HOOL"], { kind: "add", ticker: "HOOL" }, "HOOL"),
        ).toEqual({ ok: true });
    });

    it("accepts exactly the expected removal", () => {
        expect(
            verifyChange(["GLBX", "OSCP"], ["GLBX"], { kind: "remove", ticker: "OSCP" }, "oscp"),
        ).toEqual({ ok: true });
    });

    it("fails when the confirmation names HOO instead of HOOL", () => {
        const result = verifyChange(
            ["GLBX"],
            ["GLBX", "HOO"],
            { kind: "add", ticker: "HOOL" },
            "HOO",
        );
        expect(result).toMatchObject({ ok: false });
        expect(!result.ok && result.reason).toContain("HOO was added instead of HOOL");
    });

    it("fails without a confirmation", () => {
        expect(verifyChange([], ["HOOL"], { kind: "add", ticker: "HOOL" }, null).ok).toBe(false);
    });

    it("fails naming a keeper that disappeared", () => {
        const result = verifyChange(
            ["GLBX", "OSCP"],
            [],
            { kind: "remove", ticker: "OSCP" },
            "OSCP",
        );
        expect(!result.ok && result.reason).toContain("missing: GLBX");
    });

    it("fails when a different ticker appeared", () => {
        const result = verifyChange(
            ["GLBX"],
            ["GLBX", "HOO"],
            { kind: "add", ticker: "HOOL" },
            "HOOL",
        );
        expect(!result.ok && result.reason).toContain("unexpectedly added: HOO");
    });

    it("fails when the change did not happen", () => {
        const result = verifyChange(["OSCP"], ["OSCP"], { kind: "remove", ticker: "OSCP" }, "OSCP");
        expect(!result.ok && result.reason).toContain("OSCP is still on the watchlist");
    });
});

describe("verifyFinal", () => {
    const p = plan(["ACME", "GLBX"], watchlist(["GLBX", "OSCP"]));

    it("reports a matching watchlist", () => {
        expect(verifyFinal(["ACME", "GLBX"], ["GLBX", "ACME"], p, [])).toEqual({
            removed: ["OSCP"],
            added: ["ACME"],
            unresolved: [],
            final: ["ACME", "GLBX"],
            count: 2,
            capacity: 50,
            incomplete: null,
        });
    });

    it("reports missing and extra tickers as incomplete", () => {
        const result = verifyFinal(["ACME", "GLBX"], ["GLBX", "OSCP"], p, []);
        expect(result.incomplete).toEqual({ missing: ["ACME"], extra: ["OSCP"] });
    });

    it("leaves unresolved tickers out of added", () => {
        const result = verifyFinal(["ACME", "GLBX"], ["GLBX"], p, ["ACME"]);
        expect(result.added).toEqual([]);
        expect(result.unresolved).toEqual(["ACME"]);
        expect(result.incomplete).toEqual({ missing: ["ACME"], extra: [] });
    });
});
