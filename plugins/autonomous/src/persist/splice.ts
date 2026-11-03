export const DEFINITION_HEADING = "## Definition";
export const ORIGINAL_HEADING = "## Original description";

const SEPARATOR = `\n---\n\n${ORIGINAL_HEADING}\n`;

// The original description stays below the separator byte for byte, so a second
// grill replaces only the definition above it (design D4). A definition without the heading
// gets it, because the detection of an earlier grill keys on it.
export function spliceDefinition(description: string | null, definition: string): string {
    const current = description ?? "";
    const headed = definition.startsWith(DEFINITION_HEADING)
        ? definition
        : `${DEFINITION_HEADING}\n\n${definition}`;
    const separator = current.startsWith(DEFINITION_HEADING) ? current.indexOf(SEPARATOR) : -1;
    const below =
        separator === -1
            ? `${SEPARATOR}${current === "" ? "" : `\n${current}`}`
            : current.slice(separator);
    return `${headed.trimEnd()}\n${below}`;
}
