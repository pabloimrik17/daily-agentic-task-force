import { describe, expect, it } from "vitest";

import { parseMarkers, renderMarker, threadMarker } from "./markers.ts";

const ATTEMPT = "linear:DOT-121:code-review:1";

describe("renderMarker", () => {
    it("renders a finding marker naming the attempt and the finding", () => {
        expect(renderMarker({ kind: "finding", attempt: ATTEMPT, finding: "f3" })).toBe(
            `<!-- autonomous:finding v1 attempt=${ATTEMPT} finding=f3 -->`,
        );
    });

    it("adds for=<stage> to a finding passed on", () => {
        expect(renderMarker({ kind: "finding", attempt: ATTEMPT, finding: "f4", for: "qa" })).toBe(
            `<!-- autonomous:finding v1 attempt=${ATTEMPT} finding=f4 for=qa -->`,
        );
    });

    it("renders a doubt, a resolution and a review marker", () => {
        expect(renderMarker({ kind: "doubt", attempt: ATTEMPT, finding: "d1" })).toBe(
            `<!-- autonomous:doubt v1 attempt=${ATTEMPT} finding=d1 -->`,
        );
        expect(
            renderMarker({ kind: "resolution", attempt: ATTEMPT, finding: "f3", state: "fixed" }),
        ).toBe(`<!-- autonomous:resolution v1 attempt=${ATTEMPT} finding=f3 state=fixed -->`);
        expect(renderMarker({ kind: "review", attempt: ATTEMPT, round: 2 })).toBe(
            `<!-- autonomous:review v1 attempt=${ATTEMPT} round=2 -->`,
        );
    });

    it("refuses a value with whitespace", () => {
        expect(() => renderMarker({ kind: "finding", attempt: ATTEMPT, finding: "f 3" })).toThrow(
            /finding/u,
        );
    });
});

describe("parseMarkers", () => {
    it("reads back every kind it renders", () => {
        const markers = [
            { kind: "finding", attempt: ATTEMPT, finding: "f4", for: "qa" },
            { kind: "doubt", attempt: ATTEMPT, finding: "d1" },
            { kind: "resolution", attempt: ATTEMPT, finding: "f3", state: "fixed" },
            { kind: "review", attempt: ATTEMPT, round: 1 },
        ] as const;
        const body = markers.map((marker) => `text\n${renderMarker(marker)}`).join("\n");
        expect(parseMarkers(body)).toEqual(markers);
    });

    it("ignores a human comment and a malformed or other-version marker", () => {
        const body = [
            "issue (blocking): looks wrong",
            "<!-- autonomous:finding v2 attempt=a finding=f1 -->",
            "<!-- autonomous:review v1 attempt=a round=x -->",
            "<!-- autonomous:resolution v1 attempt=a finding=f1 -->",
            "<!-- autonomous:logbook linear:DOT-109:test:1 -->",
        ].join("\n");
        expect(parseMarkers(body)).toEqual([]);
    });
});

describe("threadMarker", () => {
    it("returns the finding or doubt marker of a first comment", () => {
        const body = `question (blocking): why?\n${renderMarker({ kind: "doubt", attempt: ATTEMPT, finding: "d1" })}`;
        expect(threadMarker(body)).toEqual({ kind: "doubt", attempt: ATTEMPT, finding: "d1" });
    });

    it("returns null for a comment without one", () => {
        expect(threadMarker("nit: rename this")).toBeNull();
    });
});
