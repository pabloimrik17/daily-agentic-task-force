import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        projects: [
            {
                test: {
                    name: "scripts",
                    root: import.meta.dirname,
                    include: ["scripts/**/*.test.ts"],
                },
            },
            // Each plugin workspace is picked up as it gains code. Plugin code is
            // written in .ts so the default discovery glob covers it; .mjs is not
            // matched by default and would report green having executed nothing.
            "plugins/*",
        ],
    },
});
