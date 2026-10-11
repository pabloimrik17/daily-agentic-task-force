import { execCommand } from "../../exec.ts";
import type { WorkReader, WorkReaderFactory } from "../types.ts";
import { beadsWorkReader } from "./beads.ts";
import { githubWorkReader } from "./github.ts";
import { linearWorkReader } from "./linear.ts";

export const cliWork: WorkReaderFactory = (config) => {
    const readers: WorkReader[] = [];
    if (config.sources.beads.enabled)
        readers.push(beadsWorkReader(execCommand("bd"), config.sources.beads));
    if (config.sources.github.enabled)
        readers.push(githubWorkReader(execCommand("gh"), config.sources.github));
    if (config.sources.linear.enabled)
        readers.push(linearWorkReader(execCommand("linear"), config.sources.linear));
    return readers;
};
