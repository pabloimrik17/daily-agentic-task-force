import { describe, expect, it } from "vitest";

import { SCREENSHOTS_SCHEMA, renderIbkrTable, stageScreenshots } from "./ibkr-screenshots.ts";

const hool = { ticker: "HOOL", quantity: 8 };
const acme = { ticker: "ACME", quantity: 2.5 };
const strk = { ticker: "STRK", quantity: 3 };
const trail = {
    ticker: "HOOL",
    side: "sell",
    quantity: 8,
    orderType: "trailing-stop",
    limitPrice: null,
    trailPercent: 12.5,
};

const stage = (document: object): ReturnType<typeof stageScreenshots> =>
    stageScreenshots(JSON.stringify({ schema: SCREENSHOTS_SCHEMA, ...document }));

describe("IBKR screenshots", () => {
    it("merges two overlapping screens and renders both tables", () => {
        const result = stage({
            positions: [
                [hool, acme],
                [acme, strk],
            ],
            orders: [[trail]],
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.read.provenance).toBe("screenshots");
            expect(result.read.positions).toEqual([hool, acme, strk]);
            expect(result.read.orders).toEqual([trail]);
            expect(result.markdown).toContain("| HOOL | 8 |");
            expect(result.markdown).toContain("| HOOL | sell | 8 | trailing-stop | - | 12.5 |");
        }
    });

    it("accepts one screen, trivially contiguous", () => {
        expect(stage({ positions: [[hool]], orders: [] })).toMatchObject({ ok: true });
    });

    it("rejects screens that do not overlap", () => {
        const result = stage({
            positions: [[hool], [acme], [strk]],
            orders: null,
            noActiveOrders: true,
        });
        expect(result).toEqual({
            ok: false,
            kind: "invalid",
            message: "positions screens 1 and 2 do not overlap; a page may be missing",
        });
    });

    it("rejects an overlap on ticker alone with a different quantity", () => {
        const result = stage({
            positions: [[hool], [{ ticker: "HOOL", quantity: 9 }]],
            noActiveOrders: true,
            orders: null,
        });
        expect(result).toMatchObject({ ok: false, kind: "invalid" });
    });

    it("rejects a ticker repeated outside an overlap", () => {
        const result = stage({
            positions: [
                [hool, acme],
                [acme, { ticker: "hool", quantity: 1 }],
            ],
            orders: [],
        });
        expect(result).toMatchObject({ ok: false, kind: "invalid" });
    });

    it("rejects zero screens", () => {
        expect(stage({ positions: [], orders: [] })).toMatchObject({ ok: false, kind: "invalid" });
    });

    it("asks for the orders screenshot when none was supplied", () => {
        const result = stage({ positions: [[hool]], orders: null });
        expect(result).toMatchObject({ ok: false, kind: "orders-missing" });
        const absent = stage({ positions: [[hool]] });
        expect(absent).toMatchObject({ ok: false, kind: "orders-missing" });
    });

    it("accepts a confirmed absence of orders", () => {
        const result = stage({ positions: [[hool]], orders: null, noActiveOrders: true });
        expect(result).toMatchObject({ ok: true, read: { orders: [] } });
        if (result.ok) {
            expect(result.markdown).toContain("No active orders.");
        }
    });

    it("rejects orders alongside noActiveOrders", () => {
        const result = stage({ positions: [[hool]], orders: [[trail]], noActiveOrders: true });
        expect(result).toMatchObject({ ok: false, kind: "invalid" });
    });

    it("rejects a mistyped or unknown field, naming it", () => {
        const badSide = stage({ positions: [[hool]], orders: [[{ ...trail, side: "hold" }]] });
        expect(badSide).toMatchObject({
            ok: false,
            kind: "invalid",
            message: expect.stringContaining("orders[0][0].side") as string,
        });
        const extra = stage({ positions: [[{ ...hool, price: 1 }]], orders: [] });
        expect(extra).toMatchObject({
            kind: "invalid",
            message: expect.stringContaining("price") as string,
        });
        const text = stage({ positions: [[{ ticker: "HOOL", quantity: "8" }]], orders: [] });
        expect(text).toMatchObject({ kind: "invalid" });
    });

    it("rejects a wrong schema and non-JSON", () => {
        expect(stageScreenshots("{}")).toMatchObject({ ok: false, kind: "invalid" });
        expect(stageScreenshots("nope")).toMatchObject({ ok: false, kind: "invalid" });
        expect(
            stageScreenshots(JSON.stringify({ schema: "other", positions: [[hool]], orders: [] })),
        ).toMatchObject({ kind: "invalid" });
    });

    it("renders limit prices", () => {
        const markdown = renderIbkrTable({
            provenance: "screenshots",
            positions: [],
            orders: [
                {
                    ticker: "CYBD",
                    side: "buy",
                    quantity: 1,
                    orderType: "limit",
                    limitPrice: 41.85,
                    trailPercent: null,
                },
            ],
        });
        expect(markdown).toContain("| CYBD | buy | 1 | limit | 41.85 | - |");
    });
});
