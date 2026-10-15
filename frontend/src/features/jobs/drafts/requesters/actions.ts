"use server";

import { getActionAccessToken } from "@/lib/auth/action-session";
import {
  listRequesters, createRequester,
  type Requester, type RequesterFailure, type RequesterKind,
} from "./client";

export type RequesterActionFailure = {
  ok: false;
  reason: "unauthenticated" | "forbidden" | "company_inactive" | "company_not_active" |
    "invalid_name" | "already_exists" | "server_error" | "no_response" | "unrecognized_response";
  message?: string;
  existing?: Requester;
  reference: { status?: number; code?: string };
};
export type SearchRequestersResult =
  | { ok: true; items: Requester[]; nextCursor: string | null }
  | RequesterActionFailure;
export type CreateRequesterResult =
  | { ok: true; requester: Requester }
  | RequesterActionFailure;

const invalidName = "Escribe un nombre de hasta 160 caracteres, sin caracteres de control.";

/** Never expose backend error text or credentials to the browser. */
function failure({ error, envelope }: RequesterFailure): RequesterActionFailure {
  const status = "status" in error ? error.status : undefined;
  const code = envelope?.code;
  let reason: RequesterActionFailure["reason"] = "unrecognized_response";
  if (error.kind === "missing_token" || status === 401) reason = "unauthenticated";
  else if (error.kind === "invalid_name" || (status === 400 && code === "validation_error")) reason = "invalid_name";
  else if (error.kind === "network" || error.kind === "timeout") reason = "no_response";
  else if (status === 403) reason = code === "company_inactive" ? "company_inactive" : "forbidden";
  else if (status === 409 && code === "company_not_active") reason = "company_not_active";
  else if (status === 409 && code === "requester_already_exists" && envelope?.data) reason = "already_exists";
  else if (status && status >= 500 && status < 600) reason = "server_error";
  return {
    ok: false,
    reason,
    reference: { ...(status !== undefined ? { status } : {}), ...(code ? { code } : {}) },
    ...(reason === "invalid_name" ? { message: invalidName } : {}),
    ...(reason === "already_exists" ? { existing: envelope?.data?.existing } : {}),
  };
}

export async function searchRequestersAction(
  input: { kind: RequesterKind; q: string; cursor?: string },
): Promise<SearchRequestersResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return { ok: false, reason: "unauthenticated", reference: {} };
    const result = await listRequesters({ token, kind: input.kind, q: input.q, cursor: input.cursor });
    return result.ok
      ? { ok: true, items: result.data.items, nextCursor: result.data.next_cursor }
      : failure(result);
  } catch {
    return { ok: false, reason: "no_response", reference: {} };
  }
}

/** One explicit mutation; an uncertain create is never retried here. */
export async function createRequesterAction(
  input: { kind: RequesterKind; name: string },
): Promise<CreateRequesterResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return { ok: false, reason: "unauthenticated", reference: {} };
    const result = await createRequester({ token, kind: input.kind, name: input.name });
    return result.ok ? { ok: true, requester: result.data } : failure(result);
  } catch {
    return { ok: false, reason: "no_response", reference: {} };
  }
}
