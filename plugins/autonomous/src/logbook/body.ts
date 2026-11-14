// The format is expected to change as it is used, so every limit lives in this file. Who took
// each decision is the agent's to write and is not checked.

export const REQUIRED_SECTIONS: readonly string[] = [
    "What I did",
    "Decisions",
    "Assumptions",
    "Next stage",
];

export const MAX_WORDS = 300;

const WHAT_I_DID = "What I did";

export interface BodyCheck {
    words: number;
    /** One human-readable reason per rule the body breaks; empty when the body is valid. */
    broken: string[];
}

function lines(text: string): string[] {
    return text.split(/\r?\n/);
}

function countWords(text: string): number {
    return text.split(/\s+/).filter((token) => token !== "").length;
}

function sectionStart(all: readonly string[], name: string): number {
    return all.findIndex((line) => line.trimEnd() === `### ${name}`);
}

// The section ends at a heading of its own level or higher; a deeper heading belongs to it but is
// not content by itself.
function isEmptySection(all: readonly string[], start: number): boolean {
    for (const line of all.slice(start + 1)) {
        if (/^#{1,3}\s/.test(line)) {
            return true;
        }
        if (/^#{4,6}\s/.test(line)) {
            continue;
        }
        if (line.trim() !== "") {
            return false;
        }
    }
    return true;
}

function sectionReasons(text: string): string[] {
    const all = lines(text);
    const broken: string[] = [];
    for (const name of REQUIRED_SECTIONS) {
        if (sectionStart(all, name) === -1) {
            broken.push(`the section "### ${name}" is missing`);
        }
    }
    const start = sectionStart(all, WHAT_I_DID);
    if (start !== -1 && isEmptySection(all, start)) {
        broken.push(`the section "### ${WHAT_I_DID}" is empty`);
    }
    return broken;
}

export function checkBody(text: string, home: string): BodyCheck {
    const words = countWords(text);
    const broken = sectionReasons(text);
    if (words > MAX_WORDS) {
        broken.push(`the body has ${words} words, over the limit of ${MAX_WORDS}`);
    }
    if (home !== "" && text.includes(home)) {
        broken.push("the body names this machine's home directory");
    }
    return { words, broken };
}
