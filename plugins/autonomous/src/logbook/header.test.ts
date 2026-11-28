import { describe, expect, it } from "vitest";

import type { AttemptId } from "../attempts/record.ts";
import { type HeaderInput, renderDiscardEntry, renderHeader } from "./header.ts";

const attempt = "linear:DOT-121:grill-me:1" as AttemptId;

const base: HeaderInput = {
    attempt,
    stage: "grill-me",
    emoji: "🔥",
    number: 1,
    autonomy: "HITL",
    agentArgs: ["--model", "opus", "--effort", "high"],
    start: "2026-11-13T10:02:00.000Z",
    end: "2026-11-13T10:40:30.000Z",
    answer: ["HITL"],
    commits: ["a1b2c3d"],
};

describe("renderHeader", () => {
    it("renders a grill with an answered autonomy exactly", () => {
        expect(renderHeader(base)).toBe(
            [
                "<!-- autonomous:logbook linear:DOT-121:grill-me:1 -->",
                "### 🔥 grill-me · attempt 1",
                "",
                "`HITL` · `--model opus --effort high` · 2026-11-13 10:02 → 10:40 UTC (38 min) · answered `HITL` · 1 commit (`a1b2c3d`)",
            ].join("\n"),
        );
    });

    it("omits the agent arguments of a record from before this capability", () => {
        const facts = renderHeader({ ...base, agentArgs: null }).split("\n")[3];
        expect(facts).toBe(
            "`HITL` · 2026-11-13 10:02 → 10:40 UTC (38 min) · answered `HITL` · 1 commit (`a1b2c3d`)",
        );
    });

    it("says there are no commits", () => {
        const facts = renderHeader({ ...base, commits: [] }).split("\n")[3];
        expect(facts).toMatch(/ · no commits$/);
    });

    it("omits the answer when there is no transition.json", () => {
        const facts = renderHeader({ ...base, answer: null }).split("\n")[3];
        expect(facts).not.toContain("answered");
    });

    it("omits the autonomy when the task has none", () => {
        const facts = renderHeader({ ...base, autonomy: null }).split("\n")[3];
        expect(facts).toMatch(/^`--model opus --effort high` · /);
    });

    it("gives each answer label its own code span", () => {
        const header = renderHeader({ ...base, answer: ["HITL", "AFK"] });
        expect(header).toContain("answered `HITL`, `AFK`");
    });

    it("says the agent moved the task, with no answer, when by is agent", () => {
        const facts = renderHeader({ ...base, answer: ["implement"], answeredBy: "agent" }).split(
            "\n",
        )[3];
        expect(facts).toContain(" · moved to `implement` by the agent, with no answer · ");
        expect(facts).not.toContain("answered");
    });

    it("keeps the answered wording when by is human or absent", () => {
        const human = renderHeader({ ...base, answeredBy: "human" });
        expect(human).toBe(renderHeader(base));
        expect(human).toContain("answered `HITL`");
    });

    it("lists several commits", () => {
        const header = renderHeader({ ...base, commits: ["a", "b", "c"] });
        expect(header).toContain("3 commits (`a`, `b`, `c`)");
    });

    it("renders both days when the span crosses midnight", () => {
        const header = renderHeader({
            ...base,
            start: "2026-11-13T23:50:00.000Z",
            end: "2026-11-14T00:10:00.000Z",
        });
        expect(header).toContain("2026-11-13 23:50 → 2026-11-14 00:10 UTC (20 min)");
    });

    it("renders a duration over an hour in hours and minutes", () => {
        const header = renderHeader({ ...base, end: "2026-11-13T11:07:00.000Z" });
        expect(header).toContain("(1 h 5 min)");
        const exact = renderHeader({ ...base, end: "2026-11-13T12:02:00.000Z" });
        expect(exact).toContain("(2 h)");
    });

    it("gives only the end when the start is not recorded", () => {
        const facts = renderHeader({ ...base, start: null }).split("\n")[3];
        expect(facts).toContain("ended 2026-11-13 10:40 UTC");
        expect(facts).not.toContain("min)");
    });
});

describe("renderDiscardEntry", () => {
    it("is the marker, the discarded heading and the time, with no trailing newline", () => {
        expect(
            renderDiscardEntry({
                attempt,
                stage: "grill-me",
                emoji: "🔥",
                number: 2,
                at: "2026-11-13T10:40:30.000Z",
            }),
        ).toBe(
            [
                "<!-- autonomous:logbook linear:DOT-121:grill-me:1 -->",
                "### 🔥 grill-me · attempt 2 · discarded",
                "",
                "Discarded at 2026-11-13 10:40 UTC.",
            ].join("\n"),
        );
    });
});
