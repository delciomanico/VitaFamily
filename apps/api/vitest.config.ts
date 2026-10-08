import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts", "db/**/*.test.ts"],
    // Testes de integração (testcontainers) demoram a arrancar um Postgres real.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
