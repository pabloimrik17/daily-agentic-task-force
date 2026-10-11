import { expect, it } from "vitest";
import { config as exampleConfig } from "../../label-triage/test-fixtures.ts";
import { cliWork } from "./cli.ts";

it("builds only enabled readers in beads, github, linear order", () => {
    const config = exampleConfig();
    config.sources.beads.enabled = true;
    config.sources.github.enabled = true;
    config.sources.linear.enabled = true;
    expect(cliWork(config).map((reader) => reader.source)).toEqual(["beads", "github", "linear"]);
    config.sources.github.enabled = false;
    expect(cliWork(config).map((reader) => reader.source)).toEqual(["beads", "linear"]);
});
