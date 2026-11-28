// The runner of each CLI reviewer, by id (design D2 and D8). `run <id>` looks the runner up here.

import { runCoderabbit } from "./runners/coderabbit.ts";
import { runCodex } from "./runners/codex.ts";
import type { Runner } from "./runners/shared.ts";
import type { ReviewerId } from "./types.ts";

export const RUNNERS: Readonly<Partial<Record<ReviewerId, Runner>>> = {
    codex: runCodex,
    coderabbit: runCoderabbit,
};
