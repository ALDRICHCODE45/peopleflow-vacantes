import "server-only";
import { boundedJson } from "@/features/candidate-cvs/bounded-body";
import { mediaErrorStatuses, uploadedMediaSchema, type MediaKind, type UploadedMedia } from "../media";
export type MediaBackendResult = { ok: true; data: UploadedMedia } | { ok: false; status: number; code: string };
/** Only a fresh server-session authorization header crosses this boundary. */
export async function uploadMediaFile(token: string, body: FormData, kind: MediaKind): Promise<MediaBackendResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { serverEnv } = await import("@/lib/env/server");
    timer = setTimeout(() => controller.abort(), serverEnv.apiTimeoutMs);
    const base = new URL(serverEnv.apiBaseUrl);
    const endpoint = new URL("/v2/me/company/site/media", base);
    // Only the configured server API origin and this literal endpoint are allowed.
    if (!["http:", "https:"].includes(base.protocol) || endpoint.origin !== base.origin || endpoint.pathname !== "/v2/me/company/site/media" || endpoint.username || endpoint.password) throw new Error("Invalid API endpoint");
    // Construct a fresh request after allowlisting; never inherit the browser Request.
    const response = await fetch(new Request(endpoint, {
      method: "POST", body, headers: new Headers({ authorization: `Bearer ${token}` }),
      cache: "no-store", redirect: "error", signal: controller.signal,
    }));
    if (response.status === 503) {
      void response.body?.cancel().catch(() => {});
      return { ok: false, status: 503, code: "unavailable" };
    }
    let value: unknown;
    try { value = await boundedJson(response, 4096, controller.signal); }
    catch { return { ok: false, status: controller.signal.aborted ? 503 : 502, code: controller.signal.aborted ? "no_response" : "unrecognized_response" }; }
    if (response.status === 201) {
      const parsed = uploadedMediaSchema.safeParse(value);
      if (parsed.success && parsed.data.kind === kind) return { ok: true, data: parsed.data };
    } else if (typeof value === "object" && value !== null && "code" in value && typeof value.code === "string" && mediaErrorStatuses[value.code] === response.status) {
      return { ok: false, status: response.status, code: value.code };
    }
    return { ok: false, status: 502, code: "unrecognized_response" };
  } catch { return { ok: false, status: 503, code: "no_response" }; }
  finally { if (timer) clearTimeout(timer); }
}
