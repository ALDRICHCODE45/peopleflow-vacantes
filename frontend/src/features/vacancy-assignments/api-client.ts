import "server-only";
import { z } from "zod";
import { requestJson } from "@/lib/api/server";
import { historySchema, type ReadResult } from "./client";

const envelope = z.object({ code: z.string(), error: z.string().optional() });
export async function getHistory(input: { token: string; cursor?: string }): Promise<ReadResult> {
  if (!input.token?.trim()) return { ok: false, code: "unauthenticated", status: 401 };
  const { serverEnv } = await import("@/lib/env/server");
  const query = input.cursor === undefined ? "" : `?${new URLSearchParams({ cursor: input.cursor })}`;
  const result = await requestJson(new URL(`/v2/me/vacancy-assignments/history${query}`, serverEnv.apiBaseUrl).toString(), {
    method: "GET", headers: { authorization: `Bearer ${input.token.trim()}` }, redirect: "error", expectedStatus: 200,
    timeoutMs: serverEnv.apiTimeoutMs, maxErrorBodyBytes: 8192,
    decoder: value => historySchema.parse(value), errorDecoder: value => envelope.parse(value),
  });
  if (result.ok) return { ok: true, data: result.data };
  const status = "status" in result.error ? result.error.status : undefined;
  return { ok: false, code: status === 401 ? "unauthenticated" : status === 400 && result.envelope?.code === "invalid_cursor" ? "invalid_cursor" : "read_failed", ...(status === undefined ? {} : { status }) };
}
