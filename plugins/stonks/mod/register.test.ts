// Mod tests run under `claude plugin test plugins/stonks`, not Vitest
// (design D17): the kit mounts the pane through the engine's own host.
import { expect, test } from "claude-code/testing";

const PANE_PROPS = {
    title: "Stonks",
    isFocused: false,
    bodyColumns: 100,
    placement: "inline",
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
} as const;

test("the pane points at the markdown report while no report is loaded", async ($) => {
    const ui = await $.ui.mount({
        plugin: "stonks",
        surface: "terminal",
        component: "Pane",
        requestId: "stonks",
        props: PANE_PROPS,
    });
    expect(await ui.find({ type: "Text", text: /No report yet/ })).toBeDefined();
    await ui.unmount();
});
