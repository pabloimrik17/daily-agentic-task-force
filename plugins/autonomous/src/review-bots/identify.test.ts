import { describe, expect, it } from "vitest";

import { renderMarker } from "../publish/markers.ts";
import { bareLogin, botOf, externalReviewReply } from "./identify.ts";
import { CONFIG } from "./test-fixtures.ts";

describe("identify", () => {
    it("drops the `[bot]` suffix REST gives and GraphQL omits", () => {
        expect(bareLogin("coderabbitai[bot]")).toBe("coderabbitai");
        expect(bareLogin("coderabbitai")).toBe("coderabbitai");
    });

    it("finds a configured bot from either form of its login, and no bot for a person", () => {
        expect(botOf("greptile-apps", CONFIG.bots)?.id).toBe("greptile");
        expect(botOf("greptile-apps[bot]", CONFIG.bots)?.id).toBe("greptile");
        expect(botOf("someone", CONFIG.bots)).toBeNull();
    });

    it("reads an external review's resolution marker, and no other stage's", () => {
        const marker = (stage: string) =>
            renderMarker({
                kind: "resolution",
                attempt: `linear:DOT-7:${stage}:2`,
                finding: "f1",
                state: "fixed",
            });
        expect(externalReviewReply(`Status: fixed\n${marker("external-review")}`)).toEqual({
            attempt: "linear:DOT-7:external-review:2",
            state: "fixed",
        });
        expect(externalReviewReply(marker("code-review"))).toBeNull();
    });
});
