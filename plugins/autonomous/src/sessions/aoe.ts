// The Agent of Empires adapter (design D2, D3; spec stage-sessions, "Session
// identity", "Observed session state", "Session removal"): the session
// manager over the `aoe` CLI (1.14.0), one small function per command. Every
// call goes through the injected exec, so the CLI time limit bounds it, and
// every error names the aoe command that failed.

import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

import { type Exec, execCommand } from "../exec.ts";
import { run, runJson } from "../label-triage/trackers/cli-json.ts";
import type { Result } from "../result.ts";
import { array, type Json, object, string } from "../validate.ts";
import type { Observed, SessionManager, SessionManagerFactory, SessionSpec } from "./manager.ts";

// `aoe add` prints the id indented and padded: "  ID:      336c83018fca4d13".
const ID_LINE = /^\s*ID:\s*([0-9a-f]{16})\s*$/m;

const NOT_FOUND = "Session not found";

type Mapped = Pick<Observed, "state" | "busy" | "needsHuman">;

const OPEN_BUSY: Mapped = { state: "open", busy: true, needsHuman: false };
const OPEN_IDLE: Mapped = { state: "open", busy: false, needsHuman: false };
const EXITED: Mapped = { state: "exited", busy: false, needsHuman: false };

// Design D3: AoE's status words reduced to the contract's vocabulary.
const STATUSES: ReadonlyMap<string, Mapped> = new Map([
    ["running", OPEN_BUSY],
    ["starting", OPEN_BUSY],
    ["creating", OPEN_BUSY],
    ["idle", OPEN_IDLE],
    ["unknown", OPEN_IDLE],
    ["waiting", { state: "open", busy: false, needsHuman: true }],
    ["stopped", EXITED],
    ["error", EXITED],
    ["deleting", EXITED],
]);

const GONE: Observed = {
    state: "gone",
    status: "not found",
    busy: false,
    needsHuman: false,
    agentSessionId: null,
};

// A status word the table does not know is treated like `unknown`: open and not busy.
// The caller reports the word verbatim.
export function mapStatus(status: string): Mapped {
    return STATUSES.get(status) ?? OPEN_IDLE;
}

// `--extra-args` is spliced into a shell string, so the instruction is one single-quoted word.
export function shellQuote(value: string): string {
    return `'${value.replaceAll("'", "'\\''")}'`;
}

// AoE takes the profile per subcommand, right after the leaf subcommand.
function argv(profile: string | null, command: string[], rest: string[]): string[] {
    return profile === null ? [...command, ...rest] : [...command, "--profile", profile, ...rest];
}

function nullableString(entry: Json, key: string, path: string): string | null {
    return entry[key] === undefined || entry[key] === null ? null : string(entry, key, path);
}

function parseShow(value: unknown): Observed {
    const root = object(value, "$");
    const status = string(root, "status", "$");
    return {
        ...mapStatus(status),
        status,
        agentSessionId: nullableString(root, "agent_session_id", "$"),
    };
}

function parseList(value: unknown): { id: string; path: string }[] {
    return array(value, "$").map((item, index) => {
        const entry = object(item, `$[${index}]`);
        return {
            id: string(entry, "id", `$[${index}]`),
            path: string(entry, "path", `$[${index}]`),
        };
    });
}

function collectGroups(value: unknown, path: string, paths: string[]): void {
    array(value, path).forEach((item, index) => {
        const entry = object(item, `${path}[${index}]`);
        paths.push(string(entry, "path", `${path}[${index}]`));
        if (entry.children !== undefined) {
            collectGroups(entry.children, `${path}[${index}].children`, paths);
        }
    });
}

function parseGroups(value: unknown): string[] {
    const paths: string[] = [];
    collectGroups(value, "$", paths);
    return paths;
}

// A path that does not exist on disk is compared as written, made absolute.
async function canonical(path: string): Promise<string> {
    try {
        return await realpath(path);
    } catch {
        return resolve(path);
    }
}

