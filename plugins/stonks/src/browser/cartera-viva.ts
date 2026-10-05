// Cartera Viva collector (spec stonks-inputs "Cartera Viva read"). Draft; task
// 3.4 confirms it on the real page. It finds the section headed "Cartera
// Viva", drops every card that follows a closed/history heading, and returns
// each card's visible text lines untouched. Reading ticker, price, name and
// trailing out of those lines happens in the engine parser.

import { envelope } from "./envelope.ts";

const DATA = String.raw`(function () {
    var headings = document.querySelectorAll("h1, h2, h3, h4, h5, h6, [role=heading]");
    var heading = null;
    for (var i = 0; i < headings.length && heading === null; i++) {
        if (/cartera viva/i.test(txt(headings[i]))) {
            heading = headings[i];
        }
    }
    if (heading === null) {
        return { heading: null, cards: [] };
    }
    var section = heading.closest("section, [role=region]") || heading.parentElement || document.body;
    var closed = [];
    var inside = section.querySelectorAll("h1, h2, h3, h4, h5, h6, [role=heading]");
    for (var j = 0; j < inside.length; j++) {
        if (inside[j] !== heading && /cerrad|closed|histor/i.test(txt(inside[j]))) {
            closed.push(inside[j]);
        }
    }
    var afterClosed = function (el) {
        for (var k = 0; k < closed.length; k++) {
            if (closed[k].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) {
                return true;
            }
        }
        return false;
    };
    var families = ["article", "[class*=card i]", "li", "tr"];
    var cards = [];
    for (var f = 0; f < families.length && cards.length === 0; f++) {
        var found = section.querySelectorAll(families[f]);
        for (var c = 0; c < found.length; c++) {
            var el = found[c];
            var parentCard = el.parentElement && el.parentElement.closest(families[f]);
            if (parentCard && section.contains(parentCard)) {
                continue;
            }
            if (afterClosed(el)) {
                continue;
            }
            var lines = (el.innerText || "")
                .split("\n")
                .map(function (line) { return line.trim(); })
                .filter(function (line) { return line.length > 0; });
            if (lines.length > 0) {
                cards.push({ texts: lines });
            }
        }
    }
    return { heading: txt(heading), cards: cards };
})()`;

export function carteraVivaCollector(runId: string): string {
    return envelope("cartera-viva", runId, DATA);
}
