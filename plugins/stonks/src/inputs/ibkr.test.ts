import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseOrders, parsePositions, readIbkr } from "./ibkr.ts";

const fixture = (name: string): string =>
    readFileSync(new URL(`./fixtures/ibkr/${name}.json`, import.meta.url), "utf8");

const hookResponse = (name: string): string =>
    (JSON.parse(fixture(name)) as { tool_response: string }).tool_response;

describe("IBKR positions", () => {
    it("reads the held lines", () => {
        const result = parsePositions(fixture("positions"));
        expect(result).toMatchObject({ ok: true });
        if (result.ok) {
            expect(result.value).toHaveLength(6);
            expect(result.value[1]).toEqual({ ticker: "ACME", quantity: 2.5 });
        }
    });

    it("drops a closed line", () => {
        const text = JSON.stringify({
            positions: [
                { contract_description: "HOOL", position: 0 },
                { contract_description: "brk b", position: 3 },
            ],
        });
        expect(parsePositions(text)).toEqual({
            ok: true,
            value: [{ ticker: "BRK.B", quantity: 3 }],
        });
    });

    it("names the missing root", () => {
        expect(parsePositions(fixture("orders-unknown-shape"))).toEqual({
            ok: false,
            error: { kind: "unreadable", message: "IBKR positions: positions must be an array" },
        });
    });

    it("names a mistyped quantity", () => {
        const result = parsePositions(
            JSON.stringify({ positions: [{ contract_description: "HOOL", position: "8" }] }),
        );
        expect(result).toMatchObject({
            ok: false,
            error: { message: expect.stringContaining("positions[0].position") as string },
        });
    });

    it("treats a login text as needs-login", () => {
        expect(parsePositions("Unauthorized: token expired")).toEqual({
            ok: false,
            error: { kind: "needs-login" },
        });
    });

    it("treats other text as unreadable", () => {
        expect(parsePositions("not json")).toMatchObject({
            ok: false,
            error: { kind: "unreadable" },
        });
    });
});

