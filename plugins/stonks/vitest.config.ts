import { defineConfig } from "vitest/config";

// The mod's tests run under `claude plugin test`, not Vitest (design D17).
export default defineConfig({
    test: {
        include: ["src/**/*.test.ts"],
        exclude: ["mod/**", "node_modules/**"],
    },
});
