// The review team's command line (spec review-team, "The review team skill" and "The review
// configuration"; design D1 and D6): `plan` writes the report directory, `run <id>` runs one CLI
// reviewer, `collect` writes the report. Exit 0 when done, 1 on an error, 2 on a refused request.

import { existsSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CLI_TIMEOUT_MS, type Exec, execCommand } from "../exec.ts";
import type { Result } from "../result.ts";
import { loadSkills } from "../stages/skills.ts";
import { collect, type CollectDeps } from "./collect.ts";
import { loadReviewConfig } from "./config.ts";
import { buildPlan, type PlanRequest } from "./plan.ts";
import { readPlan } from "./plan-file.ts";
import { RUNNERS } from "./runners.ts";
import type { Runner } from "./runners/shared.ts";
import {
    type Plan,
    type PlannedReviewer,
    type Report,
    type ReviewerFile,
    REVIEWER_IDS,
    type ReviewerId,
    type Tier,
    TIERS,
} from "./types.ts";

export const USAGE = `Usage:
  cli.ts plan [--base <ref>] [--tier <S|M|L> --reason <text>] [--dir <dir>]
  cli.ts run <reviewer> --dir <dir>
  cli.ts collect --dir <dir>`;

type Command =
    | { name: "plan"; request: PlanRequest }
    | { name: "run"; reviewer: string; dir: string }
    | { name: "collect"; dir: string };

interface ExecOptions {
    cwd: string;
    keepOutputOnExit?: boolean;
}

export interface CliDeps {
    exec: (command: string, timeoutMs: number, options: ExecOptions) => Exec;
    env: Record<string, string | undefined>;
    readConfig?: (path: string) => string;
    cwd: string;
    home: string;
    tmpdir: string;
    now: () => Date;
    exists: (path: string) => boolean;
    fallowPlugin: () => Promise<boolean>;
    briefsDir: string;
    collect: (dir: string, deps: CollectDeps) => Promise<Result<Report>>;
    runners: Readonly<Partial<Record<ReviewerId, Runner>>>;
    stdout: (text: string) => void;
    stderr: (text: string) => void;
}

type Flags = Map<string, string>;

const FLAGS = {
    plan: ["--base", "--tier", "--reason", "--dir"],
    run: ["--dir"],
    collect: ["--dir"],
} as const;

type Name = keyof typeof FLAGS;

function isName(value: string | undefined): value is Name {
    return value !== undefined && Object.hasOwn(FLAGS, value);
}

function flagError(
    flag: string,
    value: string | undefined,
    allowed: readonly string[],
    flags: Flags,
): string | undefined {
    if (!allowed.includes(flag)) {
        return `unknown flag: ${flag}`;
    }
    if (value === undefined || value.startsWith("--")) {
        return `missing value for ${flag}`;
    }
    return flags.has(flag) ? `${flag} given twice` : undefined;
}

function readFlags(args: readonly string[], allowed: readonly string[]): Result<Flags> {
    const flags: Flags = new Map();
    for (let index = 0; index < args.length; index += 2) {
        const [flag, value] = [args[index]!, args[index + 1]];
        const error = flagError(flag, value, allowed, flags);
        if (error !== undefined) {
            return { ok: false, error };
        }
        flags.set(flag, value!);
    }
    return { ok: true, value: flags };
}

function isTier(value: string): value is Tier {
    return (TIERS as readonly string[]).includes(value);
}

function planCommand(flags: Flags): Result<Command> {
    const tier = flags.get("--tier");
    if (tier !== undefined && !isTier(tier)) {
        return { ok: false, error: `invalid --tier: ${tier}` };
    }
    if (tier === undefined && flags.has("--reason")) {
        return { ok: false, error: "--reason is only accepted with --tier" };
    }
    const request: PlanRequest = {
        base: flags.get("--base"),
        tier,
        reason: flags.get("--reason"),
        dir: flags.get("--dir"),
    };
    return { ok: true, value: { name: "plan", request } };
}

