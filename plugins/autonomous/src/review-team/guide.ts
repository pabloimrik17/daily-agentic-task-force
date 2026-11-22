// The walkthrough's guide, validated against the subject's patch (spec
// review-team, "The walkthrough draft"; design D9 as amended). Plannotator
// checks the guide's shape and that every file it names is in the patch, but it
// accepts a changed file placed nowhere, so placement is checked here first.
// Every failure is "no guide" with its reason; the walkthrough's items still count.

import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
    writeFileSync(join(dir, PATCH), diff.stdout);
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

function readPlacements(dir: string): Result<string[]> {
    const json = readJson(join(dir, GUIDE));
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

async function misplaced(dir: string, subject: Subject, git: Exec): Promise<string | undefined> {
    const placed = readPlacements(dir);
    if (!placed.ok) {
        return `${GUIDE} is not a guide: ${placed.error}`;
    }
    const changed = await changedFiles(subject, git);
    if (!changed.ok) {
        return changed.error;
    }
    const problems = placementProblems(placed.value, changed.value);
    return problems.length === 0 ? undefined : `${GUIDE} is not valid: ${problems.join("; ")}`;
}

async function exported(dir: string, plannotator: Exec): Promise<WalkthroughGuide> {
    const out = join(dir, HTML);
    rmSync(out, { force: true });
    const result = await plannotator([
        "guide",
        "export",
        "--guide",
        join(dir, GUIDE),
        "--patch",
        join(dir, PATCH),
        "--out",
        out,
    ]);
    return result.ok
        ? { guide: GUIDE, patch: PATCH, html: HTML }
        : { guide: null, patch: PATCH, reason: `plannotator guide export: ${result.error}` };
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
    const invalid = await misplaced(dir, plan.subject, deps.git);
    return invalid === undefined
        ? exported(dir, deps.plannotator)
        : { guide: null, patch: PATCH, reason: invalid };
}
