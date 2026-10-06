// Only the fields the checks use are parsed, because IBKR owns the schema
// (design D4). Inactive orders are dropped by a deny list, so an unknown status
// counts as active (a false finding beats a missed one, design D16). REPLACED
// is not on it: IBKR marks a user-modified order that way and it keeps working.
// A trail is a percentage only when the description says `%`; otherwise it
// stays unknown rather than derived.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ActiveOrder, IbkrRead, OrderType, Position } from "../domain.ts";
import { normaliseTicker } from "../ticker.ts";
import { array, object, ParseError, string, type Json } from "../validate.ts";

export type IbkrFailure = { kind: "needs-login" } | { kind: "unreadable"; message: string };

export type IbkrResult<T> = { ok: true; value: T } | { ok: false; error: IbkrFailure };

const POSITIONS_TOOL = "mcp__ibkr__get_account_positions";
const ORDERS_TOOL = "mcp__ibkr__get_account_orders";

const LOGIN_HINT = /auth|login|unauthori[sz]ed|\b401\b|token|expired|session/i;
const INACTIVE = new Set(["FILLED", "CANCELLED", "CANCELED", "INACTIVE", "REJECTED", "EXPIRED"]);
const DESCRIPTION = /^(?:Buy|Sell)\s+[\d.,]+\s+(\S+)$/i;
const TRAIL_PERCENT = /TRAIL\s+([\d.]+)\s*%/i;

const failure = (error: IbkrFailure): { ok: false; error: IbkrFailure } => ({ ok: false, error });

const unreadable = (message: string): { ok: false; error: IbkrFailure } =>
    failure({ kind: "unreadable", message });

function numeric(value: unknown): number | null {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function requireNumeric(row: Json, key: string, path: string): number {
    const value = numeric(row[key]);
    if (value === null) {
        throw new ParseError(`${path}.${key} must be a number`);
    }
    return value;
}

const ORDER_TYPES: Record<string, OrderType> = {
    LIMIT: "limit",
    LMT: "limit",
    TRAILING_STOP: "trailing-stop",
    TRAIL: "trailing-stop",
    TRAILING: "trailing-stop",
    STOP: "stop",
    STP: "stop",
    MARKET: "market",
    MKT: "market",
};

const orderType = (raw: string): OrderType =>
    Object.hasOwn(ORDER_TYPES, raw.toUpperCase()) ? ORDER_TYPES[raw.toUpperCase()]! : "other";

function readRoot<T>(
    text: string,
    input: string,
    key: string,
    read: (rows: unknown[]) => T,
): IbkrResult<T> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return LOGIN_HINT.test(text)
            ? failure({ kind: "needs-login" })
            : unreadable(`${input}: response is not JSON`);
    }
    try {
        const root = object(parsed, "response");
        return { ok: true, value: read(array(root[key], key)) };
    } catch (error) {
        if (error instanceof ParseError) {
            return LOGIN_HINT.test(text)
                ? failure({ kind: "needs-login" })
                : unreadable(`${input}: ${error.message}`);
        }
        throw error;
    }
}

export function parsePositions(text: string): IbkrResult<Position[]> {
    return readRoot(text, "IBKR positions", "positions", (rows) => {
        const positions: Position[] = [];
        rows.forEach((raw, index) => {
            const path = `positions[${index}]`;
            const row = object(raw, path);
            const description = string(row, "contract_description", path);
            if (description.trim() === "") {
                throw new ParseError(`${path}.contract_description must not be empty`);
            }
            const quantity = row.position;
            if (typeof quantity !== "number" || !Number.isFinite(quantity)) {
                throw new ParseError(`${path}.position must be a finite number`);
            }
            if (quantity !== 0) {
                positions.push({ ticker: normaliseTicker(description), quantity });
            }
        });
        return positions;
    });
}

function readSide(row: Json, path: string): "buy" | "sell" {
    const side = string(row, "side", path).toUpperCase();
    if (side !== "BUY" && side !== "SELL") {
        throw new ParseError(`${path}.side must be BUY or SELL`);
    }
    return side === "BUY" ? "buy" : "sell";
}

function readTicker(row: Json, path: string): string {
    const match = DESCRIPTION.exec(string(row, "primary_description", path).trim());
    if (match?.[1] === undefined) {
        throw new ParseError(`${path}.primary_description must read "Buy|Sell <qty> <ticker>"`);
    }
    return normaliseTicker(match[1]);
}

function readTrailPercent(row: Json): number | null {
    const secondary =
        typeof row.secondary_description === "string" ? row.secondary_description : "";
    const trail = TRAIL_PERCENT.exec(secondary)?.[1];
    return trail === undefined ? null : Number(trail);
}

function readOrder(raw: unknown, index: number): ActiveOrder | null {
    const path = `orders[${index}]`;
    const row = object(raw, path);
    const status = typeof row.order_status === "string" ? row.order_status.toUpperCase() : "";
    if (INACTIVE.has(status)) {
        return null;
    }
    const side = readSide(row, path);
    const type = orderType(string(row, "order_type", path));
    const total = requireNumeric(row, "total_shares_qty", path);
    const quantity = numeric(row.remaining_shares_qty) ?? total;
    const ticker = readTicker(row, path);
    return {
        ticker,
        side,
        quantity,
        orderType: type,
        limitPrice: type === "limit" ? requireNumeric(row, "limit_price", path) : null,
        trailPercent: type === "trailing-stop" ? readTrailPercent(row) : null,
    };
}

export function parseOrders(text: string): IbkrResult<ActiveOrder[]> {
    return readRoot(text, "IBKR orders", "orders", (rows) => {
        const orders: ActiveOrder[] = [];
        rows.forEach((raw, index) => {
            const order = readOrder(raw, index);
            if (order !== null) {
                orders.push(order);
            }
        });
        return orders;
    });
}

function newest(rawDir: string, kind: string): string | null {
    let names: string[];
    try {
        names = readdirSync(rawDir);
    } catch {
        return null;
    }
    const match = names.filter((name) => name.endsWith(`-${kind}.json`)).sort();
    const last = match.at(-1);
    return last === undefined ? null : readFileSync(join(rawDir, last), "utf8");
}

/** The newest capture of each IBKR read in the run's raw directory. */
export function readIbkr(rawDir: string): IbkrResult<IbkrRead> {
    const positionsText = newest(rawDir, POSITIONS_TOOL);
    if (positionsText === null) {
        return unreadable("IBKR positions: no capture in this run");
    }
    const ordersText = newest(rawDir, ORDERS_TOOL);
    if (ordersText === null) {
        return unreadable("IBKR orders: no capture in this run");
    }
    const positions = parsePositions(positionsText);
    if (!positions.ok) {
        return positions;
    }
    const orders = parseOrders(ordersText);
    if (!orders.ok) {
        return orders;
    }
    return {
        ok: true,
        value: { provenance: "mcp", positions: positions.value, orders: orders.value },
    };
}