function withDir(flags: Flags, command: (dir: string) => Command): Result<Command> {
    const dir = flags.get("--dir");
    return dir === undefined
        ? { ok: false, error: "--dir is required" }
        : { ok: true, value: command(dir) };
}

function withFlags(
    args: readonly string[],
    name: Name,
    build: (flags: Flags) => Result<Command>,
): Result<Command> {
    const flags = readFlags(args, FLAGS[name]);
    return flags.ok ? build(flags.value) : flags;
}

const PARSERS: Record<Name, (args: readonly string[]) => Result<Command>> = {
    plan: (args) => withFlags(args, "plan", planCommand),
    run: ([reviewer, ...args]) =>
        reviewer === undefined || reviewer.startsWith("--")
            ? { ok: false, error: "run needs a reviewer" }
            : withFlags(args, "run", (flags) =>
                  withDir(flags, (dir) => ({ name: "run", reviewer, dir })),
              ),
    collect: (args) =>
        withFlags(args, "collect", (flags) => withDir(flags, (dir) => ({ name: "collect", dir }))),
};

function parse(argv: readonly string[]): Result<Command> {
    const [name, ...rest] = argv;
    return isName(name)
        ? PARSERS[name](rest)
        : { ok: false, error: `expected plan, run or collect, got ${name ?? "nothing"}` };
}

// The repository the working directory is in; every tool runs at its root.
async function repositoryRoot(deps: CliDeps): Promise<Result<string>> {
    const git = deps.exec("git", CLI_TIMEOUT_MS, { cwd: deps.cwd });
    const result = await git(["rev-parse", "--show-toplevel"]);
    return result.ok
        ? { ok: true, value: result.stdout.trim() }
        : { ok: false, error: `finding the repository: ${result.error}` };
}

function fail(deps: CliDeps, error: string): number {
    deps.stderr(error);
    return 1;
}

async function plan(request: PlanRequest, deps: CliDeps): Promise<number> {
    // The configuration is read first, so an invalid file stops the review before anything runs.
    const config = loadReviewConfig(deps.env, deps.readConfig);
    if (!config.ok) {
        return fail(deps, config.error);
    }
    const root = await repositoryRoot(deps);
    if (!root.ok) {
        return fail(deps, root.error);
    }
    const dir = request.dir === undefined ? undefined : resolve(deps.cwd, request.dir);
    const planned = await buildPlan(
        { ...request, dir },
        {
            exec: (command, timeoutMs) => deps.exec(command, timeoutMs, { cwd: root.value }),
            repoRoot: root.value,
            home: deps.home,
            tmpdir: deps.tmpdir,
            now: deps.now,
            exists: deps.exists,
            fallowPlugin: deps.fallowPlugin,
            review: config.value,
            briefsDir: deps.briefsDir,
        },
    );
    if (!planned.ok) {
        deps.stderr(planned.error);
        return planned.refused === true ? 2 : 1;
    }
    deps.stdout(planned.value.dir);
    return 0;
}

function isReviewerId(value: string): value is ReviewerId {
    return (REVIEWER_IDS as readonly string[]).includes(value);
}

function runnerFor(
    reviewer: ReviewerId,
    plan: Plan,
    runners: CliDeps["runners"],
): Result<{ row: PlannedReviewer; runner: Runner }> {
    const row = plan.team.find((member) => member.reviewer === reviewer);
    if (row === undefined) {
        return { ok: false, error: `${reviewer} is not in the plan's team` };
    }
    const runner = runners[reviewer];
    if (runner !== undefined) {
        return { ok: true, value: { row, runner } };
    }
    return row.kind === "teammate"
        ? { ok: false, error: `${reviewer} is a teammate: it writes its own file` }
        : { ok: false, error: `${reviewer} has no runner yet` };
}

