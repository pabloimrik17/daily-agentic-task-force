import { describe, expect, it } from "vitest";

import { project } from "./project.ts";
import { NOW } from "./test-fixtures.ts";

const HOUR = 3_600;
const DAY = 86_400;

// A window of `windowSeconds` that started `elapsedSeconds` before NOW.
function input(used: number, elapsedSeconds: number, windowSeconds: number, limit = 100) {
    return {
        used,
        limit,
        windowSeconds,
        resetsAt: new Date(NOW.getTime() + (windowSeconds - elapsedSeconds) * 1000),
        now: NOW,
    };
}

describe("project", () => {
    it("projects 20% after 2h of a 5h window to 50%", () => {
        const projection = project(input(20, 2 * HOUR, 5 * HOUR));
        expect(projection.available && projection.projectedUsage).toBeCloseTo(50);
    });

    it("projects 30% after 3d of a 7d window to 70%", () => {
        const projection = project(input(30, 3 * DAY, 7 * DAY));
        expect(projection.available && projection.projectedUsage).toBeCloseTo(70);
    });

    it.each([
        ["no consumption", input(0, 2 * HOUR, 5 * HOUR), "no-consumption"],
        ["2 minutes into a 5h window", input(20, 2 * 60, 5 * HOUR), "insufficient-elapsed"],
        ["a window not started yet", input(20, -60, 5 * HOUR), "insufficient-elapsed"],
        ["a window already reset", input(20, 5 * HOUR, 5 * HOUR), "window-expired"],
        ["a zero limit", input(20, 2 * HOUR, 5 * HOUR, 0), "non-positive-limit"],
        ["a zero window", input(20, 0, 0), "non-positive-window"],
    ])("gives no projection for %s", (_label, args, reason) => {
        expect(project(args)).toEqual({ available: false, reason });
    });

    it("projects once the minimum elapsed time is reached", () => {
        // max(60 s, 1% of 5h) = 180 s
        expect(project(input(1, 179, 5 * HOUR)).available).toBe(false);
        expect(project(input(1, 180, 5 * HOUR)).available).toBe(true);
    });
});
