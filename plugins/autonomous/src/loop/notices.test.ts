import { describe, expect, it } from "vitest";

import type { Source } from "../config.ts";
import { LABEL_TRIAGE } from "../label-triage/question-id.ts";
import type { LabelTriageData } from "../label-triage/step.ts";
import type { MarkRecord } from "../label-triage/write.ts";
import type { RunReport } from "../report.ts";
import type { StepResult } from "../runner.ts";
import { type StuckEntry, UNREAD_ONCE } from "./files.ts";
import { iterationNotices, stopNotice, stuckNotices } from "./notices.ts";
import {
    attempt,
    launched,
    reconciled,
    report,
    selected,
    stopStep,
    stuckTask,
} from "./test-fixtures.ts";

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

const TIMES = { ended: "10:40", next: "10:50" };

const details = (iteration: RunReport, stuck: readonly string[] = []) =>
    iterationNotices(iteration, stuck, TIMES).slice(1);

const summary = (iteration: RunReport) => iterationNotices(iteration, [], TIMES)[0];

const finalised = attempt({ state: "completed", action: "finalised", stageNow: "proposal" });

describe("iterationNotices", () => {
    it("names the task, the stage it completed and the label it now carries", () => {
        expect(details(report("advance", [reconciled([finalised])]))).toEqual([
            "  ✔ linear:DOT-98 grill-me → proposal",
        ]);
    });

    it("says closed for a finalised attempt whose task is closed", () => {
        const closed = { ...finalised, stageNow: "closed" as const };
        expect(details(report("advance", [reconciled([closed])]))).toEqual([
            "  ✔ linear:DOT-98 grill-me → closed",
        ]);
    });

    it("tells a finalised attempt whose cleanup is still pending", () => {
        const pending = { ...finalised, action: "cleanup-pending" as const };
        expect(details(report("advance", [reconciled([pending])]))).toEqual([
            "  ✔ linear:DOT-98 grill-me → proposal",
        ]);
    });

    it("says so when the task carries no single stage label", () => {
        const unlabelled = { ...finalised, stageNow: null };
        expect(details(report("advance", [reconciled([unlabelled])]))).toEqual([
            "  ✔ linear:DOT-98 grill-me → no single stage label",
        ]);
    });

    it("names a newly retained attempt with its reason", () => {
        const retained = attempt({
            id: "linear:DOT-77:grill-me:1",
            state: "retained",
            action: "retained",
            detail: "session exited; stage grill-me check does not hold",
        });
        expect(details(report("advance", [reconciled([retained])]))).toEqual([
            "  ⚠ retained linear:DOT-77:grill-me:1: session exited; stage grill-me check does not hold",
        ]);
    });

    it("tells a pending attempt retained as ambiguous", () => {
        const ambiguous = attempt({
            before: "pending",
            state: "retained",
            action: "ambiguous",
            detail: "2 sessions share /w/x: a, b",
        });
        expect(details(report("advance", [reconciled([ambiguous])]))).toEqual([
            "  ⚠ retained linear:DOT-98:grill-me:1: 2 sessions share /w/x: a, b",
        ]);
    });

    it("tells a retained attempt once, not in the iterations after", () => {
        const still = attempt({ before: "retained", state: "retained", action: "none" });
        expect(details(report("advance", [reconciled([still])]))).toEqual([]);
    });

    it("records nothing for a session waiting for the person", () => {
        const waiting = attempt({
            session: { state: "open", status: "waiting", busy: false, needsHuman: true },
        });
        expect(details(report("advance", [reconciled([waiting])]))).toEqual([]);
    });

    it("keeps the attempts' order", () => {
        const retained = attempt({
            id: "linear:DOT-99:grill-me:2",
            state: "retained",
            action: "retained",
            detail: "gone",
        });
        expect(details(report("advance", [reconciled([finalised, retained])]))).toEqual([
            "  ✔ linear:DOT-98 grill-me → proposal",
            "  ⚠ retained linear:DOT-99:grill-me:2: gone",
        ]);
    });
});

