import { describe, expect, it } from "vitest";

import { parseFindingsRecord } from "./record.ts";
import { ATTEMPT, doubt, finding, findingsRecord, recordText, ROUND_ONE } from "./test-fixtures.ts";

const FILE = "/state/attempts/x/findings.json";

function errorOf(text: string): string {
    const parsed = parseFindingsRecord(text, FILE);
    if (parsed.ok) {
        throw new Error("expected the record to be refused");
    }
    return parsed.error;
}

function without(entry: object, key: string): object {
    return Object.fromEntries(Object.entries(entry).filter(([name]) => name !== key));
}

describe("The record of the findings", () => {
    it("Record of a round: five findings and one doubt, each with its round, reporters and destination", () => {
        const parsed = parseFindingsRecord(recordText(), FILE);
        expect(parsed).toEqual({ ok: true, value: findingsRecord() });
        if (!parsed.ok) {
            return;
        }
        expect(parsed.value.attempt).toBe(ATTEMPT);
        expect(parsed.value.entries).toHaveLength(6);
        expect(parsed.value.entries.filter(({ kind }) => kind === "doubt")).toHaveLength(1);
        for (const entry of parsed.value.entries) {
            expect(entry.round).toBe(1);
            expect(entry.reporters.length).toBeGreaterThan(0);
            expect(entry.destination).toBeTruthy();
        }
    });

    it("keeps a human round's entry linked to its thread", () => {
        const human = finding({
            id: "h1",
            round: 2,
            reporters: [{ reviewer: "human", ids: [] }],
            thread: "PRRT_kwDO123",
        });
        const parsed = parseFindingsRecord(recordText([human]), FILE);
        expect(parsed.ok && parsed.value.entries[0]).toEqual(human);
    });
});

describe("The record may mark a quiet round", () => {
    const EXTERNAL = "linear:DOT-121:external-review:2";
    const refuted = finding({
        refutation: { outcome: "refuted", reproduction: null },
        publication: { state: "none" },
    });

    it("reads quiet: true on an external review record whose refuted findings send nothing to fix", () => {
        const parsed = parseFindingsRecord(
            recordText([refuted], { attempt: EXTERNAL, quiet: true }),
            FILE,
        );
        expect(parsed.ok && parsed.value.quiet).toBe(true);
    });

    it("reads a record without the field as before, with no quiet key", () => {
        const parsed = parseFindingsRecord(recordText([], { attempt: EXTERNAL }), FILE);
        expect(parsed.ok && "quiet" in parsed.value).toBe(false);
    });

    it("refuses the mark on a code review record, naming the field", () => {
        expect(errorOf(recordText([], { quiet: true }))).toContain(
            "$.quiet marks an external review's quiet round",
        );
    });

    it("refuses the mark on an external review record that sends an entry to fix", () => {
        const error = errorOf(
            recordText([finding({ id: "f7" })], { attempt: EXTERNAL, quiet: true }),
        );
        expect(error).toContain("$.entries[f7] is sent to fix");
    });

    it("refuses a mark other than true", () => {
        expect(errorOf(recordText([], { attempt: EXTERNAL, quiet: false }))).toContain(
            "$.quiet must be true",
        );
    });
});

describe("Reporters of an external review", () => {
    const greptile = finding({ reporters: [{ reviewer: "greptile", ids: [] }] });

    it("accepts the reporters the caller adds, such as a review bot's id", () => {
        const parsed = parseFindingsRecord(recordText([greptile]), FILE, {
            reporters: ["ci", "greptile"],
        });
        expect(parsed.ok && parsed.value.entries[0]?.reporters).toEqual([
            { reviewer: "greptile", ids: [] },
        ]);
    });

    it("refuses a reporter no one adds", () => {
        expect(errorOf(recordText([greptile]))).toContain("$.entries[f1].reporters[0].reviewer");
    });
});

