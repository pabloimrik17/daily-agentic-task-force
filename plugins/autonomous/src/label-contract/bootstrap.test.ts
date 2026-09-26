import { describe, expect, it } from "vitest";

import { type AutonomousConfig, CONFIG_SCHEMA, type Source } from "../config.ts";
import type {
    Tracker,
    TrackerLabel,
    TrackerResult,
    Trackers,
} from "../label-triage/trackers/tracker.ts";
import { bootstrapLabels, renderBootstrapJson, renderBootstrapText } from "./bootstrap.ts";

const STARTED = new Date("2026-09-26T10:00:00.000Z");

const UNAUTHENTICATED =
    "linear label list --all --json: Linear CLI is not authenticated, run `linear auth login`";

interface Fake {
    tracker: Tracker;
    listed: number;
    created: [string, string, string][];
}

function fake(
    source: Source,
    options: {
        labelScopes?: string[];
        createsLabels?: boolean;
        labels?: TrackerResult<TrackerLabel[]>;
        create?: (scope: string, name: string) => TrackerResult<void>;
    } = {},
): Fake {
    const unused = () => Promise.reject(new Error("not used by the bootstrap"));
    const result: Fake = {
        listed: 0,
        created: [],
        tracker: {
            source,
            labelScopes: options.labelScopes ?? [],
            createsLabels: options.createsLabels ?? true,
            listTasks: unused,
            readTask: unused,
            addLabel: unused,
            listLabels: () => {
                result.listed++;
                return Promise.resolve(options.labels ?? { ok: true, value: [] });
            },
            createLabel: (scope, name, colour) => {
                result.created.push([scope, name, colour]);
                return Promise.resolve(
                    options.create?.(scope, name) ?? { ok: true, value: undefined },
                );
            },
        },
    };
    return result;
}

function beads(): Fake {
    return fake("beads", {
        createsLabels: false,
        create: () => ({ ok: false, error: "Beads needs no label creation: labels exist by use" }),
    });
}

function trackers(fakes: { beads: Fake; github: Fake; linear: Fake }): Trackers {
    return {
        beads: fakes.beads.tracker,
        github: fakes.github.tracker,
        linear: fakes.linear.tracker,
    };
}

function config(enabled: Partial<Record<Source, boolean>> = {}): AutonomousConfig {
    return {
        schema: CONFIG_SCHEMA,
        sources: {
            linear: { enabled: enabled.linear ?? true },
            beads: { enabled: enabled.beads ?? true, directory: "/repo" },
            github: { enabled: enabled.github ?? true, repos: ["owner/repo"] },
        },
        judgement: {
            model: "claude-sonnet-5",
            effort: "medium",
            threshold: 0.95,
            cap: 25,
            batch: 20,
        },
    };
}

const workspace = (name: string, colour: string): TrackerLabel => ({
    scope: "workspace",
    name,
    colour,
});

const everyWorkspaceLabelExcept = (missing: string): TrackerLabel[] =>
    (
        [
            ["work", "#2f80ed"],
            ["personal", "#27ae60"],
            ["AFK", "#5e6ad2"],
            ["HITL", "#eb5757"],
            ["grill-me", "#f2994a"],
        ] as const
    )
        .filter(([name]) => name !== missing)
        .map(([name, colour]) => workspace(name, colour));

