// The walkthrough brought up to the final diff (spec walkthrough; design D14). Any failure is no
// walkthrough.

import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Exec } from "../exec.ts";
import type { Result } from "../result.ts";
import { checkGuide } from "../review-team/guide.ts";
import { readJson } from "../review-team/plan-file.ts";
import { toResult } from "../review-team/schema.ts";
import type { Location } from "../review-team/types.ts";
import { array, type Json, object, optional, string, stringArray } from "../validate.ts";
import { type DiffFile, hunkHolding } from "./anchor.ts";
import { digestOf } from "./receipt.ts";

export interface WalkthroughNote {
    finding: string;
    label: string; // the Conventional Comments label as published, e.g. "issue (blocking)"
    statement: string;
    status: string; // the status line, e.g. "fixed in abc1234"
    url: string; // the thread's url (its first comment's)
    location: Location;
}

export interface WalkthroughInput {
    attemptDir: string; // reads review/walkthrough.json; writes walkthrough.json, walkthrough.patch, walkthrough.md
    patch: string; // the final diff, `git diff --no-color --no-ext-diff --src-prefix=a/ --dst-prefix=b/ <merge-base> HEAD`
    files: readonly DiffFile[];
    notes: readonly WalkthroughNote[]; // every finding this run's read-back shows published, new or continued
    pullRequestUrl: string;
    lastDigest: string | null; // walkthroughDigest of the attempt's previous published.json, if any
}

export type PlannotatorAccess =
    | { available: true; exec: Exec }
    | { available: false; reason: string };

export type WalkthroughOutcome =
    | { outcome: "saved"; digest: string }
    | { outcome: "unchanged"; digest: string } // written; same digest as lastDigest, so not saved again
    | { outcome: "none"; reason: string }; // no walkthrough: no draft, no Plannotator, invalid, or any failure

const DRAFT = "review/walkthrough.json";
const GUIDE = "walkthrough.json";
const PATCH = "walkthrough.patch";
const RENDERING = "walkthrough.md";

const FIXES_TITLE = "Code review fixes";
const FIXES_OVERVIEW =
    "Files the code review's fixes changed that the walkthrough does not place elsewhere.";
const FIXES_SUMMARY = "Changed by a code review fix.";

// Plannotator's limits on a guide's notes: past them a finding goes to its section's overview.
const NOTES_PER_FILE = 20;
const NOTE_LENGTH = 1000;

type DiffRef = Json & { file: string };

interface Section {
    raw: Json;
    title: string;
    overview: string;
    diffs: DiffRef[];
}

interface Draft {
    raw: Json;
    title: string;
    intent: string;
    sections: Section[];
    unplaced: string[];
}

interface GuideNote {
    lineStart: number;
    lineEnd: number;
    side?: "old";
    text: string;
}

interface Walkthrough {
    guide: Json;
    rendering: string;
}

function readSection(input: unknown, path: string): Section {
    const raw = object(input, path);
    const diffs = array(raw.diffs, `${path}.diffs`).map((diff, at) => {
        const ref = object(diff, `${path}.diffs[${at}]`);
        return { ...ref, file: string(ref, "file", `${path}.diffs[${at}]`) };
    });
    return {
        raw,
        title: string(raw, "title", path),
        overview: string(raw, "overview", path),
        diffs,
    };
}

function readDraft(input: unknown): Draft {
    const raw = object(input, "$");
    return {
        raw,
        title: string(raw, "title", "$"),
        intent: string(raw, "intent", "$"),
        sections: array(raw.sections, "$.sections").map((section, index) =>
            readSection(section, `$.sections[${index}]`),
        ),
        unplaced: optional(raw, "unplacedFiles", "$", stringArray) ?? [],
    };
}

function loadDraft(attemptDir: string): Result<Draft> {
    const file = join(attemptDir, DRAFT);
    if (!existsSync(file)) {
        return { ok: false, error: `the review team wrote no walkthrough draft (${DRAFT})` };
    }
    const json = readJson(file);
    const draft = json.ok ? toResult(() => readDraft(json.value)) : json;
    return draft.ok ? draft : { ok: false, error: `${DRAFT} is not a guide: ${draft.error}` };
}

