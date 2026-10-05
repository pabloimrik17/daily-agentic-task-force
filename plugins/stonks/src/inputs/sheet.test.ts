import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseSheet } from "./sheet.ts";

const HEADER = ["Ticker", "Sector", "Estado", "Cantidad", "$/u"];

const fixture = (name: string): unknown[][] =>
    JSON.parse(
        readFileSync(
            join(dirname(fileURLToPath(import.meta.url)), "fixtures", "sheet", name),
            "utf8",
        ),
    ) as unknown[][];

const failure = (values: unknown[][]): string => {
    const result = parseSheet(values);
    if (result.ok) {
        throw new Error("expected the sheet to be rejected");
    }
    return result.error;
};

describe("parseSheet", () => {
    it("reads one entry per row, with the six Estados, skipping the blank row", () => {
        const result = parseSheet(fixture("values.json"));
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        expect(
            result.sheet.entries.map((e) => [
                e.row,
                e.ticker,
                e.estado,
                e.cantidad,
                e.pricePerUnit,
            ]),
        ).toEqual([
            [2, "ACME", "Invertido", 10, 25.5],
            [3, "HOOL", "Comprar", 0, 120],
            [4, "CRUX", "Vender", 4, 9.75],
            [5, "STRK", "Operativa", 3, 41],
            [6, "WNYE", "En espera", 0, 15.2],
            [7, "GLBX", "Roger", 0, 7],
            [9, "INIT", "Invertido", 2, 18.4],
            [10, "INIT", "Comprar", 1, 16.9],
        ]);
    });

    it("stops on an unknown Estado, naming the row and the value", () => {
        const error = failure(fixture("values-unknown-estado.json"));
        expect(error).toContain("row 10");
        expect(error).toContain('"Invertida"');
    });

    it("stops on a row without a ticker, naming the row", () => {
        expect(failure(fixture("values-no-ticker.json"))).toContain("row 13");
    });

    it("keeps several entries of one ticker separate", () => {
        const result = parseSheet(fixture("values.json"));
        expect(result.ok && result.sheet.entries.filter((e) => e.ticker === "INIT")).toEqual([
            { row: 9, ticker: "INIT", estado: "Invertido", cantidad: 2, pricePerUnit: 18.4 },
            { row: 10, ticker: "INIT", estado: "Comprar", cantidad: 1, pricePerUnit: 16.9 },
        ]);
    });

    it("stops when the columns moved, naming the expected and the found header", () => {
        const error = failure(fixture("values-bad-header.json"));
        expect(error).toContain(JSON.stringify(HEADER));
        expect(error).toContain(JSON.stringify(["Ticker", "Estado", "Sector", "Cantidad", "$/u"]));
    });

    it("stops on a non-numeric Cantidad, naming the row and the value", () => {
        const error = failure(fixture("values-text-quantity.json"));
        expect(error).toContain("row 3");
        expect(error).toContain('"dos"');
    });

    it("rejects a numeric string in Cantidad, since UNFORMATTED_VALUE yields numbers", () => {
        expect(failure([HEADER, ["ACME", "S", "Invertido", "10", 5]])).toContain('"10"');
    });

    it("stops on a non-numeric $/u, naming the row and the value", () => {
        const error = failure([HEADER, ["ACME", "S", "Invertido", 1, "$5.00"]]);
        expect(error).toContain("row 2");
        expect(error).toContain('"$5.00"');
    });

    it("reads a blank $/u as null and a blank Cantidad as zero", () => {
        const result = parseSheet([HEADER, ["ACME", "S", "Comprar", "", ""]]);
        expect(result.ok && result.sheet.entries[0]).toMatchObject({
            cantidad: 0,
            pricePerUnit: null,
        });
    });

    it("treats a short row as having blank trailing cells", () => {
        const result = parseSheet([HEADER, ["ACME", "S", "Comprar"], ["HOOL", "S", "Roger", 2]]);
        expect(result.ok && result.sheet.entries.map((e) => [e.cantidad, e.pricePerUnit])).toEqual([
            [0, null],
            [2, null],
        ]);
    });

    it("skips rows blank in every column, including whitespace and short blank rows", () => {
        const result = parseSheet([
            HEADER,
            [],
            ["", " ", "", "", ""],
            ["ACME", "S", "Roger", 1, 2],
        ]);
        expect(result.ok && result.sheet.entries.map((e) => e.row)).toEqual([4]);
    });

    it("trims the Estado and normalises the ticker", () => {
        const result = parseSheet([HEADER, [" brk b ", "S", "  En espera ", 1, 2]]);
        expect(result.ok && result.sheet.entries[0]).toMatchObject({
            ticker: "BRK.B",
            estado: "En espera",
        });
    });

    it("stops on a blank Estado on a row with a ticker", () => {
        const error = failure([HEADER, ["ACME", "S", "", 1, 2]]);
        expect(error).toContain("row 2");
    });

    it("ignores the Sector", () => {
        const result = parseSheet([HEADER, ["ACME", 42, "Roger", 1, 2]]);
        expect(result.ok).toBe(true);
    });

    it("stops on an empty sheet", () => {
        expect(failure([])).toContain("header");
    });
});