describe("bootstrapLabels", () => {
    it("creates a label missing on Linear at workspace level with its colour", async () => {
        const linear = fake("linear", {
            labelScopes: ["workspace"],
            labels: { ok: true, value: everyWorkspaceLabelExcept("work") },
        });
        const report = await bootstrapLabels(
            trackers({ beads: beads(), github: fake("github"), linear }),
            config({ beads: false, github: false }),
            STARTED,
        );
        expect(linear.created).toEqual([["workspace", "work", "#2f80ed"]]);
        expect(report.sources).toHaveLength(1);
        expect(report.sources[0]?.labels[0]).toEqual({
            scope: "workspace",
            label: "work",
            status: "created",
            colour: "#2f80ed",
            expected: null,
            note: null,
        });
        expect(report.outcome).toBe("advance");
    });

    it("leaves a GitHub label with another colour as it is and reports the difference", async () => {
        const github = fake("github", {
            labelScopes: ["owner/repo"],
            labels: { ok: true, value: [{ scope: "owner/repo", name: "AFK", colour: "#000000" }] },
        });
        const report = await bootstrapLabels(
            trackers({ beads: beads(), github, linear: fake("linear") }),
            config({ beads: false, linear: false }),
            STARTED,
        );
        expect(github.created.map(([, name]) => name)).toEqual([
            "work",
            "personal",
            "HITL",
            "grill-me",
        ]);
        expect(report.sources[0]?.labels.find((label) => label.label === "AFK")).toEqual({
            scope: "owner/repo",
            label: "AFK",
            status: "present",
            colour: "#000000",
            expected: "#5e6ad2",
            note: "colour differs",
        });
        expect(report.outcome).toBe("advance");
    });

    it("reports a present label with the contract colour without a note", async () => {
        const linear = fake("linear", {
            labelScopes: ["workspace"],
            labels: { ok: true, value: everyWorkspaceLabelExcept("none") },
        });
        const report = await bootstrapLabels(
            trackers({ beads: beads(), github: fake("github"), linear }),
            config({ beads: false, github: false }),
            STARTED,
        );
        expect(linear.created).toEqual([]);
        expect(report.sources[0]?.labels.every((label) => label.note === null)).toBe(true);
        expect(report.sources[0]?.labels.map((label) => label.status)).toEqual(
            Array(5).fill("present"),
        );
    });

    it("creates labels per configured repository, matching labels only in their own scope", async () => {
        const github = fake("github", {
            labelScopes: ["owner/a", "owner/b"],
            labels: {
                ok: true,
                value: [
                    { scope: "owner/a", name: "work", colour: "#2f80ed" },
                    { scope: "owner/b", name: "personal", colour: "#27ae60" },
                ],
            },
        });
        await bootstrapLabels(
            trackers({ beads: beads(), github, linear: fake("linear") }),
            config({ beads: false, linear: false }),
            STARTED,
        );
        expect(github.created.map(([scope, name]) => `${scope} ${name}`)).toEqual([
            "owner/a personal",
            "owner/a AFK",
            "owner/a HITL",
            "owner/a grill-me",
            "owner/b work",
            "owner/b AFK",
            "owner/b HITL",
            "owner/b grill-me",
        ]);
    });

    it("reports that Beads needs no label creation and creates nothing there", async () => {
        const source = beads();
        const report = await bootstrapLabels(
            trackers({ beads: source, github: fake("github"), linear: fake("linear") }),
            config({ github: false, linear: false }),
            STARTED,
        );
        expect(source.listed).toBe(0);
        expect(source.created).toEqual([]);
        expect(report.sources).toEqual([
            {
                source: "beads",
                applicable: false,
                evaluable: true,
                reason: "Beads needs no label creation: labels exist by use",
                labels: [],
            },
        ]);
        expect(report.outcome).toBe("advance");
    });

    it("reports an unauthenticated Linear as not evaluable and still processes GitHub and Beads", async () => {
        const github = fake("github", { labelScopes: ["owner/repo"] });
        const linear = fake("linear", {
            labelScopes: ["workspace"],
            labels: { ok: false, error: UNAUTHENTICATED },
        });
        const report = await bootstrapLabels(
            trackers({ beads: beads(), github, linear }),
            config(),
            STARTED,
        );
        expect(report.sources.map((entry) => entry.source)).toEqual(["beads", "github", "linear"]);
        expect(github.created).toHaveLength(5);
        expect(linear.created).toEqual([]);
        expect(report.sources[2]).toEqual({
            source: "linear",
            applicable: true,
            evaluable: false,
            reason: UNAUTHENTICATED,
            labels: [],
        });
        expect(report.sources[2]?.reason).toContain("linear auth login");
        expect(report.outcome).toBe("not-evaluable");
    });

    it("processes every later source although an earlier one fails", async () => {
        const github = fake("github", {
            labelScopes: ["owner/repo"],
            labels: {
                ok: false,
                error: "gh label list --repo owner/repo: gh CLI not found on PATH",
            },
        });
        const linear = fake("linear", { labelScopes: ["workspace"] });
        const report = await bootstrapLabels(
            trackers({ beads: beads(), github, linear }),
            config(),
            STARTED,
        );
        expect(linear.created).toHaveLength(5);
        expect(report.sources[1]).toMatchObject({ source: "github", evaluable: false });
        expect(report.sources[2]).toMatchObject({ source: "linear", evaluable: true });
        expect(report.outcome).toBe("not-evaluable");
    });

    it("reports a label that could not be created as failed and the run as not evaluable", async () => {
        const linear = fake("linear", {
            labelScopes: ["workspace"],
            labels: { ok: true, value: everyWorkspaceLabelExcept("HITL") },
            create: () => ({
                ok: false,
                error: "linear label create: linear failed: rate limited",
            }),
        });
        const report = await bootstrapLabels(
            trackers({ beads: beads(), github: fake("github"), linear }),
            config({ beads: false, github: false }),
            STARTED,
        );
        expect(report.sources[0]?.evaluable).toBe(true);
        expect(report.sources[0]?.labels.find((label) => label.label === "HITL")).toEqual({
            scope: "workspace",
            label: "HITL",
            status: "failed",
            colour: null,
            expected: null,
            note: "linear label create: linear failed: rate limited",
        });
        expect(report.outcome).toBe("not-evaluable");
    });

    it("omits a disabled source and never calls its tracker", async () => {
        const github = fake("github", { labelScopes: ["owner/repo"] });
        const linear = fake("linear", { labelScopes: ["workspace"] });
        const report = await bootstrapLabels(
            trackers({ beads: beads(), github, linear }),
            config({ github: false }),
            STARTED,
        );
        expect(report.sources.map((entry) => entry.source)).toEqual(["beads", "linear"]);
        expect(github.listed).toBe(0);
        expect(github.created).toEqual([]);
    });

    it("does not list labels for a source with no label scopes", async () => {
        const github = fake("github");
        const report = await bootstrapLabels(
            trackers({ beads: beads(), github, linear: fake("linear") }),
            config({ beads: false, linear: false }),
            STARTED,
        );
        expect(github.listed).toBe(0);
        expect(report.sources).toEqual([
            { source: "github", applicable: true, evaluable: true, reason: null, labels: [] },
        ]);
        expect(report.outcome).toBe("advance");
    });
});

