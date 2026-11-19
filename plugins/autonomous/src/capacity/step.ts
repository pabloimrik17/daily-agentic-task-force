// The capacity step (spec slot-limits; design D1, D2): counts the open attempts of
// `reconcile`, as it left them, per kind of slot, and compares them with the limits.
// It writes nothing and holds an iteration back only when every kind is full.

import { type AttemptId, OPEN_STATES, parseAttemptId } from "../attempts/record.ts";
import type { ReconcileData } from "../attempts/reconcile.ts";
import type { RunContext, Step, StepResult } from "../runner.ts";
import { resolveRunnerSettings, type Setting, type SettingSource } from "../runner-settings.ts";
import { renderCapacity } from "./render.ts";

export interface KindCapacity {
    occupied: number;
    limit: number;
    source: SettingSource;
    attempts: AttemptId[]; // the open attempts that occupy the slots, in id order
    full: boolean; // occupied >= limit; a limit of 0 is full
}

export interface CapacityData {
    grill: KindCapacity; // open attempts at the grill-me stage
    work: KindCapacity; // open attempts at any other stage
}

const CAPACITY = "capacity";

function result(
    outcome: StepResult["outcome"],
    reasons: string[],
    data: CapacityData | null,
): StepResult<CapacityData | null> {
    return { step: CAPACITY, tier: "code", outcome, reasons, data };
}

function kindOf(ids: readonly AttemptId[], { value, source }: Setting): KindCapacity {
    return {
        occupied: ids.length,
        limit: value,
        source,
        attempts: [...ids],
        full: ids.length >= value,
    };
}

// Spec "What occupies a slot": the open states, and a completed attempt whose cleanup is owed.
// Without --apply `reconcile` leaves the state as it was, so its action tells which
// attempts the real iteration would no longer find open.
const LEAVING: ReadonlySet<string> = new Set(["finalised", "aborted"]);

function openIds({ attempts, cleanups }: ReconcileData): AttemptId[] {
    return attempts
        .filter(({ action }) => !LEAVING.has(action))
        .filter(({ id, state }) => OPEN_STATES.includes(state) || cleanups.includes(id))
        .map(({ id }) => id);
}

const isGrill = (id: AttemptId) => parseAttemptId(id)?.stage === "grill-me";

function summary(label: string, kind: KindCapacity): string {
    return `${label} ${kind.occupied}/${kind.limit}`;
}

export const capacityStep: Step<CapacityData | null> = {
    id: CAPACITY,
    run(ctx: RunContext) {
        if (!ctx.config.ok) {
            return Promise.resolve(result("not-evaluable", [ctx.config.error], null));
        }
        const reconcile = ctx.results.find((r) => r.step === "reconcile");
        if (reconcile === undefined) {
            return Promise.resolve(
                result("not-evaluable", ["the reconcile step has not run"], null),
            );
        }
        const open = openIds(reconcile.data as ReconcileData);
        const settings = resolveRunnerSettings(ctx.args, ctx.config);
        const data = {
            grill: kindOf(open.filter(isGrill), settings.grills),
            work: kindOf(
                open.filter((id) => !isGrill(id)),
                settings.parallel,
            ),
        };
        const sums = [summary("grill slots", data.grill), summary("work slots", data.work)];
        if (ctx.args.loop && data.grill.full && data.work.full) {
            return Promise.resolve(
                result("wait", [`every kind of slot is full: ${sums.join(", ")}`], data),
            );
        }
        return Promise.resolve(result("advance", sums, data));
    },
    render: renderCapacity,
};
