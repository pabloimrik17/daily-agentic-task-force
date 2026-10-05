// The "Add stock" panel and its search dropdown (design D10, D11 steps 3-6).
// Drafts; task 3.4 confirms the selectors on the real page. Typing the search
// term is not here: it needs real keystrokes (`computer` `type`).

import { envelope } from "./envelope.ts";

/** Defines `rows`: the search result rows, in the order shown. */
const ROWS = String.raw`var rows = Array.prototype.slice.call(
        document.querySelectorAll("[role=option], [role=listbox] li, li[class*=result i], [class*=SearchResult i]")
    ).filter(visible);`;

/** Moves the "Add stock" panel into view with CSS (design D10). */
export function repositionAddPanelAction(runId: string): string {
    return envelope(
        "reposition-add-panel",
        runId,
        String.raw`(function () {
    var all = document.querySelectorAll("h1, h2, h3, h4, h5, h6, [role=heading], button, div, span");
    var label = null;
    for (var i = 0; i < all.length && label === null; i++) {
        if (/^add stock$/i.test(txt(all[i]))) {
            label = all[i];
        }
    }
    if (label === null) {
        return { done: false, reason: "no Add stock panel" };
    }
    var panel =
        label.closest("[role=dialog], [class*=popover i], [class*=modal i], [class*=panel i]") ||
        (label.parentElement && label.parentElement.parentElement) ||
        label;
    var style = {
        position: "fixed",
        top: "0",
        left: "0",
        "max-height": "100vh",
        overflow: "auto",
        "z-index": "99999"
    };
    for (var name in style) {
        panel.style.setProperty(name, style[name], "important");
    }
    return { done: true };
})()`,
    );
}

/** Clicks every "+ N listings" expander. */
export function expandListingsAction(runId: string): string {
    return envelope(
        "expand-listings",
        runId,
        String.raw`(function () {
    var all = document.querySelectorAll("button, a, span, div, li");
    var clicked = 0;
    for (var i = 0; i < all.length; i++) {
        var text = txt(all[i]);
        if (text.length < 40 && /\+\s*\d+\s*listings?/i.test(text) && visible(all[i])) {
            all[i].click();
            clicked++;
        }
    }
    return { done: clicked > 0, clicked: clicked };
})()`,
    );
}

/** Every result row with its index, label and exchange-qualified symbol. */
export function dropdownCollector(runId: string): string {
    return envelope(
        "dropdown",
        runId,
        String.raw`(function () {
    ${ROWS}
    return {
        rows: rows.map(function (row, index) {
            var lines = (row.innerText || "").split("\n").map(function (line) { return line.trim(); });
            var text = lines.join(" ");
            var symbol = /\b([A-Za-z]+:[A-Z0-9][A-Z0-9.\-]*)/.exec(text);
            var label = lines.filter(function (line) { return line.length > 0; })[0] || "";
            return { index: index, label: label, symbol: symbol ? symbol[1] : null };
        })
    };
})()`,
    );
}

/** Clicks result row `index` and returns the toast text seen, if any. */
export function clickRowAction(runId: string, index: number): string {
    return envelope(
        "click-row",
        runId,
        String.raw`(function () {
    ${ROWS}
    var row = rows[${JSON.stringify(index)}];
    if (!row) {
        return { done: false, toast: null };
    }
    row.click();
    var toast = document.querySelector("[role=status], [role=alert], [class*=toast i], [class*=snackbar i]");
    return { done: true, toast: toast ? txt(toast) : null };
})()`,
    );
}
