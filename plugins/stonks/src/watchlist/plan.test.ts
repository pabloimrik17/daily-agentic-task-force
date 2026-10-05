import { describe, expect, it } from "vitest";

import type { WatchlistRead } from "../domain.ts";
import { plan, steps } from "./plan.ts";

const watchlist = (tickers: string[], capacity = 50): WatchlistRead => ({
    title: "Roger",
    items: tickers.map((ticker) => ({ listing: { exchange: "NYSE", ticker }, link: null })),
    count: tickers.length,
    capacity,
});

describe("plan", () => {
    it("adds a desired ticker the user removed by hand", () => {
        const result = plan(["GLBX", "HOOL"], watchlist(["HOOL"]));
        expect(result.additions).toEqual(["GLBX"]);
        expect(result.removals).toEqual([]);
    });

    it("changes nothing when the watchlist equals the desired set", () => {
        const result = plan(["GLBX", "HOOL"], watchlist(["HOOL", "GLBX"]));
        expect(result.additions).toEqual([]);
        expect(result.removals).toEqual([]);
        expect(steps(result)).toEqual([]);
    });

    it("orders both removals before both additions on a full watchlist", () => {
        const full = Array.from({ length: 48 }, (_, i) => `T${String(i).padStart(2, "0")}`);
        const result = plan([...full, "HOOL", "ACME"], watchlist([...full, "OSCP", "ZZZZ"]));
        expect(steps(result)).toEqual([
            { kind: "remove", ticker: "OSCP" },
            { kind: "remove", ticker: "ZZZZ" },
            { kind: "add", ticker: "ACME" },
            { kind: "add", ticker: "HOOL" },
        ]);
    });

    it("changes nothing and reports both numbers when the desired set exceeds capacity", () => {
        const desired = Array.from({ length: 52 }, (_, i) => `D${String(i).padStart(2, "0")}`);
        const result = plan(desired, watchlist(["OSCP"], 50));
        expect(result.removals).toEqual([]);
        expect(result.additions).toEqual([]);
        expect(result.overCapacity).toEqual({ desired: 52, capacity: 50 });
        expect(steps(result)).toEqual([]);
    });

    it("resumes an interrupted run with only the missing additions", () => {
        const result = plan(["ACME", "GLBX", "HOOL"], watchlist(["GLBX"]));
        expect(result.additions).toEqual(["ACME", "HOOL"]);
        expect(result.overCapacity).toBeNull();
    });

    it("compares by normalised symbol", () => {
        const result = plan(["brk b"], watchlist(["BRK.B"]));
        expect(steps(result)).toEqual([]);
    });
});
