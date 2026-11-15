import { execCommand } from "../exec.ts";
import { beadsContext } from "./beads.ts";
import { githubContext } from "./github.ts";
import { linearContext } from "./linear.ts";
import type { ContextReaderFactory } from "./types.ts";

export const cliContext: ContextReaderFactory = (config, trackers) => ({
    beads: beadsContext(execCommand("bd"), config.sources.beads),
    github: githubContext(execCommand("gh")),
    linear: linearContext(execCommand("linear"), trackers.linear),
});
