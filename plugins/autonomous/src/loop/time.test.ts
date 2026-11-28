import { describe, expect, it } from "vitest";
import { localeFromEnv, timeFormatter } from "./time.js";

describe("timeFormatter", () => {
    it("shows a winter instant in the Madrid zone", () => {
        const format = timeFormatter("es-ES", "Europe/Madrid");
        expect(format(new Date("2026-01-15T09:40:00Z"))).toBe("10:40");
    });

    it("uses a 12-hour clock with a plain space for en-US", () => {
        const format = timeFormatter("en-US", "America/New_York");
        expect(format(new Date("2026-01-15T20:40:00Z"))).toBe("3:40 PM");
    });

    it("formats the ended time plus the interval", () => {
        const format = timeFormatter("es-ES", "Europe/Madrid");
        const ended = new Date("2026-01-15T09:40:00Z");
        expect(format(new Date(ended.getTime() + 5 * 60_000))).toBe("10:45");
    });
});

describe("localeFromEnv", () => {
    it("prefers LC_ALL over LC_TIME over LANG", () => {
        expect(localeFromEnv({ LC_ALL: "fr_FR", LC_TIME: "de_DE", LANG: "es_ES" })).toBe("fr-FR");
        expect(localeFromEnv({ LC_TIME: "de_DE", LANG: "es_ES" })).toBe("de-DE");
        expect(localeFromEnv({ LANG: "es_ES.UTF-8" })).toBe("es-ES");
    });

    it("skips C, POSIX, empty and invalid values", () => {
        expect(localeFromEnv({ LC_ALL: "C", LC_TIME: "POSIX", LANG: "es_ES.UTF-8" })).toBe("es-ES");
        expect(localeFromEnv({ LC_ALL: "", LC_TIME: "not a locale!!", LANG: "en_US" })).toBe(
            "en-US",
        );
    });

    it("returns undefined when none is usable", () => {
        expect(localeFromEnv({ LC_ALL: "C", LANG: "" })).toBeUndefined();
        expect(localeFromEnv({})).toBeUndefined();
    });
});
