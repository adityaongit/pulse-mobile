import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    setupFiles: ["src/i18n/testSetup.ts"],
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    // The pipeline tests seed 180 days of 15-second heart rate and score them (halo's settings).
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
