// Live probe runner: loads .env.local (never committed) and runs scripts/*.live.ts against the real Qloo API.
// Usage: npx vitest run --config scripts/vitest.live.config.mts [-- step]
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
  test: {
    include: ["scripts/**/*.live.ts"],
    environment: "node",
    env: { ...loadEnv("", fileURLToPath(new URL("..", import.meta.url)), ""), QLOO_FIXTURES: "0" },
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
