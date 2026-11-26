import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Automatic JSX runtime: unchanged CLI primitives carry no React import,
  // which the classic runtime would require in test-environment transforms.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Next supplies this sentinel through its bundler; unit tests use its
      // empty server entry without changing application boundary enforcement.
      "server-only": fileURLToPath(new URL("./node_modules/next/dist/compiled/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    // Careers sections v2 is on by default in the app; unit tests pin the pre-v2 behaviour
    // unless a test turns it on (src/features/company-site/sections-v2.ts).
    env: { NEXT_PUBLIC_CAREERS_SECTIONS_V2: "false" },
  },
});
