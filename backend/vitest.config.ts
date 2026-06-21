import { defineConfig } from "vitest/config";
import { parse } from "dotenv";
import { readFileSync } from "fs";

let testEnv: Record<string, string> = {};
try {
  testEnv = parse(readFileSync(".env.test", "utf-8"));
} catch {
  // .env.test not found — env vars must be set externally
}

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./src/tests/setup.ts"],
    testTimeout: 10000,
    env: testEnv,
  },
});
