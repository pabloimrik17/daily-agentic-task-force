/* eslint-disable @typescript-eslint/no-implied-eval -- running the sources on a fake page is the point (design D10) */
import { describe, expect, it } from "vitest";

import { formatListing } from "../domain.ts";
import { parseListing } from "../ticker.ts";
import { clickRowAction } from "./dropdown.ts";
import { watchlistRowMenuAction } from "./watchlist.ts";

// The row actions act on an index from an earlier read, so each checks that
// the row still shows what the engine chose before it dispatches anything.
// These run the printed sources on a page just rich enough for them.

const RUN = "run-fixture-1";
const ORIGIN = "https://simplywall.st";
const HOOL = "/stocks/us/tech/nasdaq-hool/hoolihan-systems";
const ACME = "/stocks/us/software/nyse-acme/acme-corp";

class FakeElement {
    readonly events: string[] = [];
    parent: FakeElement | null = null;

    constructor(
        readonly attributes: Record<string, string> = {},
        readonly textContent = "",
        readonly children: Record<string, FakeElement[]> = {},
    ) {}

    getAttribute(name: string): string | null {
        return this.attributes[name] ?? null;
    }

    querySelector(selector: string): FakeElement | null {
        return this.children[selector]?.[0] ?? null;
    }

    querySelectorAll(selector: string): FakeElement[] {
        return this.children[selector] ?? [];
    }

    /** Only a row matches: the watchlist's rows are `tr`. */
    closest(selector: string): FakeElement | null {
        return selector.startsWith("tr") ? this.parent : null;
    }

    getBoundingClientRect(): { width: number; height: number } {
        return { width: 1, height: 1 };
    }

    click(): void {
        this.events.push("click");
    }

    dispatchEvent(event: { type: string }): boolean {
        this.events.push(event.type);
        return true;
    }
}

interface Answer {
    data: { done: boolean; reason?: string };
}

/** Runs a source on a page whose `document.querySelectorAll` answers from `page`. */
function run(source: string, page: Record<string, FakeElement[]>): Answer {
    const document = { querySelectorAll: (selector: string) => page[selector] ?? [] };
    const location = { href: `${ORIGIN}/watchlist`, origin: ORIGIN, pathname: "/watchlist" };
    const getComputedStyle = () => ({ visibility: "visible", display: "block" });
    class MouseEvent {
        constructor(readonly type: string) {}
    }
    const evaluate = new Function(
        "document",
        "location",
        "getComputedStyle",
        "window",
        "MouseEvent",
        `return ${source};`,
    ) as (...globals: unknown[]) => Answer;
    return evaluate(document, location, getComputedStyle, {}, MouseEvent);
}

/** Watchlist rows, one per link, each with its More Options button. */
function watchlistPage(hrefs: string[]) {
    const anchors = hrefs.map((href) => new FakeElement({ href }));
    const buttons = anchors.map((anchor) => {
        const button = new FakeElement();
        anchor.parent = new FakeElement({}, "", {
            'a[href*="/stocks/"]': [anchor],
            'button[aria-label="More Options"]': [button],
        });
        return button;
    });
    return { buttons, page: { 'a[href*="/stocks/"]': anchors } };
}

/** Search results, one per symbol, each with the label a selection clicks. */
function dropdownPage(symbols: string[]) {
    const labels = symbols.map(() => new FakeElement({}, "Hoolihan Systems"));
    const results = labels.map(
        (label, index) =>
            new FakeElement({ "data-cy-id": `${symbols[index] ?? ""}-search-result` }, "", {
                '[data-cy-id="search-results-label"]': [label],
            }),
    );
    return { labels, page: { '[data-cy-id$="-search-result"]': results } };
}

describe("watchlist-row-menu", () => {
    it("opens the menu of the row that links to the expected path", () => {
        const { buttons, page } = watchlistPage([ACME, `${ORIGIN}${HOOL}`]);
        const answer = run(watchlistRowMenuAction(RUN, 1, HOOL), page);
        expect(answer.data).toEqual({ done: true });
        expect(buttons[1]?.events).toEqual([
            "pointerdown",
            "mousedown",
            "pointerup",
            "mouseup",
            "click",
        ]);
    });

    it("dispatches nothing when the row links elsewhere", () => {
        const { buttons, page } = watchlistPage([ACME, HOOL]);
        const answer = run(watchlistRowMenuAction(RUN, 0, HOOL), page);
        expect(answer.data).toEqual({
            done: false,
            reason: `the row links to ${ACME}, not ${HOOL}`,
        });
        expect(buttons.flatMap((button) => button.events)).toEqual([]);
    });
});

describe("click-row", () => {
    it("clicks the row that shows the expected listing", () => {
        const { labels, page } = dropdownPage(["NYSE:HOOL", "NasdaqGS:HOOL"]);
        const answer = run(clickRowAction(RUN, 1, "NasdaqGS:HOOL"), page);
        expect(answer.data).toEqual({ done: true });
        expect(labels.map((label) => label.events)).toEqual([[], ["click"]]);
    });

    it("clicks nothing when the row shows another listing", () => {
        const { labels, page } = dropdownPage(["NYSE:HOOL", "NasdaqGS:HOOL"]);
        const answer = run(clickRowAction(RUN, 0, "NasdaqGS:HOOL"), page);
        expect(answer.data).toEqual({
            done: false,
            reason: "the row shows NYSE:HOOL, not NasdaqGS:HOOL",
        });
        expect(labels.flatMap((label) => label.events)).toEqual([]);
    });

    it("writes a page symbol as the engine writes the selected listing", () => {
        for (const symbol of ["NasdaqGS:HOOL", " NYSE : brk/b ", "BMV:SHOP N"]) {
            const { labels, page } = dropdownPage([symbol]);
            const listing = parseListing(symbol);
            expect(listing).not.toBeNull();
            const answer = run(clickRowAction(RUN, 0, formatListing(listing!)), page);
            expect(answer.data.done).toBe(true);
            expect(labels[0]?.events).toEqual(["click"]);
        }
    });
});
