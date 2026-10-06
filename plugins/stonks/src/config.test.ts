import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { EXAMPLE_PATH, loadConfig, parseConfig, resolveConfigPath } from "./config.ts";
import { CONFIG_SCHEMA } from "./domain.ts";

const valid = (): Record<string, unknown> => ({
    schema: CONFIG_SCHEMA,
    trackingSheet: { spreadsheetId: "sheet-id", tab: "Tab" },
    swsPortfolio: { url: "https://example.com/portfolio/1" },
    watchlist: { name: "Watch", url: "https://example.com/watchlist" },
    carteraViva: { url: "https://example.com/cartera" },
    excludedTickers: ["AAA", "BBB"],
});

const parse = (input: unknown) => parseConfig(JSON.stringify(input), "/cfg.json");

function failsAt(result: ReturnType<typeof parseConfig>, path: string): void {
    expect(result.ok).toBe(false);
    if (!result.ok) {
        expect(result.error).toContain(path);
    }
}

describe("resolveConfigPath", () => {
    it("uses STONKS_CONFIG when set", () => {
        expect(resolveConfigPath({ STONKS_CONFIG: "/custom.json", HOME: "/home/x" })).toBe(
            "/custom.json",
        );
    });

    it("ignores an empty STONKS_CONFIG", () => {
        expect(resolveConfigPath({ STONKS_CONFIG: "", HOME: "/home/x" })).toBe(
            join("/home/x", ".config", "stonks", "config.json"),
        );
    });

    it("falls back to os.homedir() when HOME is missing", () => {
        expect(resolveConfigPath({})).toBe(join(homedir(), ".config", "stonks", "config.json"));
    });
});

describe("parseConfig", () => {
    it("accepts a valid document", () => {
        const result = parse(valid());
        expect(result).toEqual({ ok: true, value: valid() });
    });

    it("rejects invalid JSON", () => {
        const result = parseConfig("{", "/cfg.json");
        expect(result.ok).toBe(false);
    });

    it("rejects a wrong schema", () => {
        const result = parse({ ...valid(), schema: "stonks.config.v2" });
        failsAt(result, "$.schema");
    });

    it("rejects a missing field naming its path", () => {
        const input = valid();
        delete input.carteraViva;
        failsAt(parse(input), "$.carteraViva");
    });

    it("rejects a missing nested field naming its path", () => {
        const input = valid();
        input.trackingSheet = { spreadsheetId: "sheet-id" };
        failsAt(parse(input), "$.trackingSheet.tab");
    });

    it("rejects a mistyped field naming its path", () => {
        const result = parse({ ...valid(), excludedTickers: "AAA" });
        failsAt(result, "$.excludedTickers");
    });

    it("rejects an unknown field naming its path", () => {
        const result = parse({ ...valid(), extra: 1 });
        failsAt(result, "$.extra");
    });

    it("rejects an unknown nested field", () => {
        const input = valid();
        input.watchlist = { name: "Watch", url: "https://example.com/w", extra: true };
        failsAt(parse(input), "$.watchlist.extra");
    });

    it("rejects an empty string", () => {
        const input = valid();
        input.trackingSheet = { spreadsheetId: "", tab: "Tab" };
        failsAt(parse(input), "$.trackingSheet.spreadsheetId");
    });

    it("rejects surrounding whitespace instead of trimming", () => {
        const input = valid();
        input.trackingSheet = { spreadsheetId: "sheet-id", tab: "Tab " };
        failsAt(parse(input), "$.trackingSheet.tab must not have leading or trailing whitespace");
        failsAt(
            parse({ ...valid(), excludedTickers: [" AAA"] }),
            "$.excludedTickers[0] must not have leading or trailing whitespace",
        );
        const url = valid();
        url.carteraViva = { url: "https://example.com/cartera " };
        failsAt(parse(url), "$.carteraViva.url must not have leading or trailing whitespace");
    });

    it("rejects a non-https URL", () => {
        const input = valid();
        input.swsPortfolio = { url: "http://example.com/portfolio/1" };
        failsAt(parse(input), "$.swsPortfolio.url");
    });

    it("rejects a duplicate Excluded ticker", () => {
        const result = parse({ ...valid(), excludedTickers: ["AAA", "AAA"] });
        failsAt(result, "$.excludedTickers[1]");
    });

    it("rejects a lower-case Excluded ticker", () => {
        const result = parse({ ...valid(), excludedTickers: ["aaa"] });
        failsAt(result, "$.excludedTickers[0]");
    });
});

describe("loadConfig", () => {
    it("names the path and the example when the file is missing", () => {
        const result = loadConfig({ STONKS_CONFIG: "/nonexistent/stonks.json" });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.path).toBe("/nonexistent/stonks.json");
            expect(result.error).toContain("/nonexistent/stonks.json");
            expect(result.error).toContain(EXAMPLE_PATH);
        }
    });

    it("loads a valid file through the injected reader", () => {
        const result = loadConfig({ STONKS_CONFIG: "/cfg.json" }, () => JSON.stringify(valid()));
        expect(result).toMatchObject({ ok: true, path: "/cfg.json" });
    });

    it("reports a parse error with the path", () => {
        const result = loadConfig({ STONKS_CONFIG: "/cfg.json" }, () => "{}");
        expect(result).toMatchObject({ ok: false, path: "/cfg.json" });
    });
});

describe("config.example.json", () => {
    it("parses", () => {
        const text = readFileSync(EXAMPLE_PATH, "utf8");
        expect(parseConfig(text, EXAMPLE_PATH)).toMatchObject({ ok: true });
    });
});
