export type FormatTime = (date: Date) => string;

const ENV_ORDER = ["LC_ALL", "LC_TIME", "LANG"] as const;

function toLocaleTag(value: string | undefined): string | undefined {
    const base = value?.split(".")[0]?.split("@")[0]?.replace("_", "-");
    if (base === undefined || base === "" || base === "C" || base === "POSIX") return undefined;
    try {
        return Intl.DateTimeFormat.supportedLocalesOf(base).length > 0 ? base : undefined;
    } catch {
        return undefined;
    }
}

export function localeFromEnv(env: Record<string, string | undefined>): string | undefined {
    for (const name of ENV_ORDER) {
        const tag = toLocaleTag(env[name]);
        if (tag !== undefined) return tag;
    }
    return undefined;
}

export function timeFormatter(locale?: string, timeZone?: string): FormatTime {
    const format = new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone });
    return (date) => format.format(date).replace(/[\u{202F}\u{00A0}]/gu, " ");
}
