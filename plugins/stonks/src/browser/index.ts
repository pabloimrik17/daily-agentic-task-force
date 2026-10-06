// Registries behind the CLI steps `collector <name>` and `action <name> <args…>`
// (design D10): each prints the JavaScript for Claude to pass to
// `javascript_tool` unchanged.

import { carteraVivaCollector } from "./cartera-viva.ts";
import {
    clickRowAction,
    dropdownCollector,
    expandListingsAction,
    repositionAddPanelAction,
} from "./dropdown.ts";
import { swsPortfolioCollector } from "./sws-portfolio.ts";
import { removeFromMenuAction, watchlistCollector, watchlistRowMenuAction } from "./watchlist.ts";

type Source = (runId: string, args: string[]) => string;

export type SourceResult = { ok: true; source: string } | { ok: false; error: string };

/** A row index and what the engine expects that row to show, so the action can refuse another row. */
function rowArgs(name: string, expected: string, args: string[]): [number, string] {
    const [index = "", shown = ""] = args;
    if (args.length !== 2 || !/^\d+$/.test(index) || shown.trim() === "") {
        throw new Error(`action ${name} takes a row index and the row's ${expected}`);
    }
    return [Number(index), shown];
}

export const COLLECTORS: Record<string, Source> = {
    "sws-portfolio": (runId) => swsPortfolioCollector(runId),
    watchlist: (runId) => watchlistCollector(runId),
    "cartera-viva": (runId) => carteraVivaCollector(runId),
    dropdown: (runId) => dropdownCollector(runId),
};

export const ACTIONS: Record<string, Source> = {
    "watchlist-row-menu": (runId, args) =>
        watchlistRowMenuAction(runId, ...rowArgs("watchlist-row-menu", "link path", args)),
    "remove-from-menu": (runId) => removeFromMenuAction(runId),
    "reposition-add-panel": (runId) => repositionAddPanelAction(runId),
    "expand-listings": (runId) => expandListingsAction(runId),
    "click-row": (runId, args) => clickRowAction(runId, ...rowArgs("click-row", "listing", args)),
};

function lookup(
    kind: string,
    registry: Record<string, Source>,
    name: string,
    runId: string,
    args: string[],
): SourceResult {
    if (!Object.hasOwn(registry, name)) {
        return {
            ok: false,
            error: `unknown ${kind} "${name}"; known: ${Object.keys(registry).join(", ")}`,
        };
    }
    try {
        return { ok: true, source: (registry[name] as Source)(runId, args) };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}

export function collectorSource(name: string, runId: string): SourceResult {
    return lookup("collector", COLLECTORS, name, runId, []);
}

export function actionSource(name: string, runId: string, args: string[]): SourceResult {
    return lookup("action", ACTIONS, name, runId, args);
}
