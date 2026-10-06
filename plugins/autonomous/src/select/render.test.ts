import { describe, expect, it } from "vitest";

import { selectStep } from "./step.ts";
import {
    fakeChezmoi,
    fakeReader,
    fakeSelection,
    selectContext,
    workTask,
} from "./test-fixtures.ts";
import type { SelectionAnswer } from "./types.ts";

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
                workTask("linear", "DOT-5", ["personal", "AFK"], { title: "Write the proposal" }),
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
    "      linear → DOT-5 → Write the proposal",
    "  not evaluated: github: dependencies and children",
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
                "    autonomy     grill-me",
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
                            workTask("beads", id, ["personal", "AFK"]),
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
                "  not evaluated: github: dependencies and children",
                "  reasons:",
                "    - 1 taken",
                "    - 3 unsupported stage",
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
