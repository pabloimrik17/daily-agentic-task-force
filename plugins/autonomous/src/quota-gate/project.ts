// Reproduces `projectedUsage` from OpenUsage's `Pace.evaluate` (v0.7.12),
// including every condition under which it returns no result.

export type ProjectionUnavailableReason =
    | "non-positive-limit"
    | "non-positive-window"
    | "no-consumption"
    | "window-expired"
    | "insufficient-elapsed";

export type Projection =
    | { available: true; projectedUsage: number; elapsedSeconds: number }
    | { available: false; reason: ProjectionUnavailableReason };

export interface ProjectionInput {
    used: number;
    limit: number;
    resetsAt: Date;
    windowSeconds: number;
    now: Date;
}

export function project({
    used,
    limit,
    resetsAt,
    windowSeconds,
    now,
}: ProjectionInput): Projection {
    if (limit <= 0) return { available: false, reason: "non-positive-limit" };
    if (windowSeconds <= 0) return { available: false, reason: "non-positive-window" };
    if (used <= 0) return { available: false, reason: "no-consumption" };
    if (now.getTime() >= resetsAt.getTime()) return { available: false, reason: "window-expired" };

    const elapsedSeconds = (now.getTime() - resetsAt.getTime()) / 1000 + windowSeconds;
    if (elapsedSeconds < Math.max(60, windowSeconds * 0.01)) {
        return { available: false, reason: "insufficient-elapsed" };
    }
    return {
        available: true,
        projectedUsage: (used / elapsedSeconds) * windowSeconds,
        elapsedSeconds,
    };
}
