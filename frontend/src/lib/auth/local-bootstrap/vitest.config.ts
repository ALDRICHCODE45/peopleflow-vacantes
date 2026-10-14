import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Standalone runner for the temporary local identity bootstrap.
 *
 * It mirrors the root Vitest config (jsdom, automatic JSX, `@`/`server-only`
 * aliases) but disables Vite's env-file loading, so the suite can never load a
 * real `.env`/`.env.local`. Tests must supply synthetic values through
 * `vi.stubEnv` or explicit env-object arguments.
 */
const frontendRoot = fileURLToPath(new URL("../../../../", import.meta.url));

export default defineConfig({
  root: frontendRoot,
  envDir: false,
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": resolve(frontendRoot, "src"),
      "server-only": resolve(
        frontendRoot,
        "node_modules/next/dist/compiled/server-only/empty.js",
      ),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
