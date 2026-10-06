// Watchlist collector and row actions (design D9, D10). The Remove
// confirmation, "Removed from watchlist", names no ticker and stays in the
// page for minutes, so no action reads it: a fresh read verifies each
// change. Nothing here scrolls: the page renders black when scrolled (D10),
// and every row is already in the DOM.

import { envelope } from "./envelope.ts";

/**
 * Defines `rows`: one element per watchlist row, the closest row container of
 * each stock link outside footer, navigation and header, in document order.
 * The collector and the row actions share it so that an index means one row.
 */
const ROWS = String.raw`var rows = [];
    var anchors = document.querySelectorAll('a[href*="/stocks/"]');
    for (var r = 0; r < anchors.length; r++) {
        if (anchors[r].closest("footer, nav, header")) {
            continue;
        }
        var row = anchors[r].closest("tr, [role=row], li") || anchors[r].parentElement;
        if (row && rows.indexOf(row) === -1) {
            rows.push(row);
        }
    }`;

const UNIQUE_SYMBOL = String.raw`var uniqueSymbolOf = function (row) {
        var nodes = [row].concat(Array.prototype.slice.call(row.querySelectorAll("*")));
        for (var n = 0; n < nodes.length; n++) {
            var attributes = nodes[n].attributes;
            for (var k = 0; k < attributes.length; k++) {
                var name = attributes[k].name.replace(/-/g, "").toLowerCase();
                if (name.indexOf("data") === 0 && name.indexOf("uniquesymbol") !== -1) {
                    return attributes[k].value;
                }
            }
        }
        var embedded = /uniqueSymbol\\?["']?\s*[:=]\s*\\?["']([A-Za-z]+:[A-Za-z0-9.\-]+)/.exec(row.outerHTML);
        return embedded ? embedded[1] : null;
    };`;

const COLLECT = String.raw`(function () {
    ${ROWS}
    ${UNIQUE_SYMBOL}
    var heading = document.querySelector("main h1, h1, main h2");
    var counter = null;
    var all = document.querySelectorAll("body *");
    for (var c = 0; c < all.length && counter === null; c++) {
        if (all[c].children.length === 0 && /^\d+\s*\/\s*\d+(\s+stocks?)?$/i.test(txt(all[c]))) {
            counter = txt(all[c]);
        }
    }
    var items = [];
    for (var i = 0; i < rows.length; i++) {
        var link = rows[i].querySelector('a[href*="/stocks/"]');
        items.push({
            href: link ? link.getAttribute("href") || "" : "",
            text: link ? txt(link) : "",
            uniqueSymbol: uniqueSymbolOf(rows[i])
        });
    }
    return { title: heading ? txt(heading) : null, counter: counter, rows: items };
})()`;

export function watchlistCollector(runId: string): string {
    return envelope("watchlist", runId, COLLECT);
}

const POINTER_EVENTS = '["pointerdown", "mousedown", "pointerup", "mouseup", "click"]';

/**
 * Opens a row's menu: mouse-typed pointer events on the row's "More Options"
 * button (design D10). On the real page events without a
 * `pointerType` leave the menu closed, and the menu renders after this
 * returns, so the result cannot report it open.
 *
 * The index comes from an earlier read, so the row must still link to `path`,
 * the link path that read showed for it; otherwise nothing is dispatched.
 */
export function watchlistRowMenuAction(runId: string, index: number, path: string): string {
    return envelope(
        "watchlist-row-menu",
        runId,
        String.raw`(function () {
    ${ROWS}
    var row = rows[${JSON.stringify(index)}];
    if (!row) {
        return { done: false, reason: "no such row" };
    }
    var link = row.querySelector('a[href*="/stocks/"]');
    var shown = link ? new URL(link.getAttribute("href") || "", location.origin).pathname : null;
    if (shown !== ${JSON.stringify(path)}) {
        return { done: false, reason: "the row links to " + shown + ", not " + ${JSON.stringify(path)} };
    }
    var button = row.querySelector('button[aria-label="More Options"]');
    if (!button) {
        return { done: false, reason: "row has no More Options button" };
    }
    var names = ${POINTER_EVENTS};
    for (var e = 0; e < names.length; e++) {
        var type = names[e];
        var Ctor = type.indexOf("pointer") === 0 && window.PointerEvent ? PointerEvent : MouseEvent;
        button.dispatchEvent(
            new Ctor(type, {
                bubbles: true,
                cancelable: true,
                view: window,
                pointerId: 1,
                pointerType: "mouse",
                isPrimary: true,
                button: 0,
                buttons: type === "pointerdown" || type === "mousedown" ? 1 : 0
            })
        );
    }
    return { done: true };
})()`,
    );
}

/** Clicks the open menu's "Remove" item, and only a menu item whose whole text is that word. */
export function removeFromMenuAction(runId: string): string {
    return envelope(
        "remove-from-menu",
        runId,
        String.raw`(function () {
    var candidates = document.querySelectorAll("[role=menu] [role=menuitem]");
    var item = null;
    for (var i = 0; i < candidates.length && item === null; i++) {
        if (/^(remove|eliminar|quitar)$/i.test(txt(candidates[i])) && visible(candidates[i])) {
            item = candidates[i];
        }
    }
    if (item === null) {
        return { done: false, reason: "no Remove item in an open menu" };
    }
    item.click();
    return { done: true };
})()`,
    );
}