describe("An invalid record publishes nothing", () => {
    it("Missing destination: names the file, the entry and the field", () => {
        const error = errorOf(recordText([without(finding({ id: "f7" }), "destination")]));
        expect(error).toContain(FILE);
        expect(error).toContain("$.entries[f7].destination");
    });

    it("refuses a location outside the repository, absolute or with ..", () => {
        const error = errorOf(
            recordText([
                finding({ id: "f1", location: { scope: "file", file: "../secrets.ts" } }),
                finding({ id: "f2", location: { scope: "file", file: "/etc/passwd" } }),
            ]),
        );
        expect(error).toContain("$.entries[f1].location.file");
        expect(error).toContain("$.entries[f2].location.file");
    });

    it("reports several faults together, not just the first", () => {
        const error = errorOf(
            recordText([
                without(finding({ id: "f1" }), "destination"),
                { ...finding({ id: "f2" }), severity: "HIGH", title: "" },
                doubt({ id: "d1", location: { scope: "file", file: "../x.ts" } }),
            ]),
        );
        expect(error).toContain("$.entries[f1].destination");
        expect(error).toContain("$.entries[f2].severity");
        expect(error).toContain("$.entries[f2].title");
        expect(error).toContain("$.entries[d1].location.file");
    });

    it("refuses an id used twice", () => {
        const error = errorOf(recordText([finding({ id: "f1" }), doubt({ id: "f1" })]));
        expect(error).toContain('the id "f1" more than once');
    });

    it("refuses a doubt with a severity, a label or a refutation", () => {
        const error = errorOf(
            recordText([
                {
                    ...doubt({ id: "d2" }),
                    severity: "WARNING",
                    label: "issue",
                    refutation: { outcome: "survived", reproduction: null },
                },
            ]),
        );
        expect(error).toContain("$.entries[d2].severity: a doubt carries no severity");
        expect(error).toContain("$.entries[d2].label: a doubt carries no label");
        expect(error).toContain("$.entries[d2].refutation: a doubt carries no refutation");
    });

    it("refuses a finding without its severity, label or refutation", () => {
        const bare = without(
            without(without(finding({ id: "f9" }), "severity"), "label"),
            "refutation",
        );
        const error = errorOf(recordText([bare]));
        expect(error).toContain("$.entries[f9].severity");
        expect(error).toContain("$.entries[f9].label");
        expect(error).toContain("$.entries[f9].refutation");
    });

    it("refuses a publication that does not fit the destination and the refutation", () => {
        const error = errorOf(
            recordText([
                finding({ id: "f1", destination: "pass-on" }),
                finding({ id: "f2", publication: { state: "passed-on", stage: "qa" } }),
            ]),
        );
        expect(error).toContain('$.entries[f1].refutation.outcome "survived" does not fit');
        expect(error).toContain('$.entries[f2].publication.state "passed-on" does not fit');
    });

    it("refuses a follow-up that is not a URL and an unknown field", () => {
        const error = errorOf(
            recordText([
                {
                    ...finding({
                        id: "f1",
                        destination: "defer",
                        publication: { state: "deferred", followUp: "DOT-170" },
                    }),
                    extra: true,
                },
            ]),
        );
        expect(error).toContain("$.entries[f1].publication.followUp must be a URL");
        expect(error).toContain("$.entries[f1].extra is not a recognised field");
    });

    it.each(["https://[", "https://"])("refuses the malformed follow-up URL %s", (followUp) => {
        const deferred = finding({
            destination: "defer",
            publication: { state: "deferred", followUp },
        });
        expect(errorOf(recordText([deferred]))).toContain(
            "$.entries[f1].publication.followUp must be a URL",
        );
    });

    it("names an entry without a usable id by its index", () => {
        const error = errorOf(recordText([ROUND_ONE[0], { ...finding(), id: "f 1" }]));
        expect(error).toContain("$.entries[1].id");
    });

    it("refuses a wrong schema, attempt and review", () => {
        const text = JSON.stringify({
            ...findingsRecord(),
            schema: "autonomous.findings.v2",
            attempt: "DOT-121",
            review: { tier: "XL", skipped: false },
        });
        const error = errorOf(text);
        expect(error).toContain("$.schema");
        expect(error).toContain("$.attempt must be an attempt id");
        expect(error).toContain("$.review.tier");
        expect(error).toContain("$.review.skipped");
    });

    it("names the file when it is not JSON", () => {
        expect(errorOf("{ not json")).toContain(`${FILE} is not valid JSON`);
    });
});
