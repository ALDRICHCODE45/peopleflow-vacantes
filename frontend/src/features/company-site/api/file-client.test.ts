// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { uploadMediaFile } from "./file-client";
import { mediaMessage } from "../media";

vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080", apiTimeoutMs: 8000 } }));
afterEach(() => vi.unstubAllGlobals());

it("preserves the upload route's existing unauthenticated status/code and session copy", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "private-token", code: "unauthenticated" }, { status: 401 })));
  const result = await uploadMediaFile("private-token", new FormData(), "cover");
  expect(result).toEqual({ ok: false, status: 401, code: "unauthenticated" });
  expect(JSON.stringify(result)).not.toContain("private-token");
  expect(mediaMessage(401, result)).toBe("Inicia sesión para subir imágenes.");
  expect(fetch).toHaveBeenCalledOnce();
});