describe("iterationNotices summary line", () => {
    it("names the stage with its emoji and the task of a launch (launch)", () => {
        const steps = [reconciled([]), launched("proposal", "X-12")];
        expect(summary(report("advance", steps))).toBe(
            "10:40 ▶ launched 📝 proposal beads:X-12 · next 10:50",
        );
    });

    it("leaves out the emoji and its space for a stage that declares none", () => {
        const steps = [launched("ready-to-merge", "X-12")];
        expect(summary(report("advance", steps))).toBe(
            "10:40 ▶ launched ready-to-merge beads:X-12 · next 10:50",
        );
    });

    it("names the step that waited and its first reason (slots full)", () => {
        const steps = [
            reconciled([]),
            stopStep("capacity", "wait", ["every slot kind is full", "second reason"]),
        ];
        expect(summary(report("wait", steps))).toBe(
            "10:40 ⏸ nothing to launch: capacity: every slot kind is full · next 10:50",
        );
    });

    it("names the step and the first reason of an iteration that is not evaluable", () => {
        const steps = [stopStep("select", "not-evaluable", ["cannot read tasks"])];
        expect(summary(report("not-evaluable", steps))).toBe(
            "10:40 ✖ not evaluable: select: cannot read tasks · next 10:50",
        );
    });

    it("names the reason of the run lock when no step ran (not evaluable)", () => {
        const locked = { ...report("not-evaluable"), lock: { error: "run lock held by pid 42" } };
        expect(summary(locked)).toBe("10:40 ✖ not evaluable: run lock held by pid 42 · next 10:50");
    });

    it("names only the step when it gave no reason, without a trailing colon", () => {
        const steps = [stopStep("quota", "wait", [])];
        expect(summary(report("wait", steps))).toBe(
            "10:40 ⏸ nothing to launch: quota · next 10:50",
        );
    });

    it("takes the first step that did not advance", () => {
        const steps = [
            stopStep("reconcile", "advance", []),
            stopStep("quota", "wait", ["quota spent"]),
            stopStep("select", "not-evaluable", ["late"]),
        ];
        expect(summary(report("wait", steps))).toContain("quota: quota spent");
    });

    it("uses the next time it is given (interval changed)", () => {
        const steps = [launched("proposal", "X-12")];
        const line = iterationNotices(report("advance", steps), [], {
            ended: "10:40",
            next: "10:45",
        })[0];
        expect(line).toMatch(/ · next 10:45$/);
    });

    it("names the launch step when it advanced without an attempt", () => {
        const { data, ...step } = launched("proposal", "X-12");
        const dry = { ...step, data: { ...(data as object), attempt: null } };
        expect(summary(report("advance", [reconciled([]), dry]))).toBe(
            "10:40 ⏸ nothing to launch: launch: launched · next 10:50",
        );
    });

    it("says nothing was launched for a report whose steps all advanced and none launched", () => {
        expect(summary(report("advance", [reconciled([])]))).toBe(
            "10:40 ⏸ nothing to launch · next 10:50",
        );
    });
});

describe("iterationNotices stuck count in the summary line", () => {
    const stuckThree = [1, 2, 3].map((n) => stuckTask(`X-${n}`));

    it("counts every stuck task of the machine scope, told or not (three stuck tasks already told)", () => {
        const steps = [selected(stuckThree), launched("proposal", "X-12")];
        const iteration = report("advance", steps);
        expect(summary(iteration)).toBe(
            "10:40 ▶ launched 📝 proposal beads:X-12 · 3 need you · next 10:50",
        );
        expect(details(iteration)).toEqual([]);
    });

    it("carries the count before the next time on a waiting iteration", () => {
        const steps = [selected(stuckThree)];
        expect(summary(report("wait", steps))).toBe(
            "10:40 ⏸ nothing to launch: select · 3 need you · next 10:50",
        );
    });

    it("leaves out stuck tasks of another scope and tasks that are not stuck", () => {
        const tasks = [
            stuckTask("W-1", { scope: "work" }),
            stuckTask("B-1", { reason: "blocked", stuck: false }),
            stuckTask("N-1", { scope: null }),
            stuckTask("X-1"),
        ];
        expect(summary(report("wait", [selected(tasks)]))).toContain(" · 1 need you · ");
    });

    it("carries no count with none stuck", () => {
        const steps = [selected([stuckTask("B-1", { reason: "blocked", stuck: false })])];
        expect(summary(report("wait", steps))).not.toContain("need you");
    });

    it("carries no count when selection did not run (quota gate)", () => {
        const steps = [stopStep("quota", "wait", ["quota spent"])];
        expect(summary(report("wait", steps))).not.toContain("need you");
    });
});

