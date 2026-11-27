// Whether a reviewer can run, decided by code before anything runs (spec review-team, "A
// reviewer that cannot run is skipped and recorded"; design D7). Every check is a read-only
// command or a file check; the caller injects an Exec with a short timeout, so a check that
// times out is a skip with the timeout as its reason.

import { join } from "node:path";

import type { Exec } from "../exec.ts";
import type { ReviewerId } from "./types.ts";

export interface AvailabilityDeps {
    exec: (command: string) => Exec;
    exists: (path: string) => boolean;
    home: string;
    repoRoot: string;
    fallowPlugin: () => Promise<boolean>;
}

export type Availability = { available: true } | { available: false; reason: string };

const AVAILABLE: Availability = { available: true };

function skip(reason: string): Availability {
    return { available: false, reason };
}

// An Exec error that says the command ran and exited non-zero is the tool's own answer; a
// missing binary or a timeout is the reason itself.
function failureReason(error: string, answer: string): string {
    return / failed: /.test(error) ? answer : error;
}

async function checkCodex(deps: AvailabilityDeps): Promise<Availability> {
    const result = await deps.exec("codex")(["login", "status"]);
    return result.ok ? AVAILABLE : skip(failureReason(result.error, "not logged in"));
}

function isAuthenticated(stdout: string): boolean {
    return stdout.split("\n").some((line) => {
        try {
            return (JSON.parse(line) as { authenticated?: unknown }).authenticated === true;
        } catch {
            return false;
        }
    });
}

async function checkCoderabbit(deps: AvailabilityDeps): Promise<Availability> {
    const result = await deps.exec("coderabbit")(["auth", "status", "--agent"]);
    if (!result.ok) {
        return skip(failureReason(result.error, "not logged in"));
    }
    return isAuthenticated(result.stdout) ? AVAILABLE : skip("not logged in");
}

// The reason names the directory as a person writes it, never as an absolute path: it is copied
// into the plan and the report, which hold no path of the machine.
function checkShadow(id: ReviewerId, deps: AvailabilityDeps): Availability {
    const shadow = [
        { root: deps.home, shown: "~" },
        { root: deps.repoRoot, shown: "." },
    ].find(({ root }) => deps.exists(join(root, ".claude", "skills", id)));
    return shadow === undefined
        ? AVAILABLE
        : skip(`a skill named ${id} in ${shadow.shown}/.claude/skills/${id} shadows the built-in`);
}

async function checkFallow(deps: AvailabilityDeps): Promise<Availability> {
    if (!deps.exists(join(deps.repoRoot, "package.json"))) {
        return skip("not applicable: no package.json");
    }
    const tool = await deps.exec("fallow")(["--version"]);
    if (!tool.ok) {
        return skip(tool.error);
    }
    return (await deps.fallowPlugin()) ? AVAILABLE : skip("the fallow plugin is not installed");
}

const CHECKS: Partial<Record<ReviewerId, (deps: AvailabilityDeps) => Promise<Availability>>> = {
    codex: checkCodex,
    coderabbit: checkCoderabbit,
    "code-review": (deps) => Promise.resolve(checkShadow("code-review", deps)),
    "security-review": (deps) => Promise.resolve(checkShadow("security-review", deps)),
    "fallow-review": checkFallow,
};

// The walkthrough and the tests lens need only Claude and the plugin, so they have no check.
export async function checkAvailability(
    id: ReviewerId,
    deps: AvailabilityDeps,
): Promise<Availability> {
    const check = CHECKS[id];
    return check === undefined ? AVAILABLE : check(deps);
}

// Whether `plannotator` can validate the walkthrough's guide; the walkthrough runs without it.
export async function guideAvailability(
    deps: Pick<AvailabilityDeps, "exec">,
): Promise<{ available: boolean; reason?: string }> {
    const result = await deps.exec("plannotator")(["--version"]);
    return result.ok ? { available: true } : { available: false, reason: result.error };
}

export async function engineVersion(
    tool: string,
    deps: Pick<AvailabilityDeps, "exec">,
): Promise<string> {
    const command = tool === "claude-code" ? "claude" : tool;
    const result = await deps.exec(command)(["--version"]);
    return result.ok && result.stdout.trim() !== "" ? result.stdout.trim() : "unknown";
}
