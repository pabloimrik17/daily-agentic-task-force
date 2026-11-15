import { describe, expect, it } from "vitest";

import type { Source } from "../config.ts";
import { LABEL_TRIAGE } from "../label-triage/question-id.ts";
import type { LabelTriageData } from "../label-triage/step.ts";
import type { MarkRecord } from "../label-triage/write.ts";
import type { StepResult } from "../runner.ts";
import { iterationNotices, stopNotice } from "./notices.ts";
import { attempt, reconciled, report } from "./test-fixtures.ts";

function mark(
    source: Source,
    taskId: string,
    status: MarkRecord["status"] = "applied",
): MarkRecord {
    return { source, taskId, status, detail: null };
}

function triage(marked: MarkRecord[], markedRead = marked.length): StepResult<LabelTriageData> {
    return {
        step: LABEL_TRIAGE,
        tier: "code",
        outcome: "advance",
        reasons: [],
        data: {
            sources: [],
            records: [],
            conflicts: [],
            notJudged: [],
            remainder: 0,
            judgement: null,
            failures: [],
            marked,
            unmarked: [],
            markedRead,
        },
    };
}

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

describe("iterationNotices of newly marked tasks", () => {
    it("names the count and the tasks newly marked (tasks newly marked)", () => {
        const marked = [mark("linear", "DOT-130"), mark("beads", "X-12")];
        expect(iterationNotices(report("advance", [triage(marked)]))).toEqual([
            "triage-me +2: linear:DOT-130, beads:X-12",
        ]);
    });

    it("names five tasks and ends with an ellipsis when more were marked (many tasks newly marked)", () => {
        const marked = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => mark("beads", id));
        expect(iterationNotices(report("advance", [triage(marked)]))).toEqual([
            "triage-me +8: beads:a, beads:b, beads:c, beads:d, beads:e, …",
        ]);
    });

    it("names all five tasks without an ellipsis when exactly five were marked", () => {
        const marked = ["a", "b", "c", "d", "e"].map((id) => mark("beads", id));
        expect(iterationNotices(report("advance", [triage(marked)]))).toEqual([
            "triage-me +5: beads:a, beads:b, beads:c, beads:d, beads:e",
        ]);
    });

    it("tells nothing for tasks marked in an earlier iteration (marked in an earlier iteration)", () => {
        expect(iterationNotices(report("advance", [triage([], 2)]))).toEqual([]);
    });

    it("counts only the marks that were applied", () => {
        const marked = [
            mark("linear", "DOT-130"),
            mark("linear", "DOT-131", "proposed"),
            mark("beads", "X-12", "failed"),
        ];
        expect(iterationNotices(report("advance", [triage(marked)]))).toEqual([
            "triage-me +1: linear:DOT-130",
        ]);
    });

    it("tells nothing when every mark was only proposed or failed", () => {
        const marked = [mark("linear", "DOT-131", "proposed"), mark("beads", "X-12", "failed")];
        expect(iterationNotices(report("advance", [triage(marked)]))).toEqual([]);
    });

    it("tells nothing for an iteration that launches and marks nothing (iteration with nothing to tell)", () => {
        const launch = { step: "launch", tier: "code" as const, outcome: "advance" as const };
        const steps = [
            reconciled([]),
            triage([]),
            { ...launch, reasons: ["launched"], data: null },
        ];
        expect(iterationNotices(report("advance", steps))).toEqual([]);
    });

    it("follows the attempts' notices", () => {
        const steps = [reconciled([finalised]), triage([mark("linear", "DOT-130")])];
        expect(iterationNotices(report("advance", steps))).toEqual([
            "linear:DOT-98 grill-me → proposal",
            "triage-me +1: linear:DOT-130",
        ]);
    });
});

describe("stopNotice", () => {
    it("names the reason", () => {
        expect(stopNotice("received SIGINT")).toBe("loop stopped: received SIGINT");
    });
});
