import type { StepResult } from "../runner.ts";
import type { CapacityData, KindCapacity } from "./step.ts";

// Spec "Capacity report".
export function renderCapacity(result: StepResult<CapacityData | null>): string {
    const lines = [`[${result.step}] ${result.outcome} (${result.tier})`];
    if (result.data !== null) {
        lines.push(...renderKind("grill slots", result.data.grill));
        lines.push(...renderKind("work slots", result.data.work));
    }
    lines.push("  reasons:", ...result.reasons.map((r) => `    - ${r}`));
    return lines.join("\n");
}

function renderKind(label: string, kind: KindCapacity): string[] {
    const head = `  ${label.padEnd(11)} ${kind.occupied}/${kind.limit}  limit from ${kind.source}`;
    return [`${head}${state(kind)}`, ...kind.attempts.map((id) => `    ${id}`)];
}

function state({ occupied, limit, full }: KindCapacity): string {
    if (occupied > limit) {
        return "  over its limit";
    }
    return full ? "  full" : "";
}