function withFixes(draft: Draft, files: readonly DiffFile[]): Section[] {
    const placed = new Set([
        ...draft.sections.flatMap((s) => s.diffs.map((diff) => diff.file)),
        ...draft.unplaced,
    ]);
    const added = files.map((file) => file.path).filter((path) => !placed.has(path));
    if (added.length === 0) {
        return draft.sections;
    }
    const diffs = added.map((file) => ({ file, summary: FIXES_SUMMARY }));
    const raw = { title: FIXES_TITLE, overview: FIXES_OVERVIEW, diffs };
    return [...draft.sections, { raw, title: FIXES_TITLE, overview: FIXES_OVERVIEW, diffs }];
}

const singleLine = (text: string) => text.replace(/\s+/gu, " ").trim();

function noteText(note: WalkthroughNote, at = ""): string {
    return `${note.label}${at}: ${singleLine(note.statement)} (${note.status}, ${note.url})`;
}

function where(location: Location): string {
    if (location.scope === "change") {
        return "";
    }
    const lines =
        location.scope === "file"
            ? ""
            : `:${location.startLine}${location.endLine === location.startLine ? "" : `-${location.endLine}`}`;
    return ` on \`${location.file}${lines}\``;
}

function overviewLine(note: WalkthroughNote): string {
    return `- ${noteText(note, where(note.location))}`;
}

// The path the final diff gives the finding's file, which a renamed file's old path resolves to.
function diffPath(location: Location, files: readonly DiffFile[]): string | null {
    if (location.scope === "change") {
        return null;
    }
    const file = files.find((f) => f.path === location.file || f.oldPath === location.file);
    return file?.path ?? location.file;
}

function guideNote(location: Extract<Location, { scope: "line" }>, text: string): GuideNote {
    const { startLine: lineStart, endLine: lineEnd } = location;
    return location.side === "old"
        ? { lineStart, lineEnd, side: "old", text }
        : { lineStart, lineEnd, text };
}

const notesOf = (diff: DiffRef): unknown[] => (Array.isArray(diff.notes) ? diff.notes : []);

// A note on the diff entry placing the finding's file, when one hunk holds its lines and the entry
// has room for it; null sends the finding to the overview.
function noteTarget(
    note: WalkthroughNote,
    diff: DiffRef | undefined,
    files: readonly DiffFile[],
): GuideNote | null {
    const { location } = note;
    if (diff === undefined || location.scope !== "line") {
        return null;
    }
    const { startLine, endLine, side } = location;
    const text = noteText(note);
    const held = hunkHolding(files, diff.file, startLine, endLine, side) !== null;
    const room = notesOf(diff).length < NOTES_PER_FILE && text.length <= NOTE_LENGTH;
    return held && room ? guideNote(location, text) : null;
}

interface Placing {
    lines: string[][];
    counts: number[];
}

function place(
    sections: Section[],
    note: WalkthroughNote,
    files: readonly DiffFile[],
    placing: Placing,
): void {
    const path = diffPath(note.location, files);
    const index = sections.findIndex((section) => section.diffs.some((diff) => diff.file === path));
    const at = Math.max(index, 0);
    const diff = sections[index]?.diffs.find((diff) => diff.file === path);
    const guideNoteOf = noteTarget(note, diff, files);
    if (diff !== undefined && guideNoteOf !== null) {
        diff.notes = [...notesOf(diff), guideNoteOf];
    } else {
        placing.lines[at]?.push(overviewLine(note));
    }
    placing.counts[at] = (placing.counts[at] ?? 0) + 1;
}

function withOverview(overview: string, lines: readonly string[]): string {
    return lines.length === 0 ? overview : `${overview}\n\n${lines.join("\n")}`;
}

function plural(count: number): string {
    return count === 1 ? "1 finding" : `${count} findings`;
}

