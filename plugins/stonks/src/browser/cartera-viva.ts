// Cartera Viva collector (spec stonks-inputs "Cartera Viva read"). The page's
// title is "Cartera Viva"; its open positions are the `article` cards of the
// section headed "Posiciones abiertas", whose header also shows the
// "N posiciones" counter. The recently closed positions sit in a section of
// their own and are never read. The cards arrive after the page: until then
// the section holds placeholders and no counter, which the collector reports
// as `loading`, as it does a page that has rendered no title yet.
// It returns each card's visible text lines untouched; the engine parser reads
// ticker, name, average price and trailing out of them.

import { envelope } from "./envelope.ts";

const DATA = String.raw`(function () {
    var title = document.querySelector("h1");
    var heading = null;
    var headings = document.querySelectorAll("h2");
    for (var i = 0; i < headings.length && heading === null; i++) {
        if (/^posiciones abiertas$/i.test(txt(headings[i]))) {
            heading = headings[i];
        }
    }
    if (heading === null) {
        return { title: title ? txt(title) : null, heading: null, counter: null, loading: title === null, cards: [] };
    }
    var section = heading.closest("section") || heading.parentElement;
    var counter = null;
    var leaves = heading.parentElement.querySelectorAll("*");
    for (var j = 0; j < leaves.length && counter === null; j++) {
        if (leaves[j].children.length === 0 && /^\d+\s+posici/i.test(txt(leaves[j]))) {
            counter = txt(leaves[j]);
        }
    }
    var articles = section.querySelectorAll("article");
    var cards = [];
    for (var c = 0; c < articles.length; c++) {
        cards.push({
            texts: (articles[c].innerText || "")
                .split("\n")
                .map(function (line) { return line.trim(); })
                .filter(function (line) { return line.length > 0; })
        });
    }
    return {
        title: title ? txt(title) : null,
        heading: txt(heading),
        counter: counter,
        loading: counter === null || articles.length === 0,
        cards: cards
    };
})()`;

export function carteraVivaCollector(runId: string): string {
    return envelope("cartera-viva", runId, DATA);
}
