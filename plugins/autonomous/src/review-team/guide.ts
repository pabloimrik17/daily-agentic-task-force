// The walkthrough's guide, validated against the subject's patch (spec
// review-team, "The walkthrough draft"; design D9 as amended). Plannotator
// checks the guide's shape and that every file it names is in the patch, but it
// accepts a changed file placed nowhere, so placement is checked here first.
// Every failure is "no guide" with its reason; the walkthrough's items still count.

import { existsSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import type { Exec } from "../exec.ts";
import type { Result } from "../result.ts";
import { array, object, optional, stringArray, string } from "../validate.ts";
import { readJson } from "./plan-file.ts";
import { toResult } from "./schema.ts";
import type { Plan, Subject, WalkthroughGuide } from "./types.ts";

const GUIDE = "walkthrough.json";
const PATCH = "walkthrough.patch";
const HTML = "walkthrough.html";

interface GuideDeps {
    git: Exec;
    plannotator: Exec;
}

export interface GuideFiles {
    guide: string;
    patch: string;
    html?: string;
}

type ChangedFiles = () => Promise<Result<readonly string[]>>;

type Absence = (dir: string, plan: Plan) => string | undefined;

const ABSENCES: readonly Absence[] = [
    (_dir, plan) =>
        plan.team.some((row) => row.reviewer === "walkthrough")
            ? undefined
            : "the walkthrough is not in the team",
    (dir) => (existsSync(join(dir, GUIDE)) ? undefined : `the walkthrough wrote no ${GUIDE}`),
    (_dir, plan) =>
        plan.guide.available
            ? undefined
            : `Plannotator is not available (${plan.guide.reason ?? "not found"})`,
];

// The same prefixes whatever the user's git configuration, so Plannotator can read the patch.
async function writePatch(dir: string, subject: Subject, git: Exec): Promise<Result<void>> {
    const diff = await git([
        "diff",
        "--no-color",
        "--no-ext-diff",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        subject.mergeBase,
        subject.head,
    ]);
    if (!diff.ok) {
        return { ok: false, error: `writing ${PATCH}: ${diff.error}` };
    }
    try {
        writeFileSync(join(dir, PATCH), diff.stdout);
    } catch (error) {
        return { ok: false, error: `writing ${PATCH}: ${(error as Error).message}` };
    }
    return { ok: true, value: undefined };
}

async function changedFiles(subject: Subject, git: Exec): Promise<Result<string[]>> {
    const names = await git(["diff", "--name-only", "-z", subject.mergeBase, subject.head]);
    return names.ok
        ? { ok: true, value: names.stdout.split("\0").filter((name) => name !== "") }
        : { ok: false, error: `listing the changed files: ${names.error}` };
}

// Every file the guide places, once per place: the sections' diffs, then `unplacedFiles`.
function placements(input: unknown): string[] {
    const guide = object(input, "$");
    const sections = array(guide.sections, "$.sections").flatMap((section, index) => {
        const path = `$.sections[${index}]`;
        return array(object(section, path).diffs, `${path}.diffs`).map((diff, at) =>
            string(object(diff, `${path}.diffs[${at}]`), "file", `${path}.diffs[${at}]`),
        );
    });
    return [...sections, ...(optional(guide, "unplacedFiles", "$", stringArray) ?? [])];
}

function readPlacements(guide: string): Result<string[]> {
    const json = readJson(guide);
    return json.ok ? toResult(() => placements(json.value)) : json;
}

function placementProblems(placed: readonly string[], changed: readonly string[]): string[] {
    const twice = placed.filter((file, index) => placed.indexOf(file) !== index);
    const unchanged = placed.filter((file) => !changed.includes(file));
    const nowhere = changed.filter((file) => !placed.includes(file));
    return [
        ...[...new Set(twice)].map((file) => `${file} is placed twice`),
        ...unchanged.map((file) => `${file} is not in the patch`),
        ...nowhere.map((file) => `${file} is placed nowhere (neither in a section nor unplaced)`),
    ];
}

async function misplaced(guide: string, changed: ChangedFiles): Promise<string | undefined> {
    const name = basename(guide);
    const placed = readPlacements(guide);
    if (!placed.ok) {
        return `${name} is not a guide: ${placed.error}`;
    }
    const files = await changed();
    if (!files.ok) {
        return files.error;
    }
    const problems = placementProblems(placed.value, files.value);
    return problems.length === 0 ? undefined : `${name} is not valid: ${problems.join("; ")}`;
}

// Without a page to keep, Plannotator writes it to its output, which is dropped.
async function exported(files: GuideFiles, plannotator: Exec): Promise<Result<void>> {
    if (files.html !== undefined) {
        try {
            rmSync(files.html, { force: true });
        } catch (error) {
            return {
                ok: false,
                error: `removing ${basename(files.html)}: ${(error as Error).message}`,
            };
        }
    }
    const result = await plannotator([
        "guide",
        "export",
        "--guide",
        files.guide,
        "--patch",
        files.patch,
        "--out",
        files.html ?? "-",
    ]);
    return result.ok
        ? { ok: true, value: undefined }
        : { ok: false, error: `plannotator guide export: ${result.error}` };
}

// Publish mode checks its updated walkthrough with it (design D14).
export async function checkGuide(
    files: GuideFiles,
    changed: ChangedFiles,
    plannotator: Exec,
): Promise<Result<void>> {
    const invalid = await misplaced(files.guide, changed);
    return invalid === undefined ? exported(files, plannotator) : { ok: false, error: invalid };
}

export async function validateGuide(
    dir: string,
    plan: Plan,
    deps: GuideDeps,
): Promise<WalkthroughGuide> {
    const absent = ABSENCES.map((check) => check(dir, plan)).find((reason) => reason !== undefined);
    if (absent !== undefined) {
        return { guide: null, reason: absent };
    }
    const patch = await writePatch(dir, plan.subject, deps.git);
    if (!patch.ok) {
        return { guide: null, reason: patch.error };
    }
    const checked = await checkGuide(
        { guide: join(dir, GUIDE), patch: join(dir, PATCH), html: join(dir, HTML) },
        () => changedFiles(plan.subject, deps.git),
        deps.plannotator,
    );
    return checked.ok
        ? { guide: GUIDE, patch: PATCH, html: HTML }
        : { guide: null, patch: PATCH, reason: checked.error };
}