describe("notice symbols", () => {
    it("starts both lines with the warning symbol for a retained attempt and a stuck task (one symbol per kind)", () => {
        const retained = attempt({ state: "retained", action: "retained", detail: "gone" });
        const told = stuckNotices(report("wait", [selected([stuckTask("X-12")])]), []);
        const lines = details(report("advance", [reconciled([retained])]), told.notices);
        expect(lines).toHaveLength(2);
        expect(lines.every((line) => line.startsWith("  ⚠ "))).toBe(true);
    });

    it("holds no escape character in any line (no control sequences)", () => {
        const retained = attempt({
            id: "linear:DOT-77:grill-me:1",
            state: "retained",
            action: "retained",
            detail: "gone",
        });
        const tasks = Array.from({ length: 7 }, (_, n) => stuckTask(`X-${n}`));
        const steps = [
            reconciled([finalised, retained]),
            triage(["a", "b"].map((id) => mark("beads", id))),
            selected(tasks),
            launched("proposal", "X-12"),
        ];
        const iteration = report("advance", steps);
        const lines = [
            ...iterationNotices(iteration, stuckNotices(iteration, []).notices, TIMES),
            stopNotice("11:02", "received SIGINT"),
        ];
        expect(lines.length).toBeGreaterThan(8);
        expect(lines.some((line) => [...line].some((c) => c.codePointAt(0) === 27))).toBe(false);
    });
});

describe("iterationNotices of newly marked tasks", () => {
    it("names the count and the tasks newly marked (tasks newly marked)", () => {
        const marked = [mark("linear", "DOT-130"), mark("beads", "X-12")];
        expect(details(report("advance", [triage(marked)]))).toEqual([
            "  ⚠ triage-me +2: linear:DOT-130, beads:X-12",
        ]);
    });

    it("names five tasks and ends with an ellipsis when more were marked (many tasks newly marked)", () => {
        const marked = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => mark("beads", id));
        expect(details(report("advance", [triage(marked)]))).toEqual([
            "  ⚠ triage-me +8: beads:a, beads:b, beads:c, beads:d, beads:e, …",
        ]);
    });

    it("names all five tasks without an ellipsis when exactly five were marked", () => {
        const marked = ["a", "b", "c", "d", "e"].map((id) => mark("beads", id));
        expect(details(report("advance", [triage(marked)]))).toEqual([
            "  ⚠ triage-me +5: beads:a, beads:b, beads:c, beads:d, beads:e",
        ]);
    });

    it("tells nothing for tasks marked in an earlier iteration (marked in an earlier iteration)", () => {
        expect(details(report("advance", [triage([], 2)]))).toEqual([]);
    });

    it("counts only the marks that were applied", () => {
        const marked = [
            mark("linear", "DOT-130"),
            mark("linear", "DOT-131", "proposed"),
            mark("beads", "X-12", "failed"),
        ];
        expect(details(report("advance", [triage(marked)]))).toEqual([
            "  ⚠ triage-me +1: linear:DOT-130",
        ]);
    });

    it("tells nothing when every mark was only proposed or failed", () => {
        const marked = [mark("linear", "DOT-131", "proposed"), mark("beads", "X-12", "failed")];
        expect(details(report("advance", [triage(marked)]))).toEqual([]);
    });

    it("records no detail line for an iteration that launches and tells nothing (nothing beyond the summary)", () => {
        const steps = [reconciled([]), triage([]), launched("proposal", "X-12")];
        expect(iterationNotices(report("advance", steps), [], TIMES)).toHaveLength(1);
    });

    it("follows the attempts' notices, and the stuck lines come last", () => {
        const steps = [reconciled([finalised]), triage([mark("linear", "DOT-130")])];
        expect(details(report("advance", steps), ["  ⚠ stuck beads:X-12: why"])).toEqual([
            "  ✔ linear:DOT-98 grill-me → proposal",
            "  ⚠ triage-me +1: linear:DOT-130",
            "  ⚠ stuck beads:X-12: why",
        ]);
    });
});

