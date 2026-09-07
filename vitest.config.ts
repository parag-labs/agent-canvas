import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The engine is pure TypeScript with no DOM, so a node environment is right and fast.
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
  },
});
