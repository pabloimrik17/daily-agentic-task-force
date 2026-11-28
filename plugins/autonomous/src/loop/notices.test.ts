import { describe, expect, it } from "vitest";

import type { Source } from "../config.ts";
import { LABEL_TRIAGE } from "../label-triage/question-id.ts";
import type { LabelTriageData } from "../label-triage/step.ts";
import type { MarkRecord } from "../label-triage/write.ts";
import type { StepResult } from "../runner.ts";
import { type StuckEntry, UNREAD_ONCE } from "./files.ts";
import { iterationNotices, stopNotice, stuckNotices } from "./notices.ts";
import { attempt, reconciled, report, selected, stuckTask } from "./test-fixtures.ts";

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

const REPOSITORY = "no repository label names a directory of the workspace";

function entry(task: string, exclusion = "repository", detail = REPOSITORY): StuckEntry {
    return { task, exclusion, detail };
}

describe("stuckNotices", () => {
    it("names a stuck task of the machine scope the first time, with its reason", () => {
        const told = stuckNotices(report("wait", [selected([stuckTask("X-12")])]), []);
        expect(told.notices).toEqual([`stuck beads:X-12: ${REPOSITORY}`]);
        expect(told.entries).toEqual([entry("beads:X-12")]);
    });

    it("tells nothing for the same task and reason as an earlier iteration", () => {
        const told = stuckNotices(report("wait", [selected([stuckTask("X-12")])]), [
            entry("beads:X-12"),
        ]);
        expect(told).toEqual({ notices: [], entries: [] });
    });

    it("tells a task again when its reason changed", () => {
        const now = stuckTask("X-12", {
            reason: "repository-prerequisites",
            detail: "no OpenSpec root in /w/x",
        });
        const told = stuckNotices(report("wait", [selected([now])]), [entry("beads:X-12")]);
        expect(told.notices).toEqual(["stuck beads:X-12: no OpenSpec root in /w/x"]);
        expect(told.entries).toEqual([
            entry("beads:X-12", "repository-prerequisites", "no OpenSpec root in /w/x"),
        ]);
    });

    it("tells a changed detail of the same exclusion again", () => {
        const now = stuckTask("X-12", { detail: "2 repository labels: a, b" });
        const told = stuckNotices(report("wait", [selected([now])]), [entry("beads:X-12")]);
        expect(told.notices).toEqual(["stuck beads:X-12: 2 repository labels: a, b"]);
    });

    it("names five tasks and counts the rest and the log when more are new", () => {
        const tasks = Array.from({ length: 56 }, (_, n) => stuckTask(`X-${n}`));
        const told = stuckNotices(report("wait", [selected(tasks)]), []);
        expect(told.notices).toEqual([
            ...[0, 1, 2, 3, 4].map((n) => `stuck beads:X-${n}: ${REPOSITORY}`),
            "stuck +51 more: see loop.log",
        ]);
        expect(told.entries).toHaveLength(56);
    });

    it("adds no count line when exactly five are new", () => {
        const tasks = [0, 1, 2, 3, 4].map((n) => stuckTask(`X-${n}`));
        expect(stuckNotices(report("wait", [selected(tasks)]), []).notices).toHaveLength(5);
    });

    it("records a task of another scope without telling it", () => {
        const work = stuckTask("X-12", { scope: "work" });
        const told = stuckNotices(report("wait", [selected([work], "personal")]), []);
        expect(told.notices).toEqual([]);
        expect(told.entries).toEqual([entry("beads:X-12")]);
    });

    it("does not let a task of another scope take one of the five", () => {
        const tasks = [stuckTask("W-1", { scope: "work" }), stuckTask("X-1")];
        expect(stuckNotices(report("wait", [selected(tasks)]), []).notices).toEqual([
            `stuck beads:X-1: ${REPOSITORY}`,
        ]);
    });

    it("uses the exclusion when the reason has no detail", () => {
        const told = stuckNotices(
            report("wait", [selected([stuckTask("X-12", { detail: null })])]),
            [],
        );
        expect(told.notices).toEqual(["stuck beads:X-12: repository"]);
    });

    it("ignores an excluded task that is not stuck", () => {
        const blocked = stuckTask("X-12", { reason: "blocked", stuck: false });
        expect(stuckNotices(report("wait", [selected([blocked])]), [])).toEqual({
            notices: [],
            entries: [],
        });
    });

    it("names retained attempts and failed prerequisites first, then repository prerequisites, then no repository", () => {
        const tasks = [
            ...[0, 1, 2].map((n) => stuckTask(`R-${n}`)),
            stuckTask("O-1", { reason: "repository-prerequisites", detail: "no OpenSpec root" }),
            stuckTask("A-1", { reason: "open-attempt", detail: "attempt a is retained" }),
            stuckTask("P-1", { reason: "prerequisites", detail: "lacks a skill" }),
            stuckTask("U-1", { reason: "unreadable-prerequisites", detail: "cannot read" }),
        ];
        const told = stuckNotices(report("wait", [selected(tasks)]), []);
        expect(told.notices).toEqual([
            "stuck beads:A-1: attempt a is retained",
            "stuck beads:P-1: lacks a skill",
            "stuck beads:U-1: cannot read",
            "stuck beads:O-1: no OpenSpec root",
            `stuck beads:R-0: ${REPOSITORY}`,
            "stuck +2 more: see loop.log",
        ]);
        expect(told.entries.map(({ task }) => task)).toEqual(tasks.map(({ id }) => `beads:${id}`));
    });

    it("remembers the task whose prerequisites could not be read, without telling it", () => {
        const unreadable = { source: "linear" as const, id: "DOT-1", reason: "cannot read" };
        const iteration = report("not-evaluable", [selected([], "personal", unreadable)]);
        const memory = { task: "linear:DOT-1", exclusion: UNREAD_ONCE, detail: "cannot read" };
        expect(stuckNotices(iteration, [])).toEqual({ notices: [], entries: [memory] });
        expect(stuckNotices(iteration, [memory])).toEqual({ notices: [], entries: [] });
    });

    it("tells a task excluded as unreadable prerequisites although it was remembered", () => {
        const memory = { task: "beads:X-12", exclusion: UNREAD_ONCE, detail: "cannot read" };
        const now = stuckTask("X-12", {
            reason: "unreadable-prerequisites",
            detail: "cannot read",
        });
        expect(stuckNotices(report("wait", [selected([now])]), [memory]).notices).toEqual([
            "stuck beads:X-12: cannot read",
        ]);
    });

    it("tells nothing when the iteration has no select data", () => {
        expect(stuckNotices(report("not-evaluable"), [])).toEqual({ notices: [], entries: [] });
    });
});

describe("stopNotice", () => {
    it("names the reason", () => {
        expect(stopNotice("received SIGINT")).toBe("loop stopped: received SIGINT");
    });
});