const REPOSITORY = "no repository label names a directory of the workspace";

function entry(
    task: string,
    exclusion = "repository",
    detail = REPOSITORY,
    scope: StuckEntry["scope"] = "personal",
): StuckEntry {
    return { task, exclusion, detail, scope };
}

describe("stuckNotices", () => {
    it("names a stuck task of the machine scope the first time, with its reason", () => {
        const told = stuckNotices(report("wait", [selected([stuckTask("X-12")])]), []);
        expect(told.notices).toEqual([`  ⚠ stuck beads:X-12: ${REPOSITORY}`]);
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
        expect(told.notices).toEqual(["  ⚠ stuck beads:X-12: no OpenSpec root in /w/x"]);
        expect(told.entries).toEqual([
            entry("beads:X-12", "repository-prerequisites", "no OpenSpec root in /w/x"),
        ]);
    });

    it("tells a changed detail of the same exclusion again", () => {
        const now = stuckTask("X-12", { detail: "2 repository labels: a, b" });
        const told = stuckNotices(report("wait", [selected([now])]), [entry("beads:X-12")]);
        expect(told.notices).toEqual(["  ⚠ stuck beads:X-12: 2 repository labels: a, b"]);
    });

    it("names five tasks and counts the rest and the log when more are new", () => {
        const tasks = Array.from({ length: 56 }, (_, n) => stuckTask(`X-${n}`));
        const told = stuckNotices(report("wait", [selected(tasks)]), []);
        expect(told.notices).toEqual([
            ...[0, 1, 2, 3, 4].map((n) => `  ⚠ stuck beads:X-${n}: ${REPOSITORY}`),
            "  ⚠ stuck +51 more: see loop.log",
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
        expect(told.entries).toEqual([entry("beads:X-12", "repository", REPOSITORY, "work")]);
    });

    it("tells a task of another scope once the machine scope takes it, and then no more", () => {
        const work = stuckTask("X-12", { scope: "work" });
        const first = stuckNotices(report("wait", [selected([work], "personal")]), []);
        expect(first.notices).toEqual([]);

        const now = stuckTask("X-12");
        const second = stuckNotices(report("wait", [selected([now])]), first.entries);
        expect(second.notices).toEqual([`  ⚠ stuck beads:X-12: ${REPOSITORY}`]);
        expect(second.entries).toEqual([entry("beads:X-12")]);

        const third = stuckNotices(report("wait", [selected([now])]), [
            ...first.entries,
            ...second.entries,
        ]);
        expect(third).toEqual({ notices: [], entries: [] });
    });

    it("does not let a task of another scope take one of the five", () => {
        const tasks = [stuckTask("W-1", { scope: "work" }), stuckTask("X-1")];
        expect(stuckNotices(report("wait", [selected(tasks)]), []).notices).toEqual([
            `  ⚠ stuck beads:X-1: ${REPOSITORY}`,
        ]);
    });

    it("uses the exclusion when the reason has no detail", () => {
        const told = stuckNotices(
            report("wait", [selected([stuckTask("X-12", { detail: null })])]),
            [],
        );
        expect(told.notices).toEqual(["  ⚠ stuck beads:X-12: repository"]);
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
            "  ⚠ stuck beads:A-1: attempt a is retained",
            "  ⚠ stuck beads:P-1: lacks a skill",
            "  ⚠ stuck beads:U-1: cannot read",
            "  ⚠ stuck beads:O-1: no OpenSpec root",
            `  ⚠ stuck beads:R-0: ${REPOSITORY}`,
            "  ⚠ stuck +2 more: see loop.log",
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
            "  ⚠ stuck beads:X-12: cannot read",
        ]);
    });

    it("tells nothing when the iteration has no select data", () => {
        expect(stuckNotices(report("not-evaluable"), [])).toEqual({ notices: [], entries: [] });
    });
});

describe("stopNotice", () => {
    it("names the time, the symbol and the reason", () => {
        expect(stopNotice("11:02", "received SIGINT")).toBe(
            "11:02 ■ loop stopped: received SIGINT",
        );
    });
});
