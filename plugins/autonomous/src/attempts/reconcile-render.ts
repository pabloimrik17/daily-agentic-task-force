import type { StepResult } from "../runner.ts";
import type { ReconciledAttempt, ReconcileData } from "./reconcile.ts";

// Spec "Attempt report": every attempt with its state, its session, whether it
// needs a person and what was done to it, then the lists a person acts on.
export function renderReconcile(result: StepResult<ReconcileData>): string {
    const { attempts, retained, cleanups, needsHuman } = result.data;
    const lines = [`[${result.step}] ${result.outcome} (${result.tier})`];
    lines.push(...attempts.map(renderAttempt));
    lines.push(
        ...renderList("retained", retained),
        ...renderList("cleanups", cleanups),
        ...renderList("needs a person", needsHuman),
    );
    lines.push("  reasons:", ...result.reasons.map((r) => `    - ${r}`));
    return lines.join("\n");
}

function renderAttempt(attempt: ReconciledAttempt): string {
    const detail = attempt.detail === null ? "" : `: ${attempt.detail}`;
    return [
        `  ${attempt.id}`,
        `${attempt.before} → ${attempt.state}`,
        renderSession(attempt.session),
        renderMarker(attempt.marker),
        `${attempt.action}${detail}`,
    ].join("  ");
}

function renderSession(session: ReconciledAttempt["session"]): string {
    if (session === null) {
        return "session not observed";
    }
    const flags = [
        ...(session.needsHuman ? ["needs a person"] : []),
        ...(session.busy ? ["busy"] : []),
    ];
    return [`session ${session.status}/${session.state}`, ...flags].join(", ");
}

function renderMarker(marker: ReconciledAttempt["marker"]): string {
    if (marker === null) {
        return "marker not checked";
    }
    return marker.ok ? "marker ok" : `marker ${marker.reason}`;
}

function renderList(name: string, ids: readonly string[]): string[] {
    return ids.length === 0 ? [] : [`  ${name}:`, ...ids.map((id) => `    ${id}`)];
}