describe("renderBootstrapText", () => {
    it("prints one line per source and per GitHub repository", async () => {
        const github = fake("github", {
            labelScopes: ["owner/repo", "owner/other"],
            labels: {
                ok: true,
                value: [
                    { scope: "owner/repo", name: "AFK", colour: "#000000" },
                    ...everyWorkspaceLabelExcept("none").map((label) => ({
                        ...label,
                        scope: "owner/other",
                    })),
                ],
            },
            create: (scope, name) =>
                name === "grill-me"
                    ? {
                          ok: false,
                          error: `gh label create grill-me --repo ${scope}: gh failed: HTTP 403`,
                      }
                    : { ok: true, value: undefined },
        });
        const linear = fake("linear", {
            labelScopes: ["workspace"],
            labels: { ok: false, error: UNAUTHENTICATED },
        });
        const report = await bootstrapLabels(
            trackers({ beads: beads(), github, linear }),
            config(),
            STARTED,
        );
        expect(renderBootstrapText(report)).toBe(
            [
                "label bootstrap — started 2026-09-26T10:00:00.000Z",
                "outcome: not-evaluable",
                "  beads     not applicable — Beads needs no label creation: labels exist by use",
                "  github    owner/repo: created work, personal, HITL; present AFK (colour #000000, expected #5e6ad2); failed grill-me (gh label create grill-me --repo owner/repo: gh failed: HTTP 403)",
                "  github    owner/other: present work, personal, AFK, HITL, grill-me",
                `  linear    not evaluable — ${UNAUTHENTICATED}`,
            ].join("\n"),
        );
    });

    it("says so when an evaluable source has no label scopes", async () => {
        const report = await bootstrapLabels(
            trackers({ beads: beads(), github: fake("github"), linear: fake("linear") }),
            config({ beads: false, linear: false }),
            STARTED,
        );
        expect(renderBootstrapText(report)).toBe(
            [
                "label bootstrap — started 2026-09-26T10:00:00.000Z",
                "outcome: advance",
                "  github    no label scopes to bootstrap",
            ].join("\n"),
        );
    });
});

describe("renderBootstrapJson", () => {
    it("prints the report as one autonomous.bootstrap.v1 JSON document", async () => {
        const report = await bootstrapLabels(
            trackers({
                beads: beads(),
                github: fake("github", { labelScopes: ["owner/repo"] }),
                linear: fake("linear", { labelScopes: ["workspace"] }),
            }),
            config(),
            STARTED,
        );
        const json = renderBootstrapJson(report);
        expect(json).toBe(JSON.stringify(report, null, 2));
        expect(JSON.parse(json)).toMatchObject({
            schema: "autonomous.bootstrap.v1",
            startedAt: "2026-09-26T10:00:00.000Z",
            outcome: "advance",
        });
    });
});
