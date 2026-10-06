// One fictional dataset exercises every check at least once; its findings
// were reviewed by hand against the spec and frozen. A change in
// `expected.json` is a change in what the checks say; review it as such.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { CheckId, Finding } from "../domain.ts";
import { type CheckInputs, runChecks } from "./index.ts";

const read = (name: string): unknown =>
    JSON.parse(readFileSync(new URL(`./fixtures/golden/${name}`, import.meta.url), "utf8"));

const inputs = read("inputs.json") as CheckInputs;
const expected = read("expected.json") as Finding[];

const EVERY_CHECK: CheckId[] = [
    "A1",
    "A2",
    "B1",
    "B2",
    "B3",
    "B4",
    "B5",
    "B6",
    "B7",
    "B8",
    "C1",
    "C2",
    "C3",
    "C4",
    "C5",
    "C6",
    "C7",
    "C8",
    "C9",
];

describe("golden run", () => {
    it("reproduces the frozen findings, in report order", () => {
        expect(runChecks(inputs)).toEqual(expected);
    });

    it("exercises every check at least once, C6 both as a warning and as not evaluable", () => {
        const checks = new Set(expected.map((item) => item.check));
        for (const check of EVERY_CHECK) {
            expect(checks.has(check), `no ${check} finding`).toBe(true);
        }
        const c6 = expected.filter((item) => item.check === "C6").map((item) => item.severity);
        expect(c6).toContain("warning");
        expect(c6).toContain("not-evaluable");
    });

    it("keeps the Excluded ticker in check A and out of B and C", () => {
        const etfx = expected.filter((item) => item.ticker === "ETFX").map((item) => item.check);
        expect(etfx).toEqual(["A1"]);
    });

    it("leaves the tickers that agree everywhere without a finding", () => {
        const found = new Set(expected.map((item) => item.ticker));
        for (const ticker of ["OSCRP", "ZORGX", "DNDRM", "STRN.B"]) {
            expect(found.has(ticker), `${ticker} has a finding`).toBe(false);
        }
    });
});
