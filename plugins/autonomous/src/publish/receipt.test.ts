import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
    digestOf,
    PUBLISH_RECEIPT_FILE,
    PUBLISH_RECEIPT_SCHEMA,
    type PublishReceipt,
    isQuietReceipt,
    readPublishReceipt,
    writePublishReceipt,
} from "./receipt.ts";

const RECEIPT: PublishReceipt = {
    schema: PUBLISH_RECEIPT_SCHEMA,
    attempt: "linear:DOT-121:code-review:1",
    pullRequest: { number: 7, url: "https://github.com/o/r/pull/7" },
    findingsDigest: digestOf("{}"),
    walkthroughDigest: null,
    publishedAt: "2026-11-01T09:00:00.000Z",
};

const made: string[] = [];

afterEach(() => {
    for (const directory of made.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

function directory(): string {
    const dir = mkdtempSync(join(tmpdir(), "autonomous-published-"));
    made.push(dir);
    return dir;
}

describe("The receipt records a quiet round", () => {
    it("a quiet round's receipt is read back with its mark", async () => {
        const dir = directory();
        const receipt: PublishReceipt = { ...RECEIPT, quiet: true };
        await writePublishReceipt(dir, receipt);
        const read = await readPublishReceipt(dir);
        expect(read).toEqual({ ok: true, value: receipt });
        expect(read.ok && read.value !== null && isQuietReceipt(read.value)).toBe(true);
    });

    it("a receipt without the mark, as every earlier one, reads as not quiet", async () => {
        const dir = directory();
        writeFileSync(join(dir, PUBLISH_RECEIPT_FILE), JSON.stringify(RECEIPT));
        const read = await readPublishReceipt(dir);
        expect(read.ok && read.value !== null && isQuietReceipt(read.value)).toBe(false);
    });

    it("refuses a mark other than true", async () => {
        const dir = directory();
        writeFileSync(
            join(dir, PUBLISH_RECEIPT_FILE),
            JSON.stringify({ ...RECEIPT, quiet: false }),
        );
        const read = await readPublishReceipt(dir);
        expect(!read.ok && read.error).toContain("$.quiet must be true");
    });
});

describe("publish receipt", () => {
    it("the digest is the sha256 hex of the bytes, whether text or bytes", () => {
        expect(digestOf("abc")).toBe(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        );
        expect(digestOf(new TextEncoder().encode("abc"))).toBe(digestOf("abc"));
    });

    it("a written receipt is read back, and the path written is returned", async () => {
        const dir = directory();

        const written = await writePublishReceipt(dir, RECEIPT);
        const read = await readPublishReceipt(dir);

        expect(written).toEqual({ ok: true, value: join(dir, PUBLISH_RECEIPT_FILE) });
        expect(read).toEqual({ ok: true, value: RECEIPT });
    });

    it("a walkthrough digest survives the round trip", async () => {
        const dir = directory();
        const receipt = { ...RECEIPT, walkthroughDigest: digestOf("walkthrough") };

        await writePublishReceipt(dir, receipt);

        expect(await readPublishReceipt(dir)).toEqual({ ok: true, value: receipt });
    });

    it("a directory with no receipt reads as null", async () => {
        expect(await readPublishReceipt(directory())).toEqual({ ok: true, value: null });
    });

    it("a directory that does not exist reads as null", async () => {
        expect(await readPublishReceipt(join(directory(), "missing"))).toEqual({
            ok: true,
            value: null,
        });
    });

    it("a file that is not JSON is an error naming the file", async () => {
        const dir = directory();
        writeFileSync(join(dir, PUBLISH_RECEIPT_FILE), "not json");

        const read = await readPublishReceipt(dir);

        expect(read.ok).toBe(false);
        expect(!read.ok && read.error).toContain(
            `${join(dir, PUBLISH_RECEIPT_FILE)} is not valid JSON`,
        );
    });

    it.each([
        ["another schema", { ...RECEIPT, schema: "autonomous.published.v0" }, "$.schema"],
        ["a missing digest", { ...RECEIPT, findingsDigest: undefined }, "$.findingsDigest"],
        ["an unknown field", { ...RECEIPT, extra: 1 }, "$.extra"],
        [
            "a mistyped pull request",
            { ...RECEIPT, pullRequest: { number: "7", url: "u" } },
            "$.pullRequest.number",
        ],
    ])("%s is an error naming the field", async (_name, content, field) => {
        const dir = directory();
        writeFileSync(join(dir, PUBLISH_RECEIPT_FILE), JSON.stringify(content));

        const read = await readPublishReceipt(dir);

        expect(read.ok).toBe(false);
        expect(!read.ok && read.error).toContain(`does not match ${PUBLISH_RECEIPT_SCHEMA}`);
        expect(!read.ok && read.error).toContain(field);
    });

    it("an unreadable path is an error, not a null", async () => {
        const dir = directory();
        mkdirSync(join(dir, PUBLISH_RECEIPT_FILE));

        const read = await readPublishReceipt(dir);

        expect(read.ok).toBe(false);
        expect(!read.ok && read.error).toContain("cannot read");
    });

    it("a write that fails is an error naming the file", async () => {
        const dir = directory();
        writeFileSync(join(dir, "blocker"), "x");

        const written = await writePublishReceipt(join(dir, "blocker"), RECEIPT);

        expect(written.ok).toBe(false);
        expect(!written.ok && written.error).toContain("cannot write");
        expect(readFileSync(join(dir, "blocker"), "utf8")).toBe("x");
    });
});
