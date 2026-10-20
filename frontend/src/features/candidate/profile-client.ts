import "server-only";
import { requestJson } from "@/lib/api/server";
import { languagesSchema, profileErrorSchema, profileFailure, profileReadSchema, profileWriteSchema, type ProfileLanguages, type ProfileRead, type ProfileResult } from "./profile-api";

function usableToken(token: unknown): token is string { return typeof token === "string" && token.length > 0 && !/\s/.test(token); }
async function request<T>(token: string, path: "/me/profile/" | "/me/profile/languages/", method: "GET" | "PUT", decoder: (body: unknown) => T, body?: unknown): Promise<ProfileResult<T>> {
  if (!usableToken(token)) return profileFailure({ error: { kind: "missing_token" } });
  const { serverEnv } = await import("@/lib/env/server");
  const result = await requestJson(new URL(path, serverEnv.apiBaseUrl).toString(), {
    method, ...(body === undefined ? {} : { body }), expectedStatus: 200, redirect: "error",
    headers: { authorization: `Bearer ${token}` }, timeoutMs: serverEnv.apiTimeoutMs,
    decoder, errorDecoder: value => profileErrorSchema.parse(value), maxErrorBodyBytes: 4096,
  });
  return result.ok ? { ok: true, data: result.data } : profileFailure(result);
}
export function getProfile({ token }: { token: string }): Promise<ProfileResult<ProfileRead>> {
  return request(token, "/me/profile/", "GET", value => profileReadSchema.parse(value));
}
export async function putProfile({ token, body }: { token: string; body: unknown }): Promise<ProfileResult<ProfileRead>> {
  const parsed = profileWriteSchema.safeParse(body);
  if (!parsed.success) return profileFailure({ error: { kind: "invalid_request" } });
  return request(token, "/me/profile/", "PUT", value => profileReadSchema.parse(value), parsed.data);
}
export function getProfileLanguages({ token }: { token: string }): Promise<ProfileResult<ProfileLanguages>> {
  return request(token, "/me/profile/languages/", "GET", value => languagesSchema.parse(value));
}
export async function putProfileLanguages({ token, body }: { token: string; body: unknown }): Promise<ProfileResult<ProfileLanguages>> {
  const parsed = languagesSchema.safeParse(body);
  if (!parsed.success) return profileFailure({ error: { kind: "invalid_request" } });
  return request(token, "/me/profile/languages/", "PUT", value => languagesSchema.parse(value), parsed.data);
}
