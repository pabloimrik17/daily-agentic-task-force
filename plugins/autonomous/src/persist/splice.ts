export const DEFINITION_HEADING = "## Definition";
export const ORIGINAL_HEADING = "## Original description";

const SEPARATOR = `\n---\n\n${ORIGINAL_HEADING}\n`;

// The original description stays below the separator byte for byte, so a second
// grill replaces only the definition above it. A definition without the heading
// gets it, because the detection of an earlier grill keys on it. Trackers strip trailing
// whitespace, so with an empty original the heading can be the last line, without its newline.
export function spliceDefinition(description: string | null, definition: string): string {
    const current = description ?? "";
    const headed = definition.startsWith(DEFINITION_HEADING)
        ? definition
        : `${DEFINITION_HEADING}\n\n${definition}`;
    const separator = current.startsWith(DEFINITION_HEADING)
        ? `${current.trimEnd()}\n`.indexOf(SEPARATOR)
        : -1;
    const below =
        separator === -1
            ? `${SEPARATOR}${current === "" ? "" : `\n${current}`}`
            : current.slice(separator);
    return `${headed.trimEnd()}\n${below}`;
}

// The definition a grill wrote: what sits above the separator. Null when the description
// does not start with the heading, that is, when no grill has written one.
export function definitionOf(description: string | null): string | null {
    if (description === null || !description.startsWith(DEFINITION_HEADING)) return null;
    const text = `${description.trimEnd()}\n`;
    const separator = text.indexOf(SEPARATOR);
    return (separator === -1 ? text : text.slice(0, separator)).trim();
}
