// The publish receipt (spec finding-threads; design D13): `published.json` in a code review or
// external review attempt's directory names the digest of the `findings.json` bytes publish mode published, so the
// transition can tell a record that was published from one a human round changed afterwards.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { writeJsonAtomic } from "../attempts/state.ts";
import type { Result } from "../result.ts";
import { type Json, number, object, ParseError, rejectUnknownKeys, string } from "../validate.ts";

export const FINDINGS_FILE = "findings.json";

export const PUBLISH_RECEIPT_FILE = "published.json";

export const PUBLISH_RECEIPT_SCHEMA = "autonomous.published.v1";

export interface PublishReceipt {
    schema: typeof PUBLISH_RECEIPT_SCHEMA;
    attempt: string;
    pullRequest: { number: number; url: string };
    findingsDigest: string; // sha256 hex of the exact findings.json bytes published
    // sha256 hex of the JSON array [walkthrough.json, walkthrough.patch] as saved; null when none
    walkthroughDigest: string | null;
    publishedAt: string; // ISO 8601
    quiet?: true; // an external review's quiet round, its resolutions and dismissals read back
}

// Spec finding-threads, "The receipt records a quiet round": a receipt without the mark, as every
// one written before external review, is not a quiet round's.
export function isQuietReceipt(receipt: PublishReceipt): boolean {
    return receipt.quiet === true;
}

function quietMark(root: Json): { quiet?: true } {
    if (!("quiet" in root)) {
        return {};
    }
    if (root.quiet !== true) {
        throw new ParseError("$.quiet must be true when present");
    }
    return { quiet: true };
}

export function digestOf(bytes: string | Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

function parseReceipt(input: unknown): PublishReceipt {
    const root = object(input, "$");
    rejectUnknownKeys(
        root,
        [
            "schema",
            "attempt",
            "pullRequest",
            "findingsDigest",
            "walkthroughDigest",
            "publishedAt",
            "quiet",
        ],
        "$",
    );
    if (root.schema !== PUBLISH_RECEIPT_SCHEMA) {
        throw new ParseError(`$.schema must be ${PUBLISH_RECEIPT_SCHEMA}`);
    }
    const pullRequest: Json = object(root.pullRequest, "$.pullRequest");
    rejectUnknownKeys(pullRequest, ["number", "url"], "$.pullRequest");
    return {
        schema: PUBLISH_RECEIPT_SCHEMA,
        attempt: string(root, "attempt", "$"),
        pullRequest: {
            number: number(pullRequest, "number", "$.pullRequest"),
            url: string(pullRequest, "url", "$.pullRequest"),
        },
        findingsDigest: string(root, "findingsDigest", "$"),
        walkthroughDigest:
            root.walkthroughDigest === null ? null : string(root, "walkthroughDigest", "$"),
        publishedAt: string(root, "publishedAt", "$"),
        ...quietMark(root),
    };
}

// Null when the directory holds no receipt: the attempt was never published.
export async function readPublishReceipt(dir: string): Promise<Result<PublishReceipt | null>> {
    const file = join(dir, PUBLISH_RECEIPT_FILE);
    let text: string;
    try {
        text = await readFile(file, "utf8");
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === "ENOENT"
            ? { ok: true, value: null }
            : { ok: false, error: `cannot read ${file}: ${messageOf(error)}` };
    }
    try {
        return { ok: true, value: parseReceipt(JSON.parse(text)) };
    } catch (error) {
        const why =
            error instanceof ParseError
                ? `does not match ${PUBLISH_RECEIPT_SCHEMA}`
                : "is not valid JSON";
        return { ok: false, error: `${file} ${why}: ${messageOf(error)}` };
    }
}

export async function writePublishReceipt(
    dir: string,
    receipt: PublishReceipt,
): Promise<Result<string>> {
    const file = join(dir, PUBLISH_RECEIPT_FILE);
    try {
        await writeJsonAtomic(file, receipt);
        return { ok: true, value: file };
    } catch (error) {
        return { ok: false, error: `cannot write ${file}: ${messageOf(error)}` };
    }
}
