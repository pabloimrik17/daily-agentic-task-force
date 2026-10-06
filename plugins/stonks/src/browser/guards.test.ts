/* eslint-disable @typescript-eslint/no-implied-eval -- running the sources on a fake page is the point (design D10) */
import { describe, expect, it } from "vitest";

import { formatListing } from "../domain.ts";
import { parseListing } from "../ticker.ts";
import { carteraVivaCollector } from "./cartera-viva.ts";
import { clickRowAction } from "./dropdown.ts";
import { swsPortfolioCollector } from "./sws-portfolio.ts";
import { removeFromMenuAction, watchlistRowMenuAction } from "./watchlist.ts";

// The row actions act on an index from an earlier read, so each checks that
// the row still shows what the engine chose before it dispatches anything,
// and the collectors read only their page's own section. These run the
// printed sources on a page just rich enough for them.

const RUN = "run-fixture-1";
const ORIGIN = "https://simplywall.st";
const HOOL = "/stocks/us/tech/nasdaq-hool/hoolihan-systems";
const ACME = "/stocks/us/software/nyse-acme/acme-corp";
const WNYE = "/stocks/us/media/nyse-wnye/wynne-media";
const STOCK_LINKS = 'a[href*="/stocks/"]';

class FakeElement {
    readonly events: string[] = [];
    parentElement: FakeElement | null = null;
    /** Queries answer from `found`, not from a tree, so no fake has children of its own. */
    readonly children: FakeElement[] = [];

    constructor(
        readonly attributes: Record<string, string> = {},
        readonly textContent = "",
        readonly found: Record<string, FakeElement[]> = {},
        readonly tag = "",
    ) {}

    /** Nothing is laid out, so the rendered text is the text, lines and all. */
    get innerText(): string {
        return this.textContent;
    }

    getAttribute(name: string): string | null {
        return this.attributes[name] ?? null;
    }

    querySelector(selector: string): FakeElement | null {
        return this.found[selector]?.[0] ?? null;
    }

    querySelectorAll(selector: string): FakeElement[] {
        return this.found[selector] ?? [];
    }

    /** Matches on tags alone: the nearest of this element and its ancestors with one of them. */
    closest(selector: string): FakeElement | null {
        const tags = selector.split(",").map((part) => part.trim());
        return tags.includes(this.tag) ? this : (this.parentElement?.closest(selector) ?? null);
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
    data: Record<string, unknown>;
}

/** Runs a source on a page at `href` whose `document`, `body` included, answers from `page`. */
function run(
    source: string,
    page: Record<string, FakeElement[]>,
    href = `${ORIGIN}/watchlist`,
): Answer {
    const root = new FakeElement({}, "", page);
    const document = {
        body: root.querySelector("body"),
        querySelector: (selector: string) => root.querySelector(selector),
        querySelectorAll: (selector: string) => root.querySelectorAll(selector),
    };
    const { origin, pathname } = new URL(href);
    const location = { href, origin, pathname };
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
        anchor.parentElement = new FakeElement(
            {},
            "",
            { [STOCK_LINKS]: [anchor], 'button[aria-label="More Options"]': [button] },
            "tr",
        );
        return button;
    });
    return { buttons, page: { [STOCK_LINKS]: anchors } };
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

const TRADER = "https://example-trader.test/cartera";
const PORTFOLIO = "/portfolio/11111111-2222-4333-8444-555555555555";

/** A Cartera Viva card's lines, as the real page renders them (design D10). */
const HOOL_CARD = [
    "HOOL",
    "Tecnología",
    "Hoolihan Systems Inc.",
    "120 días",
    "PM",
    "98,40",
    "ACTUAL",
    "121,30",
    "OBJETIVO",
    "139,00",
    "+23,27%",
    "PESO 2,50%",
    "CARRERA AL OBJETIVO",
    "56%",
    "Ver análisis en Telegram",
    "En carrera",
    "Trailing 15%",
];

/**
 * The Cartera Viva as design D10 saw it: one open position's `article` card
 * in the section headed "Posiciones abiertas", whose header shows the
 * counter, and the recently closed positions as plain lines in a section of
 * their own. Their heading comes first, so only its text tells the two apart.
 */
function carteraVivaPage(card: string[], closed: string[]): Record<string, FakeElement[]> {
    const heading = new FakeElement({}, "Posiciones abiertas", {}, "h2");
    const header = new FakeElement({}, "", { "*": [heading, new FakeElement({}, "1 posición")] });
    const article = new FakeElement({}, card.join("\n"), {}, "article");
    heading.parentElement = header;
    header.parentElement = new FakeElement({}, "", { article: [article] }, "section");
    const closedHeading = new FakeElement({}, "Cerradas recientemente", {}, "h2");
    const lines = closed.map((line) => new FakeElement({}, line, {}, "p"));
    closedHeading.parentElement = new FakeElement(
        {},
        [closedHeading.textContent, ...closed].join("\n"),
        { "*": [closedHeading, ...lines] },
        "section",
    );
    return {
        h1: [new FakeElement({}, "Cartera Viva", {}, "h1")],
        h2: [closedHeading, heading],
        article: [article],
    };
}

/**
 * An SWS portfolio as design D10 saw it: a holding's stock link, whose text
 * is its ticker, inside `container`, which only a `table` makes the holdings
 * table; the page's counter; and a footer that links a trending stock.
 */
function swsPortfolioPage(container: "table" | "ul"): Record<string, FakeElement[]> {
    const holding = new FakeElement({ href: HOOL }, "HOOL", {}, "a");
    const holdings = new FakeElement({}, "HOOL", { [STOCK_LINKS]: [holding] }, container);
    const trending = new FakeElement({ href: WNYE }, "WNYE", {}, "a");
    holding.parentElement = holdings;
    trending.parentElement = new FakeElement({}, "Trending today: WNYE", {}, "footer");
    const links = [holding, trending];
    const text = "My Portfolio\n1 holding\nHOOL\nTrending today: WNYE";
    return {
        body: [new FakeElement({}, text, { [STOCK_LINKS]: links }, "body")],
        "table, [role=table], [role=grid]": container === "table" ? [holdings] : [],
        [STOCK_LINKS]: links,
    };
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

describe("remove-from-menu", () => {
    it("says why it clicked nothing when no menu is open", () => {
        const answer = run(removeFromMenuAction(RUN), {});
        expect(answer.data).toEqual({ done: false, reason: "no Remove item in an open menu" });
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

describe("cartera-viva", () => {
    it("reads the open positions' cards, not the recently closed positions", () => {
        const page = carteraVivaPage(HOOL_CARD, ["UMBR", "Umbrella Biotech", "+12,40%"]);
        const answer = run(carteraVivaCollector(RUN), page, TRADER);
        expect(answer.data).toEqual({
            title: "Cartera Viva",
            heading: "Posiciones abiertas",
            counter: "1 posición",
            loading: false,
            cards: [{ texts: HOOL_CARD }],
        });
        expect(JSON.stringify(answer.data)).not.toContain("UMBR");
    });
});

describe("sws-portfolio", () => {
    it.each([
        ["in the holdings table", "table"],
        ["on a page without one", "ul"],
    ] as const)("reads the holding links %s, not the footer's", (_, container) => {
        const answer = run(
            swsPortfolioCollector(RUN),
            swsPortfolioPage(container),
            `${ORIGIN}${PORTFOLIO}`,
        );
        expect(answer.data).toEqual({
            path: PORTFOLIO,
            count: 1,
            links: [{ href: HOOL, text: "HOOL" }],
        });
        expect(JSON.stringify(answer.data)).not.toContain("WNYE");
    });
});
