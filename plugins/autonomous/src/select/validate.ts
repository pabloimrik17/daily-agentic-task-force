// Validate the comparison in design D6's order; identity is the source/id
// pair, and an in-scope selection never carries a scope exception.

import type { Scope } from "../config.ts";
import type { Candidate, SelectedUnit, SelectionAnswer } from "./types.ts";

export function validateSelection(
    answer: SelectionAnswer,
    candidates: readonly Candidate[],
    machineScope: Scope,
): { ok: true; selected: SelectedUnit } | { ok: false; error: string } {
    const chosen = candidates.find(
        ({ task }) => task.source === answer.source && task.id === answer.id,
    );
    if (!chosen) {
        return { ok: false, error: `selection ${answer.source}:${answer.id} is not a candidate` };
    }
    const explanation = answer.explanation.trim();
    if (explanation === "") {
        return { ok: false, error: "selection explanation must be non-empty" };
    }
    const outsideScope = chosen.scope !== machineScope;
    const exception = outsideScope ? (answer.exception?.trim() ?? "") : null;
    if (outsideScope && exception === "") {
        return {
            ok: false,
            error: `selection ${answer.source}:${answer.id} is outside machine scope ${machineScope} and needs a non-empty exception`,
        };
    }
    return {
        ok: true,
        selected: {
            source: chosen.task.source,
            id: chosen.task.id,
            title: chosen.task.title,
            stage: chosen.stage,
            autonomy: chosen.autonomy,
            scope: chosen.scope,
            explanation,
            exception,
        },
    };
}