// A skip is the reviewer's outcome, recorded in its file, not an error of the command.
function record(file: ReviewerFile, output: string, deps: CliDeps): number {
    try {
        writeFileSync(output, `${JSON.stringify(file, null, 2)}\n`);
    } catch (error) {
        return fail(deps, `writing ${output}: ${(error as Error).message}`);
    }
    if (file.outcome === "skipped") {
        deps.stderr(`${file.reviewer} skipped: ${file.reason}`);
    }
    return 0;
}

// The error of a HEAD that is not the planned one, or of a HEAD that cannot be read.
async function headError(deps: CliDeps, root: string, plan: Plan): Promise<string | undefined> {
    const head = await deps.exec("git", CLI_TIMEOUT_MS, { cwd: root })(["rev-parse", "HEAD"]);
    if (!head.ok) {
        return `could not check HEAD: ${head.error}`;
    }
    const now = head.stdout.trim();
    return now === plan.subject.head
        ? undefined
        : `HEAD moved since the plan, from ${plan.subject.head} to ${now}`;
}

async function run(reviewer: string, dir: string, deps: CliDeps): Promise<number> {
    if (!isReviewerId(reviewer)) {
        return fail(
            deps,
            `unknown reviewer: ${reviewer}; expected one of ${REVIEWER_IDS.join(", ")}`,
        );
    }
    const plan = readPlan(dir);
    if (!plan.ok) {
        return fail(deps, plan.error);
    }
    const found = runnerFor(reviewer, plan.value, deps.runners);
    if (!found.ok) {
        return fail(deps, found.error);
    }
    const { row, runner } = found.value;
    const root = await repositoryRoot(deps);
    if (!root.ok) {
        return fail(deps, root.error);
    }
    // A reviewer run on another HEAD would review other commits under the planned subject.
    const moved = await headError(deps, root.value, plan.value);
    if (moved !== undefined) {
        return fail(deps, moved);
    }
    const file = await runner({
        exec: (command, timeoutMs, options) =>
            deps.exec(command, timeoutMs, { ...options, cwd: root.value }),
        dir,
        plan: plan.value,
        row,
        now: () => deps.now().getTime(),
    });
    return record(file, join(dir, row.output), deps);
}

async function collectReport(dir: string, deps: CliDeps): Promise<number> {
    const root = await repositoryRoot(deps);
    if (!root.ok) {
        return fail(deps, root.error);
    }
    const bound = (command: string) => deps.exec(command, CLI_TIMEOUT_MS, { cwd: root.value });
    const report = await deps.collect(dir, {
        git: bound("git"),
        plannotator: bound("plannotator"),
    });
    if (!report.ok) {
        return fail(deps, report.error);
    }
    deps.stdout(join(dir, "report.md"));
    for (const error of report.value.errors) {
        deps.stderr(error);
    }
    return report.value.errors.length === 0 ? 0 : 1;
}

export async function main(argv: readonly string[], deps: CliDeps): Promise<number> {
    const parsed = parse(argv);
    if (!parsed.ok) {
        deps.stderr(`${parsed.error}\n${USAGE}`);
        return 1;
    }
    const command = parsed.value;
    switch (command.name) {
        case "plan":
            return plan(command.request, deps);
        case "run":
            return run(command.reviewer, resolve(deps.cwd, command.dir), deps);
        case "collect":
            return collectReport(resolve(deps.cwd, command.dir), deps);
    }
}

if (import.meta.main) {
    const home = process.env.HOME ?? homedir();
    process.exitCode = await main(process.argv.slice(2), {
        exec: (command, timeoutMs, options) => execCommand(command, timeoutMs, options),
        env: process.env,
        cwd: process.cwd(),
        home,
        tmpdir: tmpdir(),
        now: () => new Date(),
        exists: existsSync,
        fallowPlugin: async () => (await loadSkills(home, "fallow", ["fallow-review"])).ok,
        briefsDir: fileURLToPath(new URL("../../skills/review-team/reviewers", import.meta.url)),
        collect,
        runners: RUNNERS,
        stdout: (value) => process.stdout.write(`${value}\n`),
        stderr: (value) => process.stderr.write(`${value}\n`),
    });
}
