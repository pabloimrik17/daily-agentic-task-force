// The production tracker factory: each tracker reaches its source through the
// source's own CLI.

import { execCommand } from "../../exec.ts";
import { beadsTracker } from "./beads.ts";
import { githubTracker } from "./github.ts";
import { linearTracker } from "./linear.ts";
import type { TrackerFactory } from "./tracker.ts";

export const cliTrackers: TrackerFactory = (config) => ({
    beads: beadsTracker(execCommand("bd"), config.sources.beads),
    github: githubTracker(execCommand("gh"), config.sources.github),
    linear: linearTracker(execCommand("linear"), config.sources.linear),
});
