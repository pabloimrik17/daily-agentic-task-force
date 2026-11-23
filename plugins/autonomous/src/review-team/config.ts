// The review team's loader for the `review` block of the user configuration (spec
// review-team, "The review configuration"; design D12). The block's validator lives
// in `src/config.ts`, next to the other optional blocks; this loader alone tolerates a
// missing file.

import { loadConfig, shippedReview } from "../config.ts";
import type { Result } from "../result.ts";
import type { ReviewConfig } from "./types.ts";

export function loadReviewConfig(
    env: Record<string, string | undefined>,
    readFile?: (path: string) => string,
): Result<ReviewConfig> {
    const loaded = loadConfig(env, readFile);
    if (loaded.ok) {
        return { ok: true, value: loaded.config.review };
    }
    if (loaded.missing === true) {
        return { ok: true, value: shippedReview() };
    }
    return { ok: false, error: loaded.error };
}
