// The hidden, versioned markers of finding threads (spec finding-threads, "Hidden markers";
// design D10). They, not the comment's author, tell a stage's comments from a human's.

export type FindingKind = "finding" | "doubt";

export type Marker =
    | { kind: FindingKind; attempt: string; finding: string; for?: string }
    | { kind: "resolution"; attempt: string; finding: string; state: string }
    | { kind: "review"; attempt: string; round: number };

const TOKEN = /^[^\s=]+$/u;
const MARKER = /<!-- autonomous:(finding|doubt|resolution|review) v1((?: [a-z]+=[^\s=]+)*) -->/gu;

export function renderMarker(marker: Marker): string {
    const fields: [string, string | number | undefined][] =
        marker.kind === "review"
            ? [
                  ["attempt", marker.attempt],
                  ["round", marker.round],
              ]
            : marker.kind === "resolution"
              ? [
                    ["attempt", marker.attempt],
                    ["finding", marker.finding],
                    ["state", marker.state],
                ]
              : [
                    ["attempt", marker.attempt],
                    ["finding", marker.finding],
                    ["for", marker.for],
                ];
    const pairs = fields.filter(([, value]) => value !== undefined).map(pair);
    return `<!-- autonomous:${marker.kind} v1 ${pairs.join(" ")} -->`;
}

function pair([key, value]: [string, string | number | undefined]): string {
    const text = String(value);
    if (!TOKEN.test(text)) {
        throw new Error(`a marker's ${key} cannot hold whitespace or "=": ${JSON.stringify(text)}`);
    }
    return `${key}=${text}`;
}

export function parseMarkers(body: string): Marker[] {
    return [...body.matchAll(MARKER)].flatMap((match) => {
        const marker = toMarker(match[1] ?? "", fieldsOf(match[2] ?? ""));
        return marker === null ? [] : [marker];
    });
}

function fieldsOf(text: string): Map<string, string> {
    const fields = new Map<string, string>();
    for (const item of text.trim().split(" ").filter(Boolean)) {
        const at = item.indexOf("=");
        fields.set(item.slice(0, at), item.slice(at + 1));
    }
    return fields;
}

function toMarker(kind: string, fields: Map<string, string>): Marker | null {
    const attempt = fields.get("attempt");
    if (attempt === undefined) {
        return null;
    }
    if (kind === "review") {
        const round = Number(fields.get("round"));
        return Number.isInteger(round) && round > 0 ? { kind, attempt, round } : null;
    }
    const finding = fields.get("finding");
    if (finding === undefined) {
        return null;
    }
    if (kind === "resolution") {
        const state = fields.get("state");
        return state === undefined ? null : { kind, attempt, finding, state };
    }
    const addressed = fields.get("for");
    const base = { kind: kind as FindingKind, attempt, finding };
    return addressed === undefined ? base : { ...base, for: addressed };
}

export function threadMarker(firstComment: string): Extract<Marker, { kind: FindingKind }> | null {
    const found = parseMarkers(firstComment).find(
        (marker): marker is Extract<Marker, { kind: FindingKind }> =>
            marker.kind === "finding" || marker.kind === "doubt",
    );
    return found ?? null;
}