describe("IBKR orders", () => {
    const orders = (): ReturnType<typeof parseOrders> => parseOrders(fixture("orders"));

    // IBKR reports an order the user modified as REPLACED, and it keeps working:
    // a replaced trailing stop still covers its position (design Context).
    it("keeps a replaced order, which is still working", () => {
        const result = orders();
        expect(result.ok && result.value.map((order) => order.ticker)).toEqual([
            "CYBD",
            "INIT",
            "HOOL",
            "STRK",
            "VNDL",
        ]);
    });

    it("reads a limit buy with its price", () => {
        const result = orders();
        expect(result.ok && result.value[0]).toEqual({
            ticker: "CYBD",
            side: "buy",
            quantity: 1,
            orderType: "limit",
            limitPrice: 41.85,
            trailPercent: null,
        });
    });

    it("reads a trailing stop with a percent trail", () => {
        const result = orders();
        expect(result.ok && result.value[2]).toMatchObject({
            ticker: "HOOL",
            side: "sell",
            orderType: "trailing-stop",
            trailPercent: 12.5,
        });
    });

    it("keeps the trail unknown without a percent sign", () => {
        const result = orders();
        expect(result.ok && result.value[1]).toMatchObject({
            ticker: "INIT",
            orderType: "trailing-stop",
            trailPercent: null,
        });
    });

    it("keeps the trail unknown in the first connect's unit-less form", () => {
        const text = JSON.stringify({
            orders: [
                {
                    order_status: "NEW",
                    order_type: "TRAILING_STOP",
                    side: "SELL",
                    remaining_shares_qty: "3",
                    primary_description: "Sell 3 WNYE",
                    secondary_description: "Trailing 6.40, stop 142.60",
                },
            ],
        });
        expect(parseOrders(text)).toMatchObject({ ok: true, value: [{ trailPercent: null }] });
    });

    it("names the missing quantity field", () => {
        expect(parseOrders(fixture("orders-missing-quantity"))).toMatchObject({
            ok: false,
            error: {
                kind: "unreadable",
                message: expect.stringContaining("orders[0].remaining_shares_qty") as string,
            },
        });
    });

    it("fails on an unknown shape", () => {
        expect(parseOrders(fixture("orders-unknown-shape"))).toEqual({
            ok: false,
            error: { kind: "unreadable", message: "IBKR orders: orders must be an array" },
        });
    });

    it("accepts no orders", () => {
        expect(parseOrders(fixture("orders-empty"))).toEqual({ ok: true, value: [] });
    });

    it("counts an unknown status as active and maps order types", () => {
        const row = (type: string, extra: object = {}): object => ({
            order_status: "PENDING_SUBMIT",
            order_type: type,
            side: "SELL",
            remaining_shares_qty: 3,
            primary_description: "Sell 3 acme",
            ...extra,
        });
        const result = parseOrders(
            JSON.stringify({
                orders: [row("STP"), row("MKT"), row("PEG"), row("TRAIL")],
            }),
        );
        expect(result.ok && result.value.map((order) => order.orderType)).toEqual([
            "stop",
            "market",
            "other",
            "trailing-stop",
        ]);
        expect(result.ok && result.value[0]?.ticker).toBe("ACME");
    });

    it("takes the remaining quantity of a partly filled sell order", () => {
        const result = parseOrders(
            JSON.stringify({
                orders: [
                    {
                        order_status: "NEW",
                        order_type: "MKT",
                        side: "SELL",
                        total_shares_qty: "5",
                        remaining_shares_qty: "2",
                        primary_description: "Sell 5 ACME",
                    },
                ],
            }),
        );
        expect(result.ok && result.value[0]).toMatchObject({ side: "sell", quantity: 2 });
    });

    it("names a missing or non-numeric remaining quantity and a missing status", () => {
        const row = { order_status: "NEW", order_type: "MKT", side: "SELL" } as const;
        const read = (extra: object): ReturnType<typeof parseOrders> =>
            parseOrders(
                JSON.stringify({
                    orders: [{ ...row, primary_description: "Sell 5 ACME", ...extra }],
                }),
            );
        const field = (name: string) => ({
            ok: false,
            error: { message: expect.stringContaining(`orders[0].${name}`) as string },
        });
        expect(read({ total_shares_qty: "5" })).toMatchObject(field("remaining_shares_qty"));
        expect(read({ remaining_shares_qty: "many" })).toMatchObject(field("remaining_shares_qty"));
        expect(read({ remaining_shares_qty: 2, order_status: undefined })).toMatchObject(
            field("order_status"),
        );
        expect(read({ remaining_shares_qty: 2, order_status: 7 })).toMatchObject(
            field("order_status"),
        );
    });

    it("drops an inactive row before validating its other fields", () => {
        const text = JSON.stringify({
            orders: [{ order_status: "CANCELLED", primary_description: "odd" }],
        });
        expect(parseOrders(text)).toEqual({ ok: true, value: [] });
    });

    it("names an unreadable side and description", () => {
        const base = {
            order_status: "NEW",
            order_type: "MKT",
            remaining_shares_qty: 1,
        };
        const side = parseOrders(
            JSON.stringify({
                orders: [{ ...base, side: "HOLD", primary_description: "Buy 1 ACME" }],
            }),
        );
        const description = parseOrders(
            JSON.stringify({ orders: [{ ...base, side: "BUY", primary_description: "odd" }] }),
        );
        expect(side).toMatchObject({
            error: { message: expect.stringContaining("orders[0].side") as string },
        });
        expect(description).toMatchObject({
            error: { message: expect.stringContaining("orders[0].primary_description") as string },
        });
    });

    it("needs a numeric limit price on a limit order", () => {
        const result = parseOrders(
            JSON.stringify({
                orders: [
                    {
                        order_status: "NEW",
                        order_type: "LIMIT",
                        side: "BUY",
                        remaining_shares_qty: 1,
                        primary_description: "Buy 1 ACME",
                    },
                ],
            }),
        );
        expect(result).toMatchObject({
            ok: false,
            error: { message: expect.stringContaining("orders[0].limit_price") as string },
        });
    });

    it("treats a login text as needs-login", () => {
        expect(parseOrders("401")).toEqual({ ok: false, error: { kind: "needs-login" } });
    });

    // An inactive order's status reads EXPIRED, a word the login hint knows;
    // it must not hide the field the other row lacks.
    it("names a row's missing field beside an expired order", () => {
        const text = JSON.stringify({
            orders: [
                {
                    order_status: "EXPIRED",
                    order_type: "LIMIT",
                    side: "BUY",
                    remaining_shares_qty: "1",
                    limit_price: 10,
                    primary_description: "Buy 1 ACME",
                    secondary_description: "Limit 10.00, DAY",
                },
                {
                    order_status: "NEW",
                    order_type: "LIMIT",
                    side: "BUY",
                    limit_price: 41.85,
                    primary_description: "Buy 1 CYBD",
                    secondary_description: "Limit 41.85, GTC",
                },
            ],
        });
        expect(parseOrders(text)).toMatchObject({
            ok: false,
            error: {
                kind: "unreadable",
                message: expect.stringContaining("orders[1].remaining_shares_qty") as string,
            },
        });
    });

    it("reads a login hint from an error body without the orders root", () => {
        expect(parseOrders(JSON.stringify({ error: "Unauthorized" }))).toEqual({
            ok: false,
            error: { kind: "needs-login" },
        });
    });
});

describe("readIbkr", () => {
    const rawWith = (files: Record<string, string>): string => {
        const dir = join(mkdtempSync(join(tmpdir(), "stonks-ibkr-")), "raw");
        mkdirSync(dir);
        for (const [name, text] of Object.entries(files)) {
            writeFileSync(join(dir, name), text);
        }
        return dir;
    };

    it("reads the newest capture of each read", () => {
        const dir = rawWith({
            "000000000000001-mcp__ibkr__get_account_positions.json": JSON.stringify({
                positions: [{ contract_description: "OLDX", position: 1 }],
            }),
            "000000000000002-mcp__ibkr__get_account_positions.json": hookResponse("hook-positions"),
            "000000000000003-mcp__ibkr__get_account_orders.json": hookResponse("hook-orders"),
        });
        const result = readIbkr(dir);
        expect(result.ok && result.value.provenance).toBe("mcp");
        expect(result.ok && result.value.positions).toHaveLength(6);
        expect(result.ok && result.value.orders).toHaveLength(5);
    });

    it("names the missing capture", () => {
        expect(readIbkr(rawWith({}))).toEqual({
            ok: false,
            error: { kind: "unreadable", message: "IBKR positions: no capture in this run" },
        });
        const onlyPositions = rawWith({
            "000000000000002-mcp__ibkr__get_account_positions.json": hookResponse("hook-positions"),
        });
        expect(readIbkr(onlyPositions)).toEqual({
            ok: false,
            error: { kind: "unreadable", message: "IBKR orders: no capture in this run" },
        });
    });

    it("returns the first failure", () => {
        const dir = rawWith({
            "000000000000002-mcp__ibkr__get_account_positions.json": "Unauthorized",
            "000000000000003-mcp__ibkr__get_account_orders.json": "garbage",
        });
        expect(readIbkr(dir)).toEqual({ ok: false, error: { kind: "needs-login" } });
    });
});
