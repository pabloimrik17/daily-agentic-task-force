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
            // Plugin code must be .ts: the default glob skips .mjs and would
            // report green having executed nothing.
            "plugins/*",
        ],
    },
});
