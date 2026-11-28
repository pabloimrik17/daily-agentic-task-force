import { describe, expect, it } from "vitest";

import { selectStep } from "./step.ts";
import {
    fakeChezmoi,
    fakeReader,
    fakeSelection,
    selectContext,
    workTask,
} from "./test-fixtures.ts";
import type { SelectData, SelectionAnswer } from "./types.ts";

// Two candidates of either scope and one task excluded under each of three reasons.
function readers(calls: string[]) {
    return [
        fakeReader(
            "beads",
            [
                workTask("beads", "B-7", ["work", "grill-me"], { title: "Rotate the API keys" }),
                workTask("beads", "B-1", ["grill-me"], { title: "Untriaged idea" }),
            ],
            calls,
        ),
        fakeReader(
            "linear",
            [
                workTask("linear", "DOT-120", ["personal", "HITL", "grill-me"], {
                    title: "Select the next work unit",
                }),
                workTask("linear", "DOT-4", ["personal", "grill-me", "taken"], {
                    title: "Being worked on",
                }),
                workTask("linear", "DOT-5", ["personal", "AFK", "external-review"], {
                    title: "Build the feature",
                }),
            ],
            calls,
        ),
    ];
}

async function renderWith(answer: SelectionAnswer): Promise<string> {
    const calls: string[] = [];
    const selection = fakeSelection(() => ({ ok: true, answer }));
    const result = await selectStep.run(
        selectContext({ calls, readers: readers(calls), selection }),
    );
    return selectStep.render(result);
}

const OTHER_SECTIONS = [
    "  candidates: 2 tasks",
    "    beads → B-7 → Rotate the API keys (work, grill-me)",
    "    linear → DOT-120 → Select the next work unit (personal, grill-me)",
    "  excluded: 3 tasks",
    "    classification: 1",
    "      beads → B-1 → Untriaged idea",
    "    taken: 1",
    "      linear → DOT-4 → Being worked on",
    "    unsupported stage: 1",
    "      linear → DOT-5 → Build the feature",
    "  comparison: sonnet (high)",
];

describe("renderSelect", () => {
    it("names the selected unit's source, id, title, stage, autonomy, scope and explanation, then every section in order", async () => {
        const text = await renderWith({
            source: "linear",
            id: "DOT-120",
            explanation: "It unblocks two tasks.",
            exception: null,
        });
        expect(text).toBe(
            [
                "[select] advance (llm)",
                "  machine scope  personal",
                "  selected  linear → DOT-120 → Select the next work unit",
                "    stage        grill-me",
                "    autonomy     HITL",
                "    scope        personal",
                "    explanation  It unblocks two tasks.",
                ...OTHER_SECTIONS,
                "  reasons:",
                "    - selected linear → DOT-120 for grill-me, from 2 candidates",
            ].join("\n"),
        );
    });

    it("has no not-evaluated line with GitHub enabled, and lists its task as a candidate", async () => {
        const calls: string[] = [];
        const result = await selectStep.run(
            selectContext({
                calls,
                readers: [fakeReader("github", [workTask("github", "owner/repo#1")], calls)],
            }),
        );
        const lines = selectStep.render(result).split("\n");
        expect(lines.join("\n")).not.toContain("not evaluated:");
        expect(lines).toContain(
            "    github → owner/repo#1 → Task owner/repo#1 (personal, grill-me)",
        );
        expect(lines.join("\n")).not.toMatch(/blocked|children/);
    });

    it("gives the autonomy of a selected grill task without one as none", async () => {
        const calls: string[] = [];
        const result = await selectStep.run(
            selectContext({
                calls,
                readers: [
                    fakeReader(
                        "linear",
                        [workTask("linear", "DOT-1", ["personal", "grill-me"])],
                        calls,
                    ),
                ],
            }),
        );
        expect(selectStep.render(result)).toBe(
            [
                "[select] advance (code)",
                "  machine scope  personal",
                "  selected  linear → DOT-1 → Task DOT-1",
                "    stage        grill-me",
                "    autonomy     none",
                "    scope        personal",
                "    explanation  It was the only candidate.",
                "  candidates: 1 task",
                "    linear → DOT-1 → Task DOT-1 (personal, grill-me)",
                "  reasons:",
                "    - selected linear → DOT-1 for grill-me, from 1 candidate",
            ].join("\n"),
        );
    });

    it("marks a choice outside the machine scope with its exception reason", async () => {
        const text = await renderWith({
            source: "beads",
            id: "B-7",
            explanation: "The keys expire today.",
            exception: "A work deadline today.",
        });
        expect(text).toBe(
            [
                "[select] advance (llm)",
                "  machine scope  personal",
                "  selected  beads → B-7 → Rotate the API keys",
                "    stage        grill-me",
                "    autonomy     none",
                "    scope        work",
                "    explanation  The keys expire today.",
                "    exception    outside the machine scope: A work deadline today.",
                ...OTHER_SECTIONS,
                "  reasons:",
                "    - selected beads → B-7 for grill-me, from 2 candidates",
            ].join("\n"),
        );
    });

    it("groups the exclusions by reason with a count when nothing is selectable", async () => {
        const calls: string[] = [];
        const result = await selectStep.run(
            selectContext({
                calls,
                readers: [
                    fakeReader(
                        "beads",
                        ["B-1", "B-2", "B-3"].map((id) =>
                            workTask("beads", id, ["personal", "AFK", "external-review"]),
                        ),
                        calls,
                    ),
                    fakeReader(
                        "linear",
                        [workTask("linear", "DOT-4", ["personal", "grill-me", "taken"])],
                        calls,
                    ),
                ],
            }),
        );
        expect(selectStep.render(result)).toBe(
            [
                "[select] wait (code)",
                "  machine scope  personal",
                "  excluded: 4 tasks",
                "    taken: 1",
                "      linear → DOT-4 → Task DOT-4",
                "    unsupported stage: 3",
                "      beads → B-1 → Task B-1",
                "      beads → B-2 → Task B-2",
                "      beads → B-3 → Task B-3",
                "  reasons:",
                "    - 1 taken",
                "    - 3 unsupported stage",
            ].join("\n"),
        );
    });

    it("lists a split parent whose subtasks are all closed as ready to close, under its own heading", async () => {
        const calls: string[] = [];
        const result = await selectStep.run(
            selectContext({
                calls,
                readers: [
                    fakeReader(
                        "linear",
                        [
                            workTask("linear", "DOT-8", ["personal", "AFK", "proposal"], {
                                title: "Parent of finished work",
                            }),
                            workTask("linear", "DOT-9", ["personal", "AFK", "proposal"], {
                                title: "Parent with work left",
                            }),
                        ],
                        calls,
                        {
                            details: {
                                "DOT-8": { children: [], childCount: 2 },
                                "DOT-9": { children: ["DOT-10"], childCount: 2 },
                            },
                        },
                    ),
                ],
            }),
        );
        expect(selectStep.render(result)).toBe(
            [
                "[select] wait (code)",
                "  machine scope  personal",
                "  excluded: 2 tasks",
                "    split: 2",
                "      linear → DOT-8 → Parent of finished work",
                "      linear → DOT-9 → Parent with work left",
                "  ready to close: 1 task",
                "    linear → DOT-8 → Parent of finished work",
                "  reasons:",
                "    - 2 split",
            ].join("\n"),
        );
    });

    it("shows only the header and the reason when the machine scope cannot be read", async () => {
        const calls: string[] = [];
        const result = await selectStep.run(
            selectContext({
                calls,
                chezmoi: fakeChezmoi("chezmoi CLI not found on PATH", calls),
                readers: readers(calls),
            }),
        );
        expect(selectStep.render(result)).toBe(
            [
                "[select] not-evaluable (code)",
                "  reasons:",
                "    - chezmoi data: chezmoi CLI not found on PATH",
            ].join("\n"),
        );
    });
});

