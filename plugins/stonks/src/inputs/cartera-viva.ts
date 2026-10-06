// Cartera Viva parser. Each card's lines read: ticker, sector, company name,
// "N días", "PM" and the average price, the current price, the target, the
// return, the weight, the race to the target, a link, a status, and the
// trailing line. The parser anchors on the labels rather than on positions:
//   - ticker: the first line that is a ticker;
//   - name: the line just before "N días", when it is not the ticker;
//   - average price: the line after "PM", in the page's es-ES format
//     (`1.234,56`);
//   - trailing: "Trailing N%" is activated with N, "Trailing sin activar" is
//     not activated; any other trailing text, or none, is unreadable.
// The page's own "N posiciones" counter must equal the cards read, and a
// collector that saw the cards still loading is unreadable, never empty.

import type { CarteraVivaCard, CarteraVivaRead, TraderTrailing } from "../domain.ts";
import { normaliseTicker } from "../ticker.ts";
import { array, object, stringArray } from "../validate.ts";
import { guard, type ReadResult, unreadable, validateEnvelope } from "./envelope.ts";

const TICKER = /^[A-Z][A-Z0-9]{0,5}(?:[./-][A-Z0-9]{1,2})?$/;
const LABELS = new Set(["PM", "ACTUAL", "OBJETIVO"]);
const DAYS = /^\d+\s+días?$/i;
const ES_NUMBER = /^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/;
const TRAILING_PERCENT = /^trailing\s+(\d+(?:,\d+)?)\s*%$/i;
const TRAILING_OFF = /^trailing\s+sin\s+activar$/i;
const COUNTER = /^(\d+)\s+posici/i;

type CardResult = { ok: true; card: CarteraVivaCard } | { ok: false; message: string };

/** `1.234,56` → 1234.56; null for anything else. */
function esNumber(text: string | undefined): number | null {
    if (text === undefined || !ES_NUMBER.test(text)) {
        return null;
    }
    return Number(text.replaceAll(".", "").replace(",", "."));
}

function trailingOf(lines: string[]): TraderTrailing | null {
    const line = lines.find((candidate) => /^trailing\b/i.test(candidate));
    if (line === undefined) {
        return null;
    }
    if (TRAILING_OFF.test(line)) {
        return { activated: false };
    }
    const percent = TRAILING_PERCENT.exec(line)?.[1];
    return percent === undefined ? null : { activated: true, percent: esNumber(percent) };
}

function nameOf(lines: string[], tickerAt: number): string | null {
    const days = lines.findIndex((line) => DAYS.test(line));
    return days - 1 > tickerAt ? (lines[days - 1] ?? null) : null;
}

function parseCard(lines: string[], index: number): CardResult {
    const tickerAt = lines.findIndex((line) => TICKER.test(line) && !LABELS.has(line));
    const tickerLine = lines[tickerAt];
    if (tickerLine === undefined) {
        return { ok: false, message: `Cartera Viva card ${index} shows no ticker` };
    }
    const ticker = normaliseTicker(tickerLine);
    const pm = lines.indexOf("PM");
    const averagePrice = pm === -1 ? null : esNumber(lines[pm + 1]);
    if (averagePrice === null) {
        return { ok: false, message: `Cartera Viva card ${ticker} shows no average price` };
    }
    const trailing = trailingOf(lines);
    if (trailing === null) {
        return { ok: false, message: `Cartera Viva card ${ticker} shows no known trailing line` };
    }
    return { ok: true, card: { ticker, averagePrice, trailing, name: nameOf(lines, tickerAt) } };
}

/** The page checks: the right page, loaded, with its counter. */
function pageError(data: Record<string, unknown>): string | null {
    if (data.loading === true) {
        return "the Cartera Viva positions are still loading; run its collector again";
    }
    if (typeof data.title !== "string" || !/cartera viva/i.test(data.title)) {
        return `the page is not the Cartera Viva (title ${JSON.stringify(data.title ?? null)})`;
    }
    if (typeof data.heading !== "string" || typeof data.counter !== "string") {
        return "the page shows no open positions with their counter";
    }
    return COUNTER.test(data.counter) ? null : `unrecognised positions counter ${data.counter}`;
}

export function parseCarteraViva(envelope: unknown, runId: string): ReadResult<CarteraVivaRead> {
    const checked = validateEnvelope(envelope, "cartera-viva", runId);
    if (!checked.ok) {
        return checked;
    }
    return guard(() => {
        const data = checked.value.data;
        const problem = pageError(data);
        if (problem !== null) {
            return unreadable(problem);
        }
        const cards: CarteraVivaCard[] = [];
        for (const [index, raw] of array(data.cards, "cartera-viva.data.cards").entries()) {
            const path = `cartera-viva.data.cards[${index}]`;
            const lines = stringArray(object(raw, path), "texts", path)
                .map((line) => line.trim())
                .filter((line) => line !== "");
            const card = parseCard(lines, index);
            if (!card.ok) {
                return unreadable(card.message);
            }
            cards.push(card.card);
        }
        const shown = Number(COUNTER.exec(String(data.counter))?.[1]);
        if (cards.length !== shown) {
            return unreadable(
                `Cartera Viva shows ${shown} positions but ${cards.length} cards were read`,
            );
        }
        return { ok: true, value: { cards } };
    });
}
