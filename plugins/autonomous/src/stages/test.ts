// The test stage (spec stage-sessions, "The test stage"): a stage whose only
// work is to write the result marker, to exercise a launch end to end without
// touching a repository. It is never selected; `--task … --stage test` runs it.

import type { SessionTool } from "../sessions/manager.ts";
import { renderPrompt } from "./prompt.ts";
import type { Stage } from "./stage.ts";

const INSTRUCTIONS =
    "Write the result marker exactly as given below and stop. Do not change any file of the repository.";

// No codex model flag: the user's default model applies.
const AGENT_ARGS: Record<SessionTool, string[]> = {
    claude: ["--model", "haiku", "--effort", "low"],
    codex: ["-c", "model_reasoning_effort=low"],
};

export const testStage: Stage = {
    id: "test",
    emoji: "🧪",
    agentArgs: (tool) => [...AGENT_ARGS[tool]],
    prompt: (input) => renderPrompt(input, INSTRUCTIONS),
    completed: () => true,
};
