import { describe, expect, it } from "vitest";

import { isSupported, nextStage } from "./stage.ts";

describe("nextStage", () => {
    it("gives grill-me, which is supported, for a grill-me task", () => {
        const stage = nextStage(["personal", "grill-me"]);
        expect(stage).toBe("grill-me");
        expect(stage !== null && isSupported(stage)).toBe(true);
    });

    it("gives proposal, which is not supported, for an AFK task", () => {
        const stage = nextStage(["personal", "AFK", "proposal"]);
        expect(stage).toBe("proposal");
        expect(stage !== null && isSupported(stage)).toBe(false);
    });

    it("gives grill-me for an HITL task that also carries grill-me", () => {
        const stage = nextStage(["work", "HITL", "grill-me"]);
        expect(stage).toBe("grill-me");
        expect(stage !== null && isSupported(stage)).toBe(true);
    });

    it("gives null for a task without a stage label", () => {
        expect(nextStage(["personal", "AFK"])).toBeNull();
        expect(nextStage([])).toBeNull();
    });

    it("gives null for a task with two stage labels", () => {
        expect(nextStage(["personal", "AFK", "grill-me", "proposal"])).toBeNull();
    });

    it("reads the stage by exact spelling only", () => {
        expect(nextStage(["personal", "Grill Me", "PROPOSAL"])).toBeNull();
    });
});
