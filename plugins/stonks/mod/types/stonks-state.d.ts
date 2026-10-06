// The pane's state contract (design D13, D17): the values the mod keeps in
// `$.state`, declared under the plugin's name so that `claude plugin validate`
// can hold every `$.state` key the module names to it. The report shapes
// mirror `src/domain.ts`; the mod cannot import that file at run time, so the
// subset it draws is restated here as types only.

export type PaneSeverity = "alert" | "discrepancy" | "warning" | "informational" | "not-evaluable";

export type PaneFinding = {
    check: string;
    ticker: string;
    sides: Record<string, string>;
    severity: PaneSeverity;
    affectsWatchlist: boolean;
    reason?: string;
    repeat?: number;
};

export type PaneMirror = "sws-portfolio" | "tracking-sheet" | "cartera-viva";

export type PaneSection = { mirror: PaneMirror; findings: PaneFinding[] };

export type PaneMovement = {
    kind: "fill" | "triggered-sell" | "new-order" | "cancelled-order";
    ticker: string;
    quantity: number;
    side: "buy" | "sell" | null;
};

export type PaneReport = {
    schema: string;
    runId: string;
    generatedAt: string;
    ibkr: { provenance: "mcp" | "screenshots"; positions: number; orders: number };
    counts: { swsPortfolio: number; carteraViva: number };
    warnings: string[];
    alerts: PaneFinding[];
    sections: PaneSection[];
    movements: { previousRunDate: string | null; items: PaneMovement[] };
    gate: { tripped: boolean; affectedTickers: string[] };
    links: Record<string, string>;
    snapshot: unknown;
};

export type PaneStatus = "idle" | "syncing" | "ready" | "error";

declare module "claude-code" {
    interface PluginState {
        stonks: {
            status: PaneStatus;
            report: PaneReport | null;
            /** Mirror → collapsed. */
            collapsed: Record<string, boolean>;
            /** Checklist item key → ticked. Session only, never stored. */
            ticks: Record<string, boolean>;
        };
    }
}
