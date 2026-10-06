/* eslint-disable @typescript-eslint/no-implied-eval -- compiling the sources is the point (design D10) */
import { describe, expect, it } from "vitest";

import { ACTIONS, actionSource, COLLECTORS, collectorSource } from "./index.ts";

const RUN = "run-fixture-1";

/** What each row action takes: the row index and what that row must show. */
const ARGS: Record<string, string[]> = {
    "watchlist-row-menu": ["3", "/stocks/us/tech/nasdaq-hool/hoolihan-systems"],
    "click-row": ["3", "NasdaqGS:HOOL"],
};

describe("browser sources compile (design D10)", () => {
    for (const name of Object.keys(COLLECTORS)) {
        it(`collector ${name}`, () => {
            const result = collectorSource(name, RUN);
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(() => new Function(result.source)).not.toThrow();
                expect(result.source).toContain(JSON.stringify(`${RUN}`));
            }
        });
    }
    for (const name of Object.keys(ACTIONS)) {
        it(`action ${name}`, () => {
            const result = actionSource(name, RUN, ARGS[name] ?? []);
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(() => new Function(result.source)).not.toThrow();
            }
        });
    }

    it("quotes a hostile run id safely", () => {
        const result = collectorSource("watchlist", 'x"; alert(1); "');
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(() => new Function(result.source)).not.toThrow();
        }
    });

    it("rejects an unknown name, a bad index and a row action without what the row must show", () => {
        expect(collectorSource("nope", RUN).ok).toBe(false);
        expect(actionSource("click-row", RUN, ["x", "NasdaqGS:HOOL"]).ok).toBe(false);
        expect(actionSource("click-row", RUN, []).ok).toBe(false);
        expect(actionSource("click-row", RUN, ["3"]).ok).toBe(false);
        expect(actionSource("click-row", RUN, ["3", " "]).ok).toBe(false);
        expect(actionSource("watchlist-row-menu", RUN, ["3"]).ok).toBe(false);
    });
});
