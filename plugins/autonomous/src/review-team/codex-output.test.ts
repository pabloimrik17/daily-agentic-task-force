import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseCodexOutput } from "./codex-output.ts";

const SCHEMA: unknown = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), "codex-output.schema.json"), "utf8"),
);

type Obj = Record<string, unknown>;

// The subset of JSON Schema the shipped file uses (and that OpenAI's
// structured outputs allow here): type, a list of types, enum, properties,
// required, additionalProperties false and items. Anything else throws, so a
// keyword added to the file without support here fails loudly.
const SUPPORTED = ["type", "enum", "properties", "required", "additionalProperties", "items"];

function typeOf(value: unknown): string {
    if (value === null) {
        return "null";
    }
    if (Array.isArray(value)) {
        return "array";
    }
    return Number.isInteger(value) ? "integer" : typeof value;
}

function typeMatches(schema: Obj, value: unknown): boolean {
    const allowed = [schema.type].flat() as string[];
    const actual = typeOf(value);
    return allowed.includes(actual) || (actual === "integer" && allowed.includes("number"));
}

function objectMatches(schema: Obj, value: Obj): boolean {
    const properties = (schema.properties ?? {}) as Record<string, Obj>;
    const required = (schema.required ?? []) as string[];
    if (!required.every((key) => key in value)) {
        return false;
    }
    if (
        schema.additionalProperties === false &&
        Object.keys(value).some((key) => !(key in properties))
    ) {
        return false;
    }
    return Object.entries(properties).every(
        ([key, child]) => !(key in value) || validates(child, value[key]),
    );
}

function validates(schema: Obj, value: unknown): boolean {
    const unsupported = Object.keys(schema).filter((key) => !SUPPORTED.includes(key));
    if (unsupported.length > 0) {
        throw new Error(`the checker does not support ${unsupported.join(", ")}`);
    }
    if (!typeMatches(schema, value)) {
        return false;
    }
    if ((schema.enum as unknown[] | undefined) && !(schema.enum as unknown[]).includes(value)) {
        return false;
    }
    if (Array.isArray(value)) {
        return value.every((entry) => validates(schema.items as Obj, entry));
    }
    return typeof value === "object" && value !== null ? objectMatches(schema, value as Obj) : true;
}

const finding = (extra: Obj = {}): Obj => ({
    title: "Missing await on save",
    statement: "The save is not awaited.",
    file: "src/a.ts",
    startLine: 10,
    endLine: 12,
    evidence: "no await on line 10",
    priority: "P1",
    label: "issue",
    suggestedFix: null,
    ...extra,
});

const doubt = (extra: Obj = {}): Obj => ({
    title: "Was the flag removal intended?",
    statement: "The flag is deleted with no replacement.",
    file: "src/flags.ts",
    startLine: 7,
    endLine: 7,
    ...extra,
});

const output = (findings: Obj[] = [], doubts: Obj[] = []): Obj => ({ findings, doubts });

const without = (value: Obj, key: string): Obj => {
    const { [key]: _removed, ...rest } = value;
    return rest;
};

const VALID: Array<[string, unknown]> = [
    ["nothing found", output()],
    ["a line finding", output([finding()])],
    [
        "a file finding with a fix",
        output([finding({ startLine: null, endLine: null, suggestedFix: "Add await." })]),
    ],
    [
        "a change finding",
        output([
            finding({
                file: null,
                startLine: null,
                endLine: null,
                priority: "P3",
                label: "suggestion",
            }),
        ]),
    ],
    [
        "a doubt at a line and a doubt on the change",
        output([], [doubt(), doubt({ file: null, startLine: null, endLine: null })]),
    ],
    ["findings and doubts together", output([finding(), finding({ priority: "P0" })], [doubt()])],
];

const INVALID: Array<[string, unknown]> = [
    ["a top-level array", []],
    ["a missing doubts key", { findings: [] }],
    ["an extra top-level key", { ...output(), summary: "x" }],
    ["a finding missing its priority", output([without(finding(), "priority")])],
    ["a finding missing suggestedFix", output([without(finding(), "suggestedFix")])],
    ["a priority outside P0 to P3", output([finding({ priority: "P4" })])],
    ["a label of question on a finding", output([finding({ label: "question" })])],
    ["a string start line", output([finding({ startLine: "10" })])],
    ["a fractional end line", output([finding({ endLine: 12.5 })])],
    ["an extra key on a finding", output([finding({ confidence: 0.8 })])],
    ["a doubt with a priority", output([], [doubt({ priority: "P2" })])],
    ["a doubt missing its file", output([], [without(doubt(), "file")])],
    ["a null title", output([finding({ title: null })])],
];

