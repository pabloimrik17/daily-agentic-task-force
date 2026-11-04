// What persist's read-back confirms (design D4): that the text landed. A tracker may re-serialise
// the Markdown on save (Linear turns `- ` bullets into `* ` and wraps link destinations in
// `<>`) and links the task identifiers it finds, so a link counts as its text and only the
// letters and digits are compared, in order.

// `[text](dest)` or `![alt](dest)`: the destination bare or in `<>`, with an optional title.
const LINK = /!?\[([^\]]*)\]\(\s*(?:<[^>]*>|[^\s)]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/gu;

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/gu;

const trimmed = (description: string | null) => (description ?? "").trimEnd();

// The tracker kept the description as written, trailing whitespace aside.
export function sameBytes(written: string | null, read: string | null): boolean {
    return trimmed(written) === trimmed(read);
}

const textOf = (description: string | null) =>
    (description ?? "").replace(LINK, "$1").match(LETTER_OR_DIGIT)?.join("") ?? "";

export function sameText(written: string | null, read: string | null): boolean {
    return textOf(written) === textOf(read);
}
