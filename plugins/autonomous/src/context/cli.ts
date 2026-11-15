import { execCommand } from "../exec.ts";
import { beadsContext } from "./beads.ts";
import { githubContext } from "./github.ts";
import { readAuthoredComments } from "../label-triage/trackers/linear.ts";
import { linearContext } from "./linear.ts";
import type { ContextReaderFactory } from "./types.ts";

export const cliContext: ContextReaderFactory = (config) => {
    const linear = execCommand("linear");
    return {
        beads: beadsContext(execCommand("bd"), config.sources.beads),
        github: githubContext(execCommand("gh")),
        linear: linearContext(linear, (id) => readAuthoredComments(linear, id)),
    };
};
