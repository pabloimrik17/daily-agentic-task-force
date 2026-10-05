// Watchlist collector and row actions (design D9, D10). Drafts; task 3.4
// confirms them on the real page. Nothing here scrolls: the page renders
// black when scrolled (D10), so only the rows already in the DOM are read.

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
    var all = document.querySelectorAll("main *, body *");
    for (var c = 0; c < all.length && counter === null; c++) {
        if (all[c].children.length === 0 && /^\d+\s*\/\s*\d+$/.test(txt(all[c]))) {
            counter = txt(all[c]);
        }
    }
    if (counter === null) {
        var m = /(\d+)\s*\/\s*(\d+)/.exec(document.body.innerText || "");
        counter = m ? m[0] : null;
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

/** Opens a row's menu: pointer events on the row's last button (design D10). */
export function watchlistRowMenuAction(runId: string, index: number): string {
    return envelope(
        "watchlist-row-menu",
        runId,
        String.raw`(function () {
    ${ROWS}
    var row = rows[${JSON.stringify(index)}];
    if (!row) {
        return { done: false, reason: "no such row" };
    }
    var buttons = row.querySelectorAll("button");
    var button = buttons[buttons.length - 1];
    if (!button) {
        return { done: false, reason: "row has no button" };
    }
    var names = ${POINTER_EVENTS};
    for (var e = 0; e < names.length; e++) {
        var type = names[e];
        var Ctor = type.indexOf("pointer") === 0 && window.PointerEvent ? PointerEvent : MouseEvent;
        button.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, view: window }));
    }
    return { done: true };
})()`,
    );
}

/** Clicks the visible "remove" menu item and returns the toast text seen, if any. */
export function removeFromMenuAction(runId: string): string {
    return envelope(
        "remove-from-menu",
        runId,
        String.raw`(function () {
    var candidates = document.querySelectorAll("[role=menuitem], [role=option], li, button, a, div");
    var item = null;
    for (var i = 0; i < candidates.length && item === null; i++) {
        var text = txt(candidates[i]);
        if (text.length > 0 && text.length < 40 && /remove|eliminar|quitar/i.test(text) && visible(candidates[i])) {
            item = candidates[i];
        }
    }
    if (item === null) {
        return { done: false, toast: null };
    }
    item.click();
    var toast = document.querySelector("[role=status], [role=alert], [class*=toast i], [class*=snackbar i]");
    return { done: true, toast: toast ? txt(toast) : null };
})()`,
    );
}
