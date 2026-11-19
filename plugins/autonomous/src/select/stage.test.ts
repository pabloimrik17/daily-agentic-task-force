import { describe, expect, it } from "vitest";

import { isSupported, nextStage, splitByStage } from "./stage.ts";
import type { StageName } from "./types.ts";

describe("nextStage", () => {
    it("gives grill-me, which is supported, for a grill-me task", () => {
        const stage = nextStage(["personal", "grill-me"]);
        expect(stage).toBe("grill-me");
        expect(stage !== null && isSupported(stage)).toBe(true);
    });

    it("gives proposal, which is supported, for an AFK task", () => {
        const stage = nextStage(["personal", "AFK", "proposal"]);
        expect(stage).toBe("proposal");
        expect(stage !== null && isSupported(stage)).toBe(true);
    });

    it("gives implement, which is not supported, for a task ready to implement", () => {
        const stage = nextStage(["personal", "AFK", "implement"]);
        expect(stage).toBe("implement");
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

describe("splitByStage", () => {
    const at = (id: string, stage: StageName) => ({ id, stage });

    it("keeps the proposal candidate and sets the grill-me one aside", () => {
        const grill = at("a", "grill-me");
        const proposal = at("b", "proposal");
        expect(splitByStage([grill, proposal])).toEqual({ kept: [proposal], setAside: [grill] });
    });

    it("keeps every candidate of the most advanced stage, in order", () => {
        const [first, grill, second] = [
            at("a", "proposal"),
            at("b", "grill-me"),
            at("c", "proposal"),
        ];
        expect(splitByStage([first, grill, second])).toEqual({
            kept: [first, second],
            setAside: [grill],
        });
    });

    it("keeps all when every candidate is at the same stage", () => {
        const all = [at("a", "grill-me"), at("b", "grill-me")];
        expect(splitByStage(all)).toEqual({ kept: all, setAside: [] });
    });

    it("keeps a single candidate", () => {
        const only = at("a", "grill-me");
        expect(splitByStage([only])).toEqual({ kept: [only], setAside: [] });
    });

    it("keeps nothing for no candidate", () => {
        expect(splitByStage([])).toEqual({ kept: [], setAside: [] });
    });
});
