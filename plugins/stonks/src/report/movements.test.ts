import { describe, expect, it } from "vitest";

import type { ActiveOrder, Snapshot } from "../domain.ts";
import { movements } from "./movements.ts";

function order(
    ticker: string,
    side: "buy" | "sell",
    quantity: number,
    overrides: Partial<ActiveOrder> = {},
): ActiveOrder {
    return {
        ticker,
        side,
        quantity,
        orderType: "limit",
        limitPrice: 10,
        trailPercent: null,
        ...overrides,
    };
}

function snapshot(positions: Snapshot["positions"], orders: ActiveOrder[]): Snapshot {
    return {
        schema: "stonks.snapshot.v1",
        date: "2026-10-03T20:11:00Z",
        positions,
        orders,
        findings: [],
    };
}

describe("movements", () => {
    it("lists a triggered sell when the position closed and its sell order is gone", () => {
        const previous = snapshot(
            [{ ticker: "WNYE", quantity: 3 }],
            [
                order("WNYE", "sell", 3, {
                    orderType: "trailing-stop",
                    limitPrice: null,
                    trailPercent: 15,
                }),
            ],
        );
        expect(movements(previous, { positions: [], orders: [] })).toEqual([
            { kind: "triggered-sell", ticker: "WNYE", quantity: 3, side: "sell" },
        ]);
    });

    it("lists a fill when a position appeared and its buy order is gone", () => {
        const previous = snapshot([], [order("CYBD", "buy", 1)]);
        expect(
            movements(previous, { positions: [{ ticker: "CYBD", quantity: 1 }], orders: [] }),
        ).toEqual([{ kind: "fill", ticker: "CYBD", quantity: 1, side: "buy" }]);
    });

    it("lists an order as cancelled when the position did not change", () => {
        const previous = snapshot([{ ticker: "VNDL", quantity: 2 }], [order("VNDL", "buy", 1)]);
        expect(
            movements(previous, { positions: [{ ticker: "VNDL", quantity: 2 }], orders: [] }),
        ).toEqual([{ kind: "cancelled-order", ticker: "VNDL", quantity: 1, side: "buy" }]);
    });

    it("lists a new order", () => {
        const previous = snapshot([{ ticker: "ACME", quantity: 2 }], []);
        expect(
            movements(previous, {
                positions: [{ ticker: "ACME", quantity: 2 }],
                orders: [order("ACME", "sell", 2)],
            }),
        ).toEqual([{ kind: "new-order", ticker: "ACME", quantity: 2, side: "sell" }]);
    });

    it("lists nothing when nothing changed", () => {
        const same = {
            positions: [{ ticker: "ACME", quantity: 2 }],
            orders: [order("ACME", "sell", 2)],
        };
        expect(movements(snapshot(same.positions, same.orders), same)).toEqual([]);
    });

    it("returns an empty list without a previous snapshot", () => {
        expect(
            movements(null, {
                positions: [{ ticker: "ACME", quantity: 2 }],
                orders: [order("ACME", "buy", 1)],
            }),
        ).toEqual([]);
    });

    it("does not let one position change explain two orders", () => {
        const previous = snapshot(
            [],
            [
                order("HOOL", "buy", 1, { limitPrice: 9 }),
                order("HOOL", "buy", 1, { limitPrice: 8 }),
            ],
        );
        expect(
            movements(previous, { positions: [{ ticker: "HOOL", quantity: 1 }], orders: [] }).map(
                (m) => m.kind,
            ),
        ).toEqual(["fill", "cancelled-order"]);
    });
});
