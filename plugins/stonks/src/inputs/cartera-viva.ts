// Cartera Viva parser. The collector returns each card's visible text lines;
// everything below is a DRAFT heuristic, to be confirmed on the real page in
// task 3.4:
//   - ticker: the first line that is only 1-5 upper-case letters, optionally
//     with a class suffix (`BRK.B`), and is not a known label such as `USD`;
//   - name: the first line that is not the ticker, not a number and not a
//     label (a `Label:` line or one starting with a known label word), else null;
//   - average price: the first number on a line matching
//     /precio|medio|avg|average/i (or on the next line when that one has no
//     number), else the first currency-looking number outside a trailing line;
//   - trailing: a /trailing/i line, together with the line after it, that
//     matches /activ/i without a negation ("no activado", "desactivado") is
//     activated, its percentage taken from /(\d+(?:[.,]\d+)?)\s*%/ when shown
//     (null otherwise); anything else is not activated.

import type { CarteraVivaCard, CarteraVivaRead, TraderTrailing } from "../domain.ts";
import { normaliseTicker } from "../ticker.ts";
import { array, object, stringArray } from "../validate.ts";
import { guard, type ReadResult, unreadable, validateEnvelope } from "./envelope.ts";

const TICKER = /^[A-Z]{1,5}(?:[./-][A-Z])?$/;
const NOT_TICKERS = new Set(["USD", "EUR", "GBP", "ROI", "PNL", "TSL", "SL", "TP", "N/A", "NA"]);
const NUMBER_LINE = /^[-+]?[$€£]?\s*[\d.,]+\s*[$€£%]?$/;
const LABEL_LINE =
    /:$|^(?:precio|trailing|stop|cantidad|beneficio|rentabilidad|average|avg|entrada|estado)\b|precio|medio|avg|average|trailing|activ/i;
const PRICE_LABEL = /precio|medio|avg|average/i;
const CURRENCY_NUMBER = /[$€£]\s*[\d.,]*\d|[\d.,]*\d\s*[$€£]/;
const PERCENT = /(\d+(?:[.,]\d+)?)\s*%/;
const NEGATED_ACTIVE = /no\s+activ|desactiv|inactiv|not\s+activ/i;

/** `1,234.56`, `1.234,56` and `12,5` all read; null when no number is found. */
function parseAmount(text: string): number | null {
    const match = /\d[\d.,]*/.exec(text);
    if (match === null) {
        return null;
    }
    let digits = match[0].replace(/[.,]+$/, "");
    const lastDot = digits.lastIndexOf(".");
    const lastComma = digits.lastIndexOf(",");
    if (lastDot !== -1 && lastComma !== -1) {
        const decimal = lastDot > lastComma ? "." : ",";
        digits = digits.split(decimal === "." ? "," : ".").join("");
        digits = digits.replace(decimal, ".");
    } else if (lastComma !== -1) {
        digits = /,\d{3}$/.test(digits) ? digits.replaceAll(",", "") : digits.replace(",", ".");
    }
    const value = Number(digits);
    return Number.isFinite(value) ? value : null;
}

function averagePrice(lines: string[]): number | null {
    for (const [index, line] of lines.entries()) {
        if (PRICE_LABEL.test(line)) {
            const value = parseAmount(line) ?? parseAmount(lines[index + 1] ?? "");
            if (value !== null) {
                return value;
            }
        }
    }
    const priced = lines.find((line) => CURRENCY_NUMBER.test(line) && !/%|trailing/i.test(line));
    return priced === undefined ? null : parseAmount(priced);
}

function trailingOf(lines: string[]): TraderTrailing {
    for (const [index, line] of lines.entries()) {
        if (!/trailing/i.test(line)) {
            continue;
        }
        const group = `${line} ${lines[index + 1] ?? ""}`;
        if (/activ/i.test(group) && !NEGATED_ACTIVE.test(group)) {
            const percent = PERCENT.exec(group);
            return {
                activated: true,
                percent: percent === null ? null : Number(percent[1]?.replace(",", ".")),
            };
        }
    }
    return { activated: false };
}

function parseCard(lines: string[]): CarteraVivaCard | null {
    const tickerLine = lines.find((line) => TICKER.test(line) && !NOT_TICKERS.has(line));
    if (tickerLine === undefined) {
        return null;
    }
    const name = lines.find(
        (line) => line !== tickerLine && !NUMBER_LINE.test(line) && !LABEL_LINE.test(line),
    );
    return {
        ticker: normaliseTicker(tickerLine),
        averagePrice: averagePrice(lines),
        trailing: trailingOf(lines),
        name: name ?? null,
    };
}

export function parseCarteraViva(envelope: unknown, runId: string): ReadResult<CarteraVivaRead> {
    const checked = validateEnvelope(envelope, "cartera-viva", runId);
    if (!checked.ok) {
        return checked;
    }
    return guard(() => {
        const data = checked.value.data;
        if (typeof data.heading !== "string" || !/cartera viva/i.test(data.heading)) {
            return unreadable("the page has no Cartera Viva section");
        }
        const cards: CarteraVivaCard[] = [];
        for (const [index, raw] of array(data.cards, "cartera-viva.data.cards").entries()) {
            const lines = stringArray(
                object(raw, `cartera-viva.data.cards[${index}]`),
                "texts",
                `cartera-viva.data.cards[${index}]`,
            ).map((line) => line.trim());
            const card = parseCard(lines.filter((line) => line !== ""));
            if (card === null) {
                return unreadable(`Cartera Viva card ${index} shows no ticker`);
            }
            cards.push(card);
        }
        return { ok: true, value: { cards } };
    });
}
