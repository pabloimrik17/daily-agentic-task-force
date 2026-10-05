// Browser steps (design D5, D10): print a collector's or an action's
// JavaScript, bound to this run's id, for Claude to pass to `javascript_tool`
// unchanged. The capture hook keeps the result only when it carries that id.

import { actionSource, collectorSource, type SourceResult } from "../browser/index.ts";
import { openRun } from "./shared.ts";
import { type Step, type StepOutput, type StepTable, UsageError } from "./types.ts";

const HOW =
    "Pass this source to `javascript_tool` unchanged, on its own, never inside `browser_batch`.";

function printed(result: SourceResult): StepOutput {
    if (!result.ok) {
        throw new UsageError(result.error);
    }
    return {
        markdown: ["```js", result.source, "```", "", HOW].join("\n"),
        directive: { kind: "done" },
    };
}

const collector: Step = (ctx, args) => {
    const [name] = args;
    if (name === undefined || args.length !== 1) {
        throw new UsageError("collector takes one collector name");
    }
    const opened = openRun(ctx);
    if (!opened.ok) {
        return Promise.resolve(opened.output);
    }
    return Promise.resolve(printed(collectorSource(name, opened.scope.run.runId)));
};

const action: Step = (ctx, args) => {
    const [name, ...rest] = args;
    if (name === undefined) {
        throw new UsageError("action takes an action name and its arguments");
    }
    const opened = openRun(ctx);
    if (!opened.ok) {
        return Promise.resolve(opened.output);
    }
    return Promise.resolve(printed(actionSource(name, opened.scope.run.runId, rest)));
};

export const browserSteps: StepTable = {
    collector: { step: collector },
    action: { step: action },
};
