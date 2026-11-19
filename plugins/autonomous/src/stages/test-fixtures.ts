import { workTask } from "../select/test-fixtures.ts";
import type { StageEnv } from "./stage.ts";

// A stage environment whose readers reject: a stage that ignores them never notices, and a test
// of one that reads replaces the reader it needs.
export function stageEnv(overrides: Partial<StageEnv> = {}): StageEnv {
    const unused = () => Promise.reject(new Error("this stage environment reads nothing"));
    return {
        tool: "claude",
        home: "/unused/home",
        task: workTask(),
        repository: "/unused/repository",
        branch: "feature/DOT-109-stage-sessions",
        readers: {
            context: { source: "linear", read: unused },
            pullRequests: new Proxy({} as StageEnv["readers"]["pullRequests"], {
                get: () => unused,
            }),
            openspec: unused,
        },
        ...overrides,
    };
}
