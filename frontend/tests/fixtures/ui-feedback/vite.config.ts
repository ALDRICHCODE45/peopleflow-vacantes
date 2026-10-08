import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: { alias: { "@": fileURLToPath(new URL("../../../src", import.meta.url)) } },
  esbuild: { jsx: "automatic" },
  css: { postcss: fileURLToPath(new URL("../../../", import.meta.url)) },
  server: { host: "127.0.0.1", port: 3187, strictPort: true },
});
