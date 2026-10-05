// Movimientos (spec stonks-report): what changed in IBKR between the previous
// run's snapshot and the current read. Pure; the snapshot is only ever used for
// this and for the repeat counters, never as an input to a check.

import type { ActiveOrder, Movement, Position, Snapshot } from "../domain.ts";
import { samePrice, sameQuantity } from "../ticker.ts";

/** The capture carries no stable order id, so orders are matched on these fields. */
function sameOrder(a: ActiveOrder, b: ActiveOrder): boolean {
    return (
        a.ticker === b.ticker &&
        a.side === b.side &&
        sameQuantity(a.quantity, b.quantity) &&
        a.orderType === b.orderType &&
        (a.limitPrice === null || b.limitPrice === null
            ? a.limitPrice === b.limitPrice
            : samePrice(a.limitPrice, b.limitPrice))
    );
}

/** Multiset difference: `from` minus the orders also present in `other`, one for one. */
function unmatched(from: ActiveOrder[], other: ActiveOrder[]): ActiveOrder[] {
    const pool = [...other];
    const rest: ActiveOrder[] = [];
    for (const order of from) {
        const at = pool.findIndex((candidate) => sameOrder(order, candidate));
        if (at === -1) {
            rest.push(order);
        } else {
            pool.splice(at, 1);
        }
    }
    return rest;
}

function held(positions: Position[], ticker: string): number {
    return positions.filter((p) => p.ticker === ticker).reduce((sum, p) => sum + p.quantity, 0);
}

const byTicker = (a: Movement, b: Movement): number => a.ticker.localeCompare(b.ticker);

/** Consumes `remaining` as it explains a disappeared order, so one change cannot absorb two orders. */
function classifyGone(order: ActiveOrder, remaining: Map<string, number>): Movement {
    const change = remaining.get(order.ticker) ?? 0;
    const buy = order.side === "buy";
    const explained = buy ? change : -change;
    if (explained <= 1e-6) {
        return {
            kind: "cancelled-order",
            ticker: order.ticker,
            quantity: order.quantity,
            side: order.side,
        };
    }
    const quantity = Math.min(order.quantity, explained);
    remaining.set(order.ticker, change + (buy ? -quantity : quantity));
    return {
        kind: buy ? "fill" : "triggered-sell",
        ticker: order.ticker,
        quantity,
        side: order.side,
    };
}

function newOrder(order: ActiveOrder): Movement {
    return { kind: "new-order", ticker: order.ticker, quantity: order.quantity, side: order.side };
}

function positionChanges(previous: Position[], current: Position[]): Map<string, number> {
    const remaining = new Map<string, number>();
    for (const ticker of new Set([...previous, ...current].map((p) => p.ticker))) {
        remaining.set(ticker, held(current, ticker) - held(previous, ticker));
    }
    return remaining;
}

/**
 * Empty when there is no previous snapshot (the report then says so). A
 * disappeared buy order beside a grown position is a fill; a disappeared sell
 * order beside a shrunk or closed position is a triggered sell; any other
 * disappeared order is cancelled. Each position change explains at most its own
 * size, so one change cannot absorb two orders.
 */
export function movements(
    previous: Snapshot | null,
    current: { positions: Position[]; orders: ActiveOrder[] },
): Movement[] {
    if (previous === null) {
        return [];
    }
    const remaining = positionChanges(previous.positions, current.positions);
    const gone = unmatched(previous.orders, current.orders).map((order) =>
        classifyGone(order, remaining),
    );
    const created = unmatched(current.orders, previous.orders).map(newOrder);

    const ofKind = (kind: Movement["kind"], list: Movement[]): Movement[] =>
        list.filter((m) => m.kind === kind).sort(byTicker);
    return [
        ...ofKind("fill", gone),
        ...ofKind("triggered-sell", gone),
        ...created.sort(byTicker),
        ...ofKind("cancelled-order", gone),
    ];
}
