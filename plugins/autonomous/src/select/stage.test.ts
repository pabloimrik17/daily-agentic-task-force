import { describe, expect, it } from "vitest";

import { isSupported, nextStage } from "./stage.ts";

describe("nextStage", () => {
    it("gives grill-me, which is supported, for a grill-me task", () => {
        const stage = nextStage(["personal", "grill-me"]);
        expect(stage).toBe("grill-me");
        expect(isSupported(stage)).toBe(true);
    });

    it("gives proposal, which is not supported, for an AFK task", () => {
        const stage = nextStage(["personal", "AFK"]);
        expect(stage).toBe("proposal");
        expect(isSupported(stage)).toBe(false);
    });

    it("gives grill-me for an HITL task that also carries grill-me", () => {
        const stage = nextStage(["work", "HITL", "grill-me"]);
        expect(stage).toBe("grill-me");
        expect(isSupported(stage)).toBe(true);
    });
});