describe("renderSelect: candidates set aside", () => {
    const data: SelectData = {
        machineScope: "personal",
        selected: null,
        candidates: [
            {
                source: "linear",
                id: "P-1",
                title: "Write it",
                scope: "personal",
                stage: "proposal",
            },
        ],
        setAside: [
            { source: "beads", id: "G-1", title: "Think it", scope: "personal", stage: "grill-me" },
        ],
        excluded: [{ source: "linear", id: "T-1", title: "Busy", reason: "taken" }],
        readyToClose: [],
        comparison: null,
    };

    it("lists a set-aside candidate with its stage, apart from the excluded tasks", () => {
        const lines = selectStep
            .render({ step: "select", tier: "code", outcome: "advance", reasons: [], data })
            .split("\n");

        const heading = lines.findIndex((line) => line.includes("set aside"));
        expect(lines.slice(heading, heading + 2)).toEqual([
            "  set aside for a candidate at a more advanced stage: 1 task",
            "    beads → G-1 → Think it (personal, grill-me)",
        ]);
        expect(heading).toBeGreaterThan(lines.indexOf("  candidates: 1 task"));
        expect(heading).toBeLessThan(lines.indexOf("  excluded: 1 task"));
        expect(lines.slice(lines.indexOf("  excluded: 1 task"))).not.toContain(
            "      beads → G-1 → Think it",
        );
    });

    it("leaves the heading out when nothing is set aside", () => {
        const text = selectStep.render({
            step: "select",
            tier: "code",
            outcome: "advance",
            reasons: [],
            data: { ...data, setAside: [] },
        });

        expect(text).not.toContain("set aside");
    });

    it("names the triage-me exclusion after taken", () => {
        const text = selectStep.render({
            step: "select",
            tier: "code",
            outcome: "advance",
            reasons: [],
            data: {
                ...data,
                excluded: [
                    { source: "linear", id: "M-1", title: "Doubtful", reason: "triage-me" },
                    { source: "linear", id: "T-1", title: "Busy", reason: "taken" },
                    { source: "linear", id: "L-1", title: "Done now", reason: "labelled-this-run" },
                ],
            },
        });

        expect(text).toContain("    triage-me: 1\n      linear → M-1 → Doubtful");
        expect(text.indexOf("triage-me: 1")).toBeGreaterThan(text.indexOf("taken: 1"));
        expect(text.indexOf("triage-me: 1")).toBeLessThan(text.indexOf("labelled this run: 1"));
    });

    it("names the no-free-slot exclusion last", () => {
        const text = selectStep.render({
            step: "select",
            tier: "code",
            outcome: "wait",
            reasons: [],
            data: {
                ...data,
                excluded: [
                    { source: "linear", id: "N-1", title: "Full", reason: "no-free-slot" },
                    { source: "linear", id: "T-1", title: "Busy", reason: "taken" },
                ],
            },
        });

        expect(text.indexOf("no free slot: 1")).toBeGreaterThan(text.indexOf("taken: 1"));
    });
});