function createArgs(profile: string | null, spec: SessionSpec): string[] {
    const override = spec.binary === null ? [] : ["--cmd-override", spec.binary];
    const extra = [...spec.args, shellQuote(spec.instruction)].join(" ");
    return argv(
        profile,
        ["add"],
        [
            spec.path,
            "--title",
            spec.title,
            "--group",
            spec.group,
            "--tool",
            spec.tool,
            ...override,
            "--extra-args",
            extra,
        ],
    );
}

async function add(exec: Exec, profile: string | null, spec: SessionSpec): Promise<Result<string>> {
    const result = await exec(createArgs(profile, spec));
    if (!result.ok) {
        return { ok: false, error: `aoe add: ${result.error}` };
    }
    const id = ID_LINE.exec(result.stdout)?.[1];
    return id === undefined
        ? { ok: false, error: "aoe add: no ID line in output" }
        : { ok: true, value: id };
}

async function show(exec: Exec, profile: string | null, id: string): Promise<Result<Observed>> {
    const command = `aoe session show ${id} --json`;
    const result = await runJson(
        exec,
        command,
        argv(profile, ["session", "show"], [id, "--json"]),
        parseShow,
    );
    if (!result.ok && result.error.includes(NOT_FOUND)) {
        return { ok: true, value: GONE };
    }
    return result;
}

async function create(
    exec: Exec,
    profile: string | null,
    spec: SessionSpec,
): Promise<Result<{ id: string }>> {
    const added = await add(exec, profile, spec);
    if (!added.ok) {
        return added;
    }
    const confirmed = await show(exec, profile, added.value);
    if (!confirmed.ok) {
        return confirmed;
    }
    if (confirmed.value.state === "gone") {
        return {
            ok: false,
            error: `aoe session show ${added.value} --json: ${NOT_FOUND} right after aoe add`,
        };
    }
    return { ok: true, value: { id: added.value } };
}

async function findByPath(
    exec: Exec,
    profile: string | null,
    path: string,
): Promise<Result<string[]>> {
    const listed = await runJson(
        exec,
        "aoe list --json",
        argv(profile, ["list"], ["--json"]),
        parseList,
    );
    if (!listed.ok) {
        return listed;
    }
    const target = await canonical(path);
    const ids: string[] = [];
    for (const entry of listed.value) {
        if ((await canonical(entry.path)) === target) {
            ids.push(entry.id);
        }
    }
    return { ok: true, value: ids };
}

async function capture(
    exec: Exec,
    profile: string | null,
    id: string,
    lines: number,
): Promise<Result<string>> {
    const result = await exec(
        argv(profile, ["session", "capture"], [id, "-n", String(lines), "--strip-ansi"]),
    );
    return result.ok
        ? { ok: true, value: result.stdout }
        : { ok: false, error: `aoe session capture ${id}: ${result.error}` };
}

export function aoeManager(exec: Exec, profile: string | null): SessionManager {
    return {
        create: (spec) => create(exec, profile, spec),
        start: (id) =>
            run(exec, `aoe session start ${id}`, argv(profile, ["session", "start"], [id])),
        observe: (id) => show(exec, profile, id),
        findByPath: (path) => findByPath(exec, profile, path),
        listGroups: () =>
            runJson(
                exec,
                "aoe group list --json",
                argv(profile, ["group", "list"], ["--json"]),
                parseGroups,
            ),
        capture: (id, lines) => capture(exec, profile, id, lines),
        // `--purge`: AoE's trash keeps a removed session listed as `error`. Never
        // `--delete-worktree`: the workspace belongs to the workspace manager.
        remove: (id) => run(exec, `aoe remove ${id}`, argv(profile, ["remove"], [id, "--purge"])),
    };
}

export const aoeSessions: SessionManagerFactory = (config) =>
    aoeManager(execCommand("aoe"), config.sessions.profile);