describe("codex-output.schema.json", () => {
    it("is strict, as OpenAI structured outputs require", () => {
        const strict = (schema: Obj): void => {
            if (schema.type === "object") {
                expect(schema.additionalProperties).toBe(false);
                expect([...(schema.required as string[])].sort()).toEqual(
                    Object.keys(schema.properties as Obj).sort(),
                );
                for (const child of Object.values(schema.properties as Record<string, Obj>)) {
                    strict(child);
                }
            }
            if (schema.type === "array") {
                strict(schema.items as Obj);
            }
        };
        strict(SCHEMA as Obj);
    });
});

describe("the JSON Schema and parseCodexOutput agree", () => {
    it.each(VALID)("both accept %s", (_name, fixture) => {
        expect(validates(SCHEMA as Obj, fixture)).toBe(true);
        expect(parseCodexOutput(fixture).ok).toBe(true);
    });

    it.each(INVALID)("both reject %s", (_name, fixture) => {
        expect(validates(SCHEMA as Obj, fixture)).toBe(false);
        expect(parseCodexOutput(fixture).ok).toBe(false);
    });

    it("has at least four valid and six invalid fixtures", () => {
        expect(VALID.length).toBeGreaterThanOrEqual(4);
        expect(INVALID.length).toBeGreaterThanOrEqual(6);
    });
});

describe("parseCodexOutput, mapping", () => {
    it("maps a line finding onto a raw finding, with the priority as native severity", () => {
        expect(parseCodexOutput(output([finding({ suggestedFix: "Add await." })]))).toEqual({
            ok: true,
            value: [
                {
                    kind: "finding",
                    title: "Missing await on save",
                    statement: "The save is not awaited.",
                    location: {
                        scope: "line",
                        file: "src/a.ts",
                        startLine: 10,
                        endLine: 12,
                        side: "new",
                    },
                    evidence: "no await on line 10",
                    label: "issue",
                    nativeSeverity: "P1",
                    suggestedFix: "Add await.",
                },
            ],
        });
    });

    it("leaves out a null suggested fix", () => {
        const result = parseCodexOutput(output([finding()]));
        expect(result.ok && result.value[0]).not.toHaveProperty("suggestedFix");
    });

    it("maps a null file to the change and a file without lines to the file", () => {
        const result = parseCodexOutput(
            output([
                finding({ file: null, startLine: null, endLine: null }),
                finding({ startLine: null, endLine: null }),
            ]),
        );
        expect(result.ok && result.value.map((item) => item.location)).toEqual([
            { scope: "change" },
            { scope: "file", file: "src/a.ts" },
        ]);
    });

    it("maps a doubt with the question label and no severity", () => {
        const result = parseCodexOutput(output([], [doubt()]));
        expect(result).toEqual({
            ok: true,
            value: [
                {
                    kind: "doubt",
                    title: "Was the flag removal intended?",
                    statement: "The flag is deleted with no replacement.",
                    location: {
                        scope: "line",
                        file: "src/flags.ts",
                        startLine: 7,
                        endLine: 7,
                        side: "new",
                    },
                    label: "question",
                },
            ],
        });
    });

    it("lists findings before doubts", () => {
        const result = parseCodexOutput(output([finding()], [doubt()]));
        expect(result.ok && result.value.map((item) => item.kind)).toEqual(["finding", "doubt"]);
    });
});

describe("parseCodexOutput, what a JSON Schema cannot say", () => {
    it.each([
        ["an empty title", finding({ title: "" }), "$.findings[0].title must not be empty"],
        [
            "lines without a file",
            finding({ file: null }),
            "$.findings[0].file must be set when startLine or endLine is",
        ],
        [
            "one line alone",
            finding({ endLine: null }),
            "$.findings[0].startLine and $.findings[0].endLine must both be set or both null",
        ],
        [
            "an end before the start",
            finding({ endLine: 9 }),
            "$.findings[0].endLine must be >= startLine",
        ],
        [
            "a start line of 0",
            finding({ startLine: 0 }),
            "$.findings[0].startLine must be an integer >= 1",
        ],
        [
            "an absolute file",
            finding({ file: "/etc/passwd" }),
            "$.findings[0].file must be relative",
        ],
        ["a file with ..", finding({ file: "../x.ts" }), "$.findings[0].file must be relative"],
        [
            "an empty suggested fix",
            finding({ suggestedFix: "" }),
            "$.findings[0].suggestedFix must not be empty",
        ],
    ])("rejects %s, naming the path", (_name, item, message) => {
        const result = parseCodexOutput(output([item]));
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error).toContain(message);
    });

    it("names a doubt's path", () => {
        const result = parseCodexOutput(output([], [doubt({ title: "a\nb" }), doubt({ file: 3 })]));
        expect(!result.ok && result.error).toBe("$.doubts[0].title must be a single line");
        const second = parseCodexOutput(output([], [doubt(), doubt({ file: 3 })]));
        expect(!second.ok && second.error).toBe("$.doubts[1].file must be a string");
    });
});
