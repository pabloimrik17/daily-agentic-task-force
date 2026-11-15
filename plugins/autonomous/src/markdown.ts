const FENCE = /^ {0,3}(`{3,}|~{3,})/;

function closes(line: string, open: string): boolean {
    const run = line.trim();
    return run.length >= open.length && run === open.charAt(0).repeat(run.length);
}

// A fence closes on a run of its own character, at least as long, alone on the line. An unclosed
// one runs to the end. The fence lines themselves count as fenced.
function fencedLines(lines: readonly string[]): boolean[] {
    let open: string | null = null;
    return lines.map((line) => {
        if (open === null) {
            open = FENCE.exec(line)?.[1] ?? null;
            return open !== null;
        }
        if (closes(line, open)) {
            open = null;
        }
        return true;
    });
}

/** The index of the first line outside a fenced code block that `matches`, or -1. */
export function findOutsideFences(
    lines: readonly string[],
    matches: (line: string) => boolean,
): number {
    const fenced = fencedLines(lines);
    return lines.findIndex((line, index) => fenced[index] !== true && matches(line));
}
