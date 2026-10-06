// SWS portfolio collector (design D8), confirmed on the real page in task
// 3.4. It gathers facts only: the holding rows' stock links, the page's own
// holdings counter and the path. Links outside the holdings table or list (footer, navigation)
// are not gathered, so a footer ticker never reaches the engine.

import { envelope } from "./envelope.ts";

const DATA = String.raw`(function () {
    var scope =
        document.querySelector("table, [role=table], [role=grid]") ||
        document.querySelector("main") ||
        document.body;
    var anchors = scope.querySelectorAll('a[href*="/stocks/"]');
    var links = [];
    for (var i = 0; i < anchors.length; i++) {
        var a = anchors[i];
        if (a.closest("footer, nav, header")) {
            continue;
        }
        links.push({ href: a.getAttribute("href") || "", text: txt(a) });
    }
    var count = null;
    var match = /(\d+)\s+holdings?/i.exec(document.body.innerText || "");
    if (match) {
        count = parseInt(match[1], 10);
    }
    return { path: location.pathname, count: count, links: links };
})()`;

export function swsPortfolioCollector(runId: string): string {
    return envelope("sws-portfolio", runId, DATA);
}
