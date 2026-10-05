// Dropdown parser (design D11 step 4): every row of the "Add stock" search
// results with its exchange-qualified listing, or null when the row shows
// none. Choosing the row is the watchlist module's job.

import type { DropdownRow } from "../domain.ts";
import { parseListing } from "../ticker.ts";
import { array, number, object, string } from "../validate.ts";
import { guard, type ReadResult, validateEnvelope } from "./envelope.ts";

export function parseDropdown(envelope: unknown, runId: string): ReadResult<DropdownRow[]> {
    const checked = validateEnvelope(envelope, "dropdown", runId);
    if (!checked.ok) {
        return checked;
    }
    return guard(() => {
        const rows = array(checked.value.data.rows, "dropdown.data.rows").map((raw, position) => {
            const path = `dropdown.data.rows[${position}]`;
            const row = object(raw, path);
            const symbol = typeof row.symbol === "string" ? row.symbol : null;
            return {
                index: number(row, "index", path),
                label: string(row, "label", path),
                listing: symbol === null ? null : parseListing(symbol),
            };
        });
        return { ok: true, value: rows };
    });
}
