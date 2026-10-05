// Strict parser of the tracking sheet's cell values (design D7, D16): a
// header that moved, an unknown Estado, a row without a ticker or a
// non-numeric number stops the run naming the row. Nothing is guessed.
// Row numbers are the sheet's own: row 1 is the header.

import { type Entry, ESTADOS, type Estado, SHEET_HEADER, type TrackingSheet } from "../domain.ts";
import { normaliseTicker } from "../ticker.ts";

export type SheetParse = { ok: true; sheet: TrackingSheet } | { ok: false; error: string };

const isBlank = (cell: unknown): boolean =>
    cell === undefined || cell === null || (typeof cell === "string" && cell.trim() === "");

const show = (cell: unknown): string =>
    typeof cell === "string" ? `"${cell}"` : JSON.stringify(cell);

const isEstado = (value: string): value is Estado => (ESTADOS as readonly string[]).includes(value);

type Cell<T> = { ok: true; value: T } | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

function parseEstado(estado: unknown, row: number): Cell<Estado> {
    const text = typeof estado === "string" ? estado.trim() : estado;
    if (typeof text === "string" && isEstado(text)) {
        return { ok: true, value: text };
    }
    return fail(
        `tracking sheet row ${row} has an unknown Estado ${show(estado ?? "")}; expected one of ${ESTADOS.join(", ")}`,
    );
}

function parseNumber(cell: unknown, label: string, row: number): Cell<number | null> {
    if (typeof cell === "number") {
        return { ok: true, value: cell };
    }
    if (isBlank(cell)) {
        return { ok: true, value: null };
    }
    return fail(`tracking sheet row ${row} has a non-numeric ${label} ${show(cell)}`);
}

function parseRow(cells: unknown[], row: number): Cell<Entry> {
    const [ticker, , estado, cantidad, price] = SHEET_HEADER.map((_, column) => cells[column]);
    if (isBlank(ticker) || typeof ticker !== "string") {
        return fail(`tracking sheet row ${row} has no ticker`);
    }
    const estadoCell = parseEstado(estado, row);
    if (!estadoCell.ok) {
        return estadoCell;
    }
    const cantidadCell = parseNumber(cantidad, "Cantidad", row);
    if (!cantidadCell.ok) {
        return cantidadCell;
    }
    const priceCell = parseNumber(price, "$/u", row);
    if (!priceCell.ok) {
        return priceCell;
    }
    return {
        ok: true,
        value: {
            row,
            ticker: normaliseTicker(ticker),
            estado: estadoCell.value,
            cantidad: cantidadCell.value ?? 0,
            pricePerUnit: priceCell.value,
        },
    };
}

const isBlankRow = (cells: unknown[]): boolean =>
    SHEET_HEADER.every((_, column) => isBlank(cells[column]));

const headerMatches = (header: unknown[]): boolean =>
    header.length === SHEET_HEADER.length &&
    SHEET_HEADER.every((name, index) => header[index] === name);

export function parseSheet(values: unknown[][]): SheetParse {
    const header = values[0] ?? [];
    if (!headerMatches(header)) {
        return fail(
            `tracking sheet header must be ${JSON.stringify(SHEET_HEADER)}, found ${JSON.stringify(header)}`,
        );
    }
    const entries: Entry[] = [];
    for (const [index, cells] of values.slice(1).entries()) {
        if (isBlankRow(cells)) {
            continue;
        }
        const entry = parseRow(cells, index + 2);
        if (!entry.ok) {
            return entry;
        }
        entries.push(entry.value);
    }
    return { ok: true, sheet: { entries } };
}
