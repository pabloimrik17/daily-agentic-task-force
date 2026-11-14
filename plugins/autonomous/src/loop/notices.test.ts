import { describe, expect, it } from "vitest";

import { iterationNotices, stopNotice } from "./notices.ts";
import { attempt, reconciled, report } from "./test-fixtures.ts";

const finalised = attempt({ state: "completed", action: "finalised", stageNow: "proposal" });

describe("iterationNotices", () => {
    it("names the task, the stage it completed and the label it now carries", () => {
        expect(iterationNotices(report("advance", [reconciled([finalised])]))).toEqual([
            "linear:DOT-98 grill-me → proposal",
        ]);
    });

    it("says closed for a finalised attempt whose task is closed", () => {
        const closed = { ...finalised, stageNow: "closed" as const };
        expect(iterationNotices(report("advance", [reconciled([closed])]))).toEqual([
            "linear:DOT-98 grill-me → closed",
        ]);
    });

    it("tells a finalised attempt whose cleanup is still pending", () => {
        const pending = { ...finalised, action: "cleanup-pending" as const };
        expect(iterationNotices(report("advance", [reconciled([pending])]))).toEqual([
            "linear:DOT-98 grill-me → proposal",
        ]);
    });

    it("says so when the task carries no single stage label", () => {
        const unlabelled = { ...finalised, stageNow: null };
        expect(iterationNotices(report("advance", [reconciled([unlabelled])]))).toEqual([
            "linear:DOT-98 grill-me → no single stage label",
        ]);
    });

    it("names a newly retained attempt with its reason", () => {
        const retained = attempt({
            id: "linear:DOT-77:grill-me:1",
            state: "retained",
            action: "retained",
            detail: "session exited; stage grill-me check does not hold",
        });
        expect(iterationNotices(report("advance", [reconciled([retained])]))).toEqual([
            "retained linear:DOT-77:grill-me:1: session exited; stage grill-me check does not hold",
        ]);
    });

    it("tells a pending attempt retained as ambiguous", () => {
        const ambiguous = attempt({
            before: "pending",
            state: "retained",
            action: "ambiguous",
            detail: "2 sessions share /w/x: a, b",
        });
        expect(iterationNotices(report("advance", [reconciled([ambiguous])]))).toEqual([
            "retained linear:DOT-98:grill-me:1: 2 sessions share /w/x: a, b",
        ]);
    });

    it("tells a retained attempt once, not in the iterations after", () => {
        const still = attempt({ before: "retained", state: "retained", action: "none" });
        expect(iterationNotices(report("advance", [reconciled([still])]))).toEqual([]);
    });

    it("records nothing for a session waiting for the person", () => {
        const waiting = attempt({
            session: { state: "open", status: "waiting", busy: false, needsHuman: true },
        });
        expect(iterationNotices(report("advance", [reconciled([waiting])]))).toEqual([]);
    });

    it("records nothing for an iteration that only launches", () => {
        const launch = { step: "launch", tier: "code" as const, outcome: "advance" as const };
        const steps = [reconciled([]), { ...launch, reasons: ["launched"], data: null }];
        expect(iterationNotices(report("advance", steps))).toEqual([]);
    });

    it("records nothing when no step ran", () => {
        expect(iterationNotices(report("not-evaluable"))).toEqual([]);
    });

    it("keeps the attempts' order", () => {
        const retained = attempt({
            id: "linear:DOT-99:grill-me:2",
            state: "retained",
            action: "retained",
            detail: "gone",
        });
        expect(iterationNotices(report("advance", [reconciled([finalised, retained])]))).toEqual([
            "linear:DOT-98 grill-me → proposal",
            "retained linear:DOT-99:grill-me:2: gone",
        ]);
    });
});

describe("stopNotice", () => {
    it("names the reason", () => {
        expect(stopNotice("received SIGINT")).toBe("loop stopped: received SIGINT");
    });
});
