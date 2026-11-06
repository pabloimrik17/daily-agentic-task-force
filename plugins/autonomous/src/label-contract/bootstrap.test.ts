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
    recoloured: [TrackerLabel, string][];
}

function fake(
    source: Source,
    options: {
        labelScopes?: string[];
        createsLabels?: boolean;
        labels?: TrackerResult<TrackerLabel[]>;
        create?: (scope: string, name: string) => TrackerResult<void>;
        recolour?: (label: TrackerLabel, colour: string) => TrackerResult<void>;
    } = {},
): Fake {
    const unused = () => Promise.reject(new Error("not used by the bootstrap"));
    const result: Fake = {
        listed: 0,
        created: [],
        recoloured: [],
        tracker: {
            source,
            labelScopes: options.labelScopes ?? [],
            createsLabels: options.createsLabels ?? true,
            listTasks: unused,
            readTask: unused,
            addLabel: unused,
            removeLabel: unused,
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
            recolourLabel: (label, colour) => {
                result.recoloured.push([label, colour]);
                return Promise.resolve(
                    options.recolour?.(label, colour) ?? { ok: true, value: undefined },
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
        selection: { model: "sonnet", effort: "high" },
        sessions: { tool: "claude", profile: null, binary: null },
        workspace: { root: "/home/me/WebstormProjects" },
        naming: { model: "haiku", effort: "low" },
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
            ["proposal", "#bb87fc"],
            ["taken", "#95a2b3"],
        ] as const
    )
        .filter(([name]) => name !== missing)
        .map(([name, colour]) => workspace(name, colour));

describe("bootstrapLabels", () => {
    it("creates proposal, missing on Linear, at workspace level with its colour", async () => {
        const linear = fake("linear", {
            labelScopes: ["workspace"],
            labels: { ok: true, value: everyWorkspaceLabelExcept("proposal") },
        });
        const report = await bootstrapLabels(
            trackers({ beads: beads(), github: fake("github"), linear }),
            config({ beads: false, github: false }),
            STARTED,
        );
        expect(linear.created).toEqual([["workspace", "proposal", "#bb87fc"]]);
        expect(linear.recoloured).toEqual([]);
        expect(report.sources).toHaveLength(1);
        expect(report.sources[0]?.labels.find((label) => label.label === "proposal")).toEqual({
            scope: "workspace",
            label: "proposal",
            status: "created",
            colour: "#bb87fc",
            expected: null,
            note: null,
        });
        expect(report.outcome).toBe("advance");
    });

    it("recolours a GitHub label with another colour and reports it as recoloured", async () => {
        const dotfiles = { scope: "owner/dotfiles", name: "AFK", colour: "#000000" };
        const github = fake("github", {
            labelScopes: ["owner/dotfiles"],
            labels: { ok: true, value: [dotfiles] },
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
            "proposal",
            "taken",
        ]);
        expect(github.recoloured).toEqual([[dotfiles, "#5e6ad2"]]);
        expect(report.sources[0]?.labels.find((label) => label.label === "AFK")).toEqual({
            scope: "owner/dotfiles",
            label: "AFK",
            status: "recoloured",
            colour: "#5e6ad2",
            expected: null,
            note: "was #000000",
        });
        expect(report.outcome).toBe("advance");
    });

    it("recolours a Linear team label where it exists and creates no workspace duplicate", async () => {
        const team = { scope: "DOT", name: "HITL", colour: "#000000", id: "label-hitl" };
        const linear = fake("linear", {
            labelScopes: ["workspace"],
            labels: { ok: true, value: [...everyWorkspaceLabelExcept("HITL"), team] },
        });
        const report = await bootstrapLabels(
            trackers({ beads: beads(), github: fake("github"), linear }),
            config({ beads: false, github: false }),
            STARTED,
        );
        expect(linear.created).toEqual([]);
        expect(linear.recoloured).toEqual([[team, "#eb5757"]]);
        expect(report.sources[0]?.labels.find((label) => label.label === "HITL")).toEqual({
            scope: "DOT",
            label: "HITL",
            status: "recoloured",
            colour: "#eb5757",
            expected: null,
            note: "was #000000",
        });
        expect(report.outcome).toBe("advance");
    });

    it("recolours a contract label that appears in two Linear teams in each of them", async () => {
        const dot = { scope: "DOT", name: "HITL", colour: "#000000", id: "label-dot" };
        const web = { scope: "WEB", name: "HITL", colour: "#111111", id: "label-web" };
        const linear = fake("linear", {
            labelScopes: ["workspace"],
            labels: { ok: true, value: [...everyWorkspaceLabelExcept("HITL"), dot, web] },
        });
        const report = await bootstrapLabels(
            trackers({ beads: beads(), github: fake("github"), linear }),
            config({ beads: false, github: false }),
            STARTED,
        );
        expect(linear.created).toEqual([]);
        expect(linear.recoloured).toEqual([
            [dot, "#eb5757"],
            [web, "#eb5757"],
        ]);
        expect(report.sources[0]?.labels.filter((label) => label.label === "HITL")).toEqual([
            {
                scope: "DOT",
                label: "HITL",
                status: "recoloured",
                colour: "#eb5757",
                expected: null,
                note: "was #000000",
            },
            {
                scope: "WEB",
                label: "HITL",
                status: "recoloured",
                colour: "#eb5757",
                expected: null,
                note: "was #111111",
            },
        ]);
        expect(report.outcome).toBe("advance");
    });

    it("recolours the team label beside a workspace label of the same name with the contract colour", async () => {
        const team = { scope: "DOT", name: "HITL", colour: "#000000", id: "label-dot" };
        const linear = fake("linear", {
            labelScopes: ["workspace"],
            labels: { ok: true, value: [...everyWorkspaceLabelExcept("none"), team] },
        });
        const report = await bootstrapLabels(
            trackers({ beads: beads(), github: fake("github"), linear }),
            config({ beads: false, github: false }),
            STARTED,
        );
        expect(linear.created).toEqual([]);
        expect(linear.recoloured).toEqual([[team, "#eb5757"]]);
        expect(report.sources[0]?.labels.filter((label) => label.label === "HITL")).toEqual([
            {
                scope: "workspace",
                label: "HITL",
                status: "present",
                colour: "#eb5757",
                expected: null,
                note: null,
            },
            {
                scope: "DOT",
                label: "HITL",
                status: "recoloured",
                colour: "#eb5757",
                expected: null,
                note: "was #000000",
            },
        ]);
        expect(report.outcome).toBe("advance");
    });

    it("leaves a Linear label outside the contract untouched in every team", async () => {
        const bug = { scope: "DOT", name: "bug", colour: "#d73a4a", id: "label-bug" };
        const other = { scope: "WEB", name: "bug", colour: "#000000", id: "label-other" };
        const linear = fake("linear", {
            labelScopes: ["workspace"],
            labels: { ok: true, value: [...everyWorkspaceLabelExcept("none"), bug, other] },
        });
        const report = await bootstrapLabels(
            trackers({ beads: beads(), github: fake("github"), linear }),
            config({ beads: false, github: false }),
            STARTED,
        );
        expect(linear.created).toEqual([]);
        expect(linear.recoloured).toEqual([]);
        expect(report.sources[0]?.labels).toHaveLength(7);
        expect(report.sources[0]?.labels.map((label) => label.status)).toEqual(
            Array(7).fill("present"),
        );
    });

    it("creates taken on a GitHub repository that lacks it, with its colour", async () => {
        const github = fake("github", {
            labelScopes: ["owner/repo"],
            labels: {
                ok: true,
                value: everyWorkspaceLabelExcept("taken").map((label) => ({
                    ...label,
                    scope: "owner/repo",
                })),
            },
        });
        const report = await bootstrapLabels(
            trackers({ beads: beads(), github, linear: fake("linear") }),
            config({ beads: false, linear: false }),
            STARTED,
        );
        expect(github.created).toEqual([["owner/repo", "taken", "#95a2b3"]]);
        expect(report.sources[0]?.labels.find((label) => label.label === "taken")).toEqual({
            scope: "owner/repo",
            label: "taken",
            status: "created",
            colour: "#95a2b3",
            expected: null,
            note: null,
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
        expect(linear.recoloured).toEqual([]);
        expect(report.sources[0]?.labels.every((label) => label.note === null)).toBe(true);
        expect(report.sources[0]?.labels.map((label) => label.status)).toEqual(
            Array(7).fill("present"),
        );
    });

    it("reads the colour case-insensitively and leaves a label with no listed colour as present", async () => {
        const linear = fake("linear", {
            labelScopes: ["workspace"],
            labels: {
                ok: true,
                value: everyWorkspaceLabelExcept("none").map((label) => {
                    if (label.name === "AFK") {
                        return { ...label, colour: "#5E6AD2" };
                    }
                    return label.name === "HITL" ? { ...label, colour: null } : label;
                }),
            },
        });
        const report = await bootstrapLabels(
            trackers({ beads: beads(), github: fake("github"), linear }),
            config({ beads: false, github: false }),
            STARTED,
        );
        expect(linear.recoloured).toEqual([]);
        expect(report.sources[0]?.labels.map((label) => label.status)).toEqual(
            Array(7).fill("present"),
        );
    });

    it("counts a same-name Linear team label with the contract colour as present in its team", async () => {
        const linear = fake("linear", {
            labelScopes: ["workspace"],
            labels: {
                ok: true,
                value: [
                    ...everyWorkspaceLabelExcept("AFK"),
                    { scope: "DOT", name: "AFK", colour: "#5e6ad2", id: "label-afk" },
                ],
            },
        });
        const report = await bootstrapLabels(
            trackers({ beads: beads(), github: fake("github"), linear }),
            config({ beads: false, github: false }),
            STARTED,
        );
        expect(linear.created).toEqual([]);
        expect(linear.recoloured).toEqual([]);
        expect(report.sources[0]?.labels.find((label) => label.label === "AFK")).toEqual({
            scope: "DOT",
            label: "AFK",
            status: "present",
            colour: "#5e6ad2",
            expected: null,
            note: null,
        });
        expect(report.outcome).toBe("advance");
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
            "owner/a proposal",
            "owner/a taken",
            "owner/b work",
            "owner/b AFK",
            "owner/b HITL",
            "owner/b grill-me",
            "owner/b proposal",
            "owner/b taken",
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
        expect(source.recoloured).toEqual([]);
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
        expect(github.created).toHaveLength(7);
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
        expect(linear.created).toHaveLength(7);
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

    it("reports a label that could not be recoloured as failed, processes the others and is not evaluable", async () => {
        const error =
            "linear api issueLabelUpdate --variable id=label-afk --variable color=#5e6ad2: Linear did not report success";
        const linear = fake("linear", {
            labelScopes: ["workspace"],
            labels: {
                ok: true,
                value: everyWorkspaceLabelExcept("taken").map((label) =>
                    label.name === "AFK" || label.name === "HITL"
                        ? { ...label, colour: "#000000", id: `label-${label.name.toLowerCase()}` }
                        : label,
                ),
            },
            recolour: (label) =>
                label.name === "AFK" ? { ok: false, error } : { ok: true, value: undefined },
        });
        const report = await bootstrapLabels(
            trackers({ beads: beads(), github: fake("github"), linear }),
            config({ beads: false, github: false }),
            STARTED,
        );
        const labels = report.sources[0]?.labels ?? [];
        expect(labels.find((label) => label.label === "AFK")).toEqual({
            scope: "workspace",
            label: "AFK",
            status: "failed",
            colour: null,
            expected: null,
            note: error,
        });
        expect(linear.recoloured.map(([label, colour]) => [label.name, colour])).toEqual([
            ["AFK", "#5e6ad2"],
            ["HITL", "#eb5757"],
        ]);
        expect(labels.find((label) => label.label === "HITL")?.status).toBe("recoloured");
        expect(linear.created).toEqual([["workspace", "taken", "#95a2b3"]]);
        expect(report.sources[0]?.evaluable).toBe(true);
        expect(report.outcome).toBe("not-evaluable");
    });

    it("leaves a label outside the contract untouched and does not report it", async () => {
        const bug = { scope: "owner/dotfiles", name: "bug", colour: "#d73a4a" };
        const github = fake("github", {
            labelScopes: ["owner/dotfiles"],
            labels: {
                ok: true,
                value: [
                    bug,
                    ...everyWorkspaceLabelExcept("none").map((label) => ({
                        ...label,
                        scope: "owner/dotfiles",
                    })),
                ],
            },
        });
        const report = await bootstrapLabels(
            trackers({ beads: beads(), github, linear: fake("linear") }),
            config({ beads: false, linear: false }),
            STARTED,
        );
        expect(github.created).toEqual([]);
        expect(github.recoloured).toEqual([]);
        expect(report.sources[0]?.labels.map((label) => label.label as string)).not.toContain(
            "bug",
        );
        expect(report.sources[0]?.labels).toHaveLength(7);
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
    it("prints one line per source and per GitHub repository, with each status in order", async () => {
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
                "  github    owner/repo: created work, personal, HITL, proposal, taken; recoloured AFK (was #000000); failed grill-me (gh label create grill-me --repo owner/repo: gh failed: HTTP 403)",
                "  github    owner/other: present work, personal, AFK, HITL, grill-me, proposal, taken",
                `  linear    not evaluable — ${UNAUTHENTICATED}`,
            ].join("\n"),
        );
    });

    it("lists a label whose recolour failed under failed with its error", async () => {
        const github = fake("github", {
            labelScopes: ["owner/repo"],
            labels: {
                ok: true,
                value: everyWorkspaceLabelExcept("none").map((label) => ({
                    ...label,
                    scope: "owner/repo",
                    colour: label.name === "HITL" ? "#000000" : label.colour,
                })),
            },
            recolour: () => ({
                ok: false,
                error: "gh label edit HITL --repo owner/repo: gh failed: HTTP 403",
            }),
        });
        const report = await bootstrapLabels(
            trackers({ beads: beads(), github, linear: fake("linear") }),
            config({ beads: false, linear: false }),
            STARTED,
        );
        expect(renderBootstrapText(report)).toBe(
            [
                "label bootstrap — started 2026-09-26T10:00:00.000Z",
                "outcome: not-evaluable",
                "  github    owner/repo: present work, personal, AFK, grill-me, proposal, taken; failed HITL (gh label edit HITL --repo owner/repo: gh failed: HTTP 403)",
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
