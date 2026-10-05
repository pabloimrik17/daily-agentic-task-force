// The JavaScript prelude every collector and action shares (design D5, D10).
// The sources are plain strings, never serialised functions. The result is
// the envelope the capture hook recognises: the collector's name and version,
// the run, the page, whether the page is a login wall, and the gathered data.
//
// Inside `dataExpression` these helpers are in scope: `visible(el)` and
// `txt(el)` (trimmed, whitespace-collapsed text content).

/** Text that marks a login form or heading, in English and Spanish. */
const LOGIN_TEXT = String.raw`/log\s?in|sign\s?in|iniciar\s+sesi[oó]n|acceder/i`;

const LOGIN_PATH = String.raw`/\/(login|signin|sign-in)/i`;

/** Draft heuristics (task 3.4 confirms them on the real logged-out pages). */
const LOGIN_WALL = String.raw`(function () {
    if (${LOGIN_PATH}.test(location.pathname)) {
        return true;
    }
    var passwords = document.querySelectorAll("input[type=password]");
    for (var i = 0; i < passwords.length; i++) {
        if (visible(passwords[i])) {
            return true;
        }
    }
    var forms = document.querySelectorAll("form");
    for (var j = 0; j < forms.length; j++) {
        if (${LOGIN_TEXT}.test(forms[j].getAttribute("action") || "")) {
            return true;
        }
    }
    var headings = document.querySelectorAll("h1, h2, h3, [role=heading]");
    for (var k = 0; k < headings.length; k++) {
        if (visible(headings[k]) && ${LOGIN_TEXT}.test(txt(headings[k]))) {
            return true;
        }
    }
    return false;
})()`;

/** An IIFE whose value is the collector's envelope. */
export function envelope(collector: string, runId: string, dataExpression: string): string {
    return String.raw`(function () {
    var visible = function (el) {
        if (!el || !el.getBoundingClientRect) {
            return false;
        }
        var box = el.getBoundingClientRect();
        var style = getComputedStyle(el);
        return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    var txt = function (el) {
        return ((el && el.textContent) || "").replace(/\s+/g, " ").trim();
    };
    var data = null;
    try {
        data = (${dataExpression});
    } catch (error) {
        data = { error: String(error) };
    }
    return {
        stonks: ${JSON.stringify(`${collector}.v1`)},
        run: ${JSON.stringify(runId)},
        url: location.href,
        loginWall: ${LOGIN_WALL},
        data: data
    };
})()`;
}
