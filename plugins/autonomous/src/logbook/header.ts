import type { AttemptId } from "../attempts/record.ts";
import type { StageId } from "../stages/stage.ts";
import { logbookMarker } from "./marker.ts";

export interface HeaderInput {
    attempt: AttemptId;
    stage: StageId;
    emoji: string;
    /** The attempt number. */
    number: number;
    /** The task's autonomy label, null when it has none. */
    autonomy: string | null;
    agentArgs: string[] | null;
    /** ISO; the record's first `started` entry. */
    start: string | null;
    /** ISO; the mode's start time. */
    end: string;
    /** From transition.json; null when absent. */
    answer: string[] | null;
    /** Short ids. */
    commits: string[];
}

export interface DiscardInput {
    attempt: AttemptId;
    stage: StageId;
    emoji: string;
    number: number;
    at: string;
}

const SEPARATOR = " · ";
const MS_PER_MINUTE = 60_000;

const code = (value: string): string => `\`${value}\``;

function pad(value: number): string {
    return String(value).padStart(2, "0");
}

function utcDay(date: Date): string {
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function utcTime(date: Date): string {
    return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function utcStamp(date: Date): string {
    return `${utcDay(date)} ${utcTime(date)}`;
}

function duration(start: Date, end: Date): string {
    const total = Math.max(0, Math.floor((end.getTime() - start.getTime()) / MS_PER_MINUTE));
    if (total < 60) {
        return `${total} min`;
    }
    const hours = Math.floor(total / 60);
    const minutes = total % 60;
    return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

function span(start: string | null, end: string): string {
    const endDate = new Date(end);
    const startDate = start === null ? null : new Date(start);
    if (startDate === null || Number.isNaN(startDate.getTime())) {
        return `ended ${utcStamp(endDate)} UTC`;
    }
    const sameDay = utcDay(startDate) === utcDay(endDate);
    const until = sameDay ? utcTime(endDate) : utcStamp(endDate);
    return `${utcStamp(startDate)} → ${until} UTC (${duration(startDate, endDate)})`;
}

function commitsFact(commits: readonly string[]): string {
    if (commits.length === 0) {
        return "no commits";
    }
    const noun = commits.length === 1 ? "commit" : "commits";
    return `${commits.length} ${noun} (${commits.map(code).join(", ")})`;
}

function facts(input: HeaderInput): string[] {
    const found: string[] = [];
    if (input.autonomy !== null) {
        found.push(code(input.autonomy));
    }
    if (input.agentArgs !== null && input.agentArgs.length > 0) {
        found.push(code(input.agentArgs.join(" ")));
    }
    found.push(span(input.start, input.end));
    if (input.answer !== null && input.answer.length > 0) {
        found.push(`answered ${input.answer.map(code).join(", ")}`);
    }
    found.push(commitsFact(input.commits));
    return found;
}

export function renderHeader(input: HeaderInput): string {
    return [
        logbookMarker(input.attempt),
        `### ${input.emoji} ${input.stage} · attempt ${input.number}`,
        "",
        facts(input).join(SEPARATOR),
    ].join("\n");
}

// Shares the entry marker, so a discarded attempt never has two entries.
export function renderDiscardEntry(input: DiscardInput): string {
    return [
        logbookMarker(input.attempt),
        `### ${input.emoji} ${input.stage} · attempt ${input.number} · discarded`,
        "",
        `Discarded at ${utcStamp(new Date(input.at))} UTC.`,
    ].join("\n");
}
