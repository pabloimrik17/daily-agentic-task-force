// The review team's loader for the `review` block of the user configuration (spec
// review-team, "The review configuration"; design D12). The block's validator lives
// in `src/config.ts`, next to the other optional blocks; this loader alone tolerates a
// missing file.

import { loadConfig, REVIEW_KEYS, shippedReview } from "../config.ts";
import type { Result } from "../result.ts";
import type { ReviewConfig } from "./types.ts";

// `defaulted` lists the `review` keys that took a shipped value, as dotted paths.
export function loadReviewConfig(
    env: Record<string, string | undefined>,
    readFile?: (path: string) => string,
): Result<{ review: ReviewConfig; defaulted: string[] }> {
    const loaded = loadConfig(env, readFile);
    if (loaded.ok) {
        const defaulted = loaded.defaulted.filter((key) => key.startsWith("review."));
        return { ok: true, value: { review: loaded.config.review, defaulted } };
    }
    if (loaded.missing === true) {
        const defaulted = REVIEW_KEYS.map((key) => `review.${key}`);
        return { ok: true, value: { review: shippedReview(), defaulted } };
    }
    return { ok: false, error: loaded.error };
}