// Plain paragraphs and a list: the logbook entry pastes it under its own heading.
function render(draft: Draft, sections: readonly Section[], counts: readonly number[]): string {
    const list = sections.map(
        (section, index) => `- ${singleLine(section.title)}: ${plural(counts[index] ?? 0)}`,
    );
    return `**${singleLine(draft.title)}**\n\n${draft.intent.trim()}\n\n${list.join("\n")}\n`;
}

function updated(draft: Draft, input: WalkthroughInput): Walkthrough {
    const sections = withFixes(draft, input.files);
    const placing: Placing = { lines: sections.map(() => []), counts: sections.map(() => 0) };
    for (const note of input.notes) {
        place(sections, note, input.files, placing);
    }
    const written = sections.map((section, index) => ({
        ...section.raw,
        overview: withOverview(section.overview, placing.lines[index] ?? []),
        diffs: section.diffs,
    }));
    return {
        guide: { ...draft.raw, sections: written },
        rendering: render(draft, sections, placing.counts),
    };
}

function paths(attemptDir: string): { guide: string; patch: string; rendering: string } {
    return {
        guide: join(attemptDir, GUIDE),
        patch: join(attemptDir, PATCH),
        rendering: join(attemptDir, RENDERING),
    };
}

async function removeFiles(attemptDir: string): Promise<void> {
    await Promise.all(Object.values(paths(attemptDir)).map((file) => rm(file, { force: true })));
}

async function written(
    input: WalkthroughInput,
    walkthrough: Walkthrough,
    plannotator: Exec,
): Promise<Result<string>> {
    const files = paths(input.attemptDir);
    const json = `${JSON.stringify(walkthrough.guide, null, 4)}\n`;
    await writeFile(files.guide, json);
    await writeFile(files.patch, input.patch);
    const changed = input.files.map((file) => file.path);
    const checked = await checkGuide(
        files,
        () => Promise.resolve({ ok: true, value: changed }),
        plannotator,
    );
    if (!checked.ok) {
        return checked;
    }
    await writeFile(files.rendering, walkthrough.rendering);
    // Both files the import reads, framed so no two pairs share a digest.
    return { ok: true, value: digestOf(JSON.stringify([json, input.patch])) };
}

async function saved(input: WalkthroughInput, plannotator: Exec): Promise<Result<void>> {
    const files = paths(input.attemptDir);
    const result = await plannotator([
        "guide",
        "import",
        "--guide",
        files.guide,
        "--patch",
        files.patch,
        "--pr",
        input.pullRequestUrl,
    ]);
    return result.ok
        ? { ok: true, value: undefined }
        : { ok: false, error: `plannotator guide import: ${result.error}` };
}

async function update(
    input: WalkthroughInput,
    plannotator: PlannotatorAccess,
): Promise<WalkthroughOutcome> {
    const draft = loadDraft(input.attemptDir);
    if (!draft.ok) {
        return { outcome: "none", reason: draft.error };
    }
    if (!plannotator.available) {
        return { outcome: "none", reason: `Plannotator is not available (${plannotator.reason})` };
    }
    const digest = await written(input, updated(draft.value, input), plannotator.exec);
    if (!digest.ok) {
        return { outcome: "none", reason: digest.error };
    }
    if (digest.value === input.lastDigest) {
        return { outcome: "unchanged", digest: digest.value };
    }
    const save = await saved(input, plannotator.exec);
    return save.ok
        ? { outcome: "saved", digest: digest.value }
        : { outcome: "none", reason: save.error };
}

// Never rejects: a failure leaves none of this run's walkthrough files behind and names its reason.
export async function updateWalkthrough(
    input: WalkthroughInput,
    plannotator: PlannotatorAccess,
): Promise<WalkthroughOutcome> {
    let outcome: WalkthroughOutcome;
    try {
        outcome = await update(input, plannotator);
    } catch (error) {
        outcome = {
            outcome: "none",
            reason: `updating the walkthrough: ${(error as Error).message}`,
        };
    }
    if (outcome.outcome === "none") {
        await removeFiles(input.attemptDir).catch(() => undefined);
    }
    return outcome;
}
