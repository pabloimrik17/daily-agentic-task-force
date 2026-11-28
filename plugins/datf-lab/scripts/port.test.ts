import { describe, expect, it } from "vitest";

import { formatEndpoint, parsePort } from "./port.ts";

describe("parsePort", () => {
    it("accepts a plain port", () => {
        expect(parsePort("8080")).toBe(8080);
    });

    it("tolerates surrounding whitespace", () => {
        expect(parsePort(" 443 ")).toBe(443);
    });

    it("rejects zero and negative values", () => {
        expect(parsePort("0")).toBeUndefined();
        expect(parsePort("-1")).toBeUndefined();
    });

    it("rejects values above the maximum", () => {
        expect(parsePort("70000")).toBeUndefined();
    });

    it("rejects text with no digits", () => {
        expect(parsePort("http")).toBeUndefined();
        expect(parsePort("")).toBeUndefined();
    });
});

describe("formatEndpoint", () => {
    it("joins host and port", () => {
        expect(formatEndpoint("localhost", "3000")).toBe("localhost:3000");
    });

    it("returns undefined for an invalid port", () => {
        expect(formatEndpoint("localhost", "99999")).toBeUndefined();
    });
});
