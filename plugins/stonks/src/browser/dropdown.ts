// The "Add stock" search box and its dropdown (design D10, D11 steps 3-6).
// Typing the search term is not here: it needs real keystrokes (`computer` `type`), into the box
// `reposition-add-panel` leaves focused. An addition shows no confirmation, so
// `click-row` reports only that it clicked; a fresh read verifies the change.
//
// The page's own test hooks anchor most selectors. The results list is
// `[data-cy-id="search-results-list"]`; each result is a
// `[data-cy-id="<EXCHANGE>:<TICKER>-search-result"]` element whose company
// name is its `[data-cy-id="search-results-label"]` heading. Selecting a
// result is handled by an element inside it, so a click on the result element
// itself adds nothing; the click goes to the label, which bubbles through that
// handler. The "+ N listings" expander is a button inside the result that
// stops propagation, so clicking that button alone never selects anything.
// The listings it reveals are `li` items nested in the result, each with its
// symbol in a `p` and its own selection handler; the company's handler is not
// among their ancestors, so a click on a listing's symbol selects that listing
// alone.

import { envelope } from "./envelope.ts";

const RESULT_SUFFIX = "-search-result";

/**
 * Defines `rows`: every visible result and expanded listing, in the order
 * shown, as `{ label, symbol, target }`, where `target` is the element a
 * selection clicks. A listing carries its company's name.
 */
const ROWS = String.raw`var rows = [];
    var results = document.querySelectorAll('[data-cy-id$="${RESULT_SUFFIX}"]');
    for (var r = 0; r < results.length; r++) {
        if (!visible(results[r])) {
            continue;
        }
        var id = results[r].getAttribute("data-cy-id") || "";
        var label = results[r].querySelector('[data-cy-id="search-results-label"]');
        rows.push({ label: txt(label), symbol: id.slice(0, id.length - ${JSON.stringify(RESULT_SUFFIX.length)}), target: label });
        var listings = results[r].querySelectorAll("li");
        for (var l = 0; l < listings.length; l++) {
            if (visible(listings[l])) {
                var symbol = listings[l].querySelector("p");
                rows.push({ label: txt(label), symbol: txt(symbol), target: symbol });
            }
        }
    }`;

/** Defines `searchBox()`: the Add stock search box, outside header and navigation. */
const SEARCH_BOX = String.raw`var searchBox = function () {
        var inputs = document.querySelectorAll("input[type=search]");
        for (var i = 0; i < inputs.length; i++) {
            if (!inputs[i].closest("header, nav")) {
                return inputs[i];
            }
        }
        return null;
    };`;

/**
 * Opens the Add stock search box when it is still the "Add stock" button,
 * moves it into view with CSS (design D10) and focuses it: the box sits below
 * the table, scrolling the watchlist page renders it black, and a click on the
 * moved box did not focus it on the real page.
 */
export function repositionAddPanelAction(runId: string): string {
    return envelope(
        "reposition-add-panel",
        runId,
        String.raw`(function () {
    ${SEARCH_BOX}
    var input = searchBox();
    if (input === null) {
        var buttons = document.querySelectorAll("button");
        for (var i = 0; i < buttons.length; i++) {
            if (/^add stock$/i.test(txt(buttons[i]))) {
                buttons[i].click();
                break;
            }
        }
        input = searchBox();
    }
    if (input === null) {
        return { done: false, reason: "the Add stock search box is not open yet; run this action again" };
    }
    var box = input.closest("fieldset") || input.parentElement;
    var style = { position: "fixed", top: "120px", left: "300px", "z-index": "99999" };
    for (var name in style) {
        box.style.setProperty(name, style[name], "important");
    }
    input.focus();
    return { done: true, focused: document.activeElement === input };
})()`,
    );
}

/** Clicks the "+ N listings" buttons of the search results, and nothing else. */
export function expandListingsAction(runId: string): string {
    return envelope(
        "expand-listings",
        runId,
        String.raw`(function () {
    var buttons = document.querySelectorAll('[data-cy-id="search-results-list"] button');
    var clicked = 0;
    for (var i = 0; i < buttons.length; i++) {
        if (/^\+\s*\d+\s*listings?$/i.test(txt(buttons[i])) && visible(buttons[i])) {
            buttons[i].click();
            clicked++;
        }
    }
    return { done: clicked > 0, clicked: clicked };
})()`,
    );
}

/** Every result row with its index, company name and exchange-qualified symbol. */
export function dropdownCollector(runId: string): string {
    return envelope(
        "dropdown",
        runId,
        String.raw`(function () {
    ${ROWS}
    return {
        rows: rows.map(function (row, index) {
            return { index: index, label: row.label, symbol: row.symbol === "" ? null : row.symbol };
        })
    };
})()`,
    );
}

/** Clicks row `index` through its target. */
export function clickRowAction(runId: string, index: number): string {
    return envelope(
        "click-row",
        runId,
        String.raw`(function () {
    ${ROWS}
    var row = rows[${JSON.stringify(index)}];
    if (!row || !row.target) {
        return { done: false };
    }
    row.target.click();
    return { done: true };
})()`,
    );
}
