// The screenshot fallback (design D4): Claude's transcription is validated,
// position pages must be contiguous (a missing page would read as sold lines),
// and the rendered table needs the user's confirmation before any check runs.

import type { ActiveOrder, IbkrRead, OrderType, Position } from "../domain.ts";
import { normaliseTicker, sameQuantity } from "../ticker.ts";
import {
    array,
    boolean,
    number,
    object,
    optional,
    ParseError,
    rejectUnknownKeys,
    string,
    type Json,
} from "../validate.ts";

export const SCREENSHOTS_SCHEMA = "stonks.ibkr-screenshots.v1";

export type StageResult =
    | { ok: true; read: IbkrRead; markdown: string }
    | { ok: false; kind: "orders-missing"; message: string }
    | { ok: false; kind: "invalid"; message: string };

const ORDER_TYPES: readonly OrderType[] = ["limit", "trailing-stop", "stop", "market", "other"];

class OrdersMissing extends Error {}

function nullableNumber(parent: Json, key: string, path: string): number | null {
    return parent[key] === null ? null : number(parent, key, path);
}

function readPositions(raw: unknown): Position[] {
    const screens = array(raw, "positions");
    if (screens.length === 0) {
        throw new ParseError("positions must hold at least one screenshot");
    }
    const parsed = screens.map((screen, s) =>
        array(screen, `positions[${s}]`).map((item, i) => {
            const path = `positions[${s}][${i}]`;
            const row = object(item, path);
            rejectUnknownKeys(row, ["ticker", "quantity"], path);
            const ticker = normaliseTicker(string(row, "ticker", path));
            if (ticker === "") {
                throw new ParseError(`${path}.ticker must not be empty`);
            }
            return { ticker, quantity: number(row, "quantity", path) };
        }),
    );
    const merged: Position[] = [...(parsed[0] ?? [])];
    for (let s = 1; s < parsed.length; s++) {
        const previous = parsed[s - 1] ?? [];
        const current = parsed[s] ?? [];
        const overlaps = (position: Position): boolean =>
            previous.some(
                (other) =>
                    other.ticker === position.ticker &&
                    sameQuantity(other.quantity, position.quantity),
            );
        if (!current.some(overlaps)) {
            throw new ParseError(
                `positions screens ${s} and ${s + 1} do not overlap; a page may be missing`,
            );
        }
        merged.push(...current.filter((position) => !overlaps(position)));
    }
    const seen = new Set<string>();
    for (const position of merged) {
        if (seen.has(position.ticker)) {
            throw new ParseError(
                `positions list ${position.ticker} twice outside a page overlap; IBKR shows one line per contract`,
            );
        }
        seen.add(position.ticker);
    }
    return merged;
}

function ordersMissing(): OrdersMissing {
    return new OrdersMissing(
        "the screenshots show no active orders section; ask for the orders screenshot, or confirm that no orders are active",
    );
}

function readOrders(raw: unknown, noActiveOrders: boolean): ActiveOrder[] {
    if (raw === null) {
        if (noActiveOrders) {
            return [];
        }
        throw ordersMissing();
    }
    if (noActiveOrders) {
        throw new ParseError("orders must be null when noActiveOrders is true");
    }
    const orders = readOrderRows(raw);
    if (orders.length === 0) {
        throw ordersMissing();
    }
    return orders;
}

function readOrderRows(raw: unknown): ActiveOrder[] {
    return array(raw, "orders").flatMap((screen, s) =>
        array(screen, `orders[${s}]`).map((item, i): ActiveOrder => {
            const path = `orders[${s}][${i}]`;
            const row = object(item, path);
            rejectUnknownKeys(
                row,
                ["ticker", "side", "quantity", "orderType", "limitPrice", "trailPercent"],
                path,
            );
            const side = string(row, "side", path);
            if (side !== "buy" && side !== "sell") {
                throw new ParseError(`${path}.side must be buy or sell`);
            }
            const orderType = string(row, "orderType", path);
            if (!ORDER_TYPES.includes(orderType as OrderType)) {
                throw new ParseError(`${path}.orderType must be one of ${ORDER_TYPES.join(", ")}`);
            }
            const ticker = normaliseTicker(string(row, "ticker", path));
            if (ticker === "") {
                throw new ParseError(`${path}.ticker must not be empty`);
            }
            return {
                ticker,
                side,
                quantity: number(row, "quantity", path),
                orderType: orderType as OrderType,
                limitPrice: nullableNumber(row, "limitPrice", path),
                trailPercent: nullableNumber(row, "trailPercent", path),
            };
        }),
    );
}

export function stageScreenshots(text: string): StageResult {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { ok: false, kind: "invalid", message: "the screenshots JSON is not valid JSON" };
    }
    try {
        const root = object(parsed, "screenshots");
        rejectUnknownKeys(root, ["schema", "positions", "orders", "noActiveOrders"], "screenshots");
        const schema = string(root, "schema", "screenshots");
        if (schema !== SCREENSHOTS_SCHEMA) {
            throw new ParseError(`screenshots.schema must be ${SCREENSHOTS_SCHEMA}`);
        }
        const positions = readPositions(root.positions);
        const noActiveOrders = optional(root, "noActiveOrders", "screenshots", boolean) ?? false;
        const orders = readOrders(root.orders ?? null, noActiveOrders);
        const read: IbkrRead = { provenance: "screenshots", positions, orders };
        return { ok: true, read, markdown: renderIbkrTable(read) };
    } catch (error) {
        if (error instanceof OrdersMissing) {
            return { ok: false, kind: "orders-missing", message: error.message };
        }
        if (error instanceof ParseError) {
            return { ok: false, kind: "invalid", message: error.message };
        }
        throw error;
    }
}

const cell = (value: number | null): string => (value === null ? "-" : String(value));

export function renderIbkrTable(read: IbkrRead): string {
    const positions = [
        "## Positions",
        "",
        "| Ticker | Quantity |",
        "| --- | --- |",
        ...read.positions.map((position) => `| ${position.ticker} | ${position.quantity} |`),
    ];
    const orders =
        read.orders.length === 0
            ? ["No active orders."]
            : [
                  "| Ticker | Side | Quantity | Type | Limit | Trail % |",
                  "| --- | --- | --- | --- | --- | --- |",
                  ...read.orders.map(
                      (order) =>
                          `| ${order.ticker} | ${order.side} | ${order.quantity} | ${order.orderType} | ${cell(order.limitPrice)} | ${cell(order.trailPercent)} |`,
                  ),
              ];
    return [...positions, "", "## Active orders", "", ...orders].join("\n");
}
