"use server";

import { getActionAccessToken } from "@/lib/auth/action-session";
import { isValidJobId } from "../../jobId";
import { getDraftV2, type DraftV2Failure } from "../api/client-v2";
import { draftEditSeedFromRead } from "./seed";

export type DraftEditFailureReason = "invalid_id" | "not_found" | "unauthenticated" | "forbidden" | "company_inactive" | "company_not_active" | "server_error" | "no_response" | "unrecognized_response";
export type DraftEditResult =
  | { ok: true; seed: ReturnType<typeof draftEditSeedFromRead>; identity: { draftId: string; etag: string } }
  | { ok: false; reason: DraftEditFailureReason };

function failureReason({error, envelope}: DraftV2Failure): DraftEditFailureReason {
  if (error.kind === "missing_token") return "unauthenticated";
  if (error.kind === "network" || error.kind === "timeout") return "no_response";
  if (error.kind === "not_found") return "not_found";
  if (error.kind === "status") {
    if (error.status === 404) return "not_found"; // Includes drafts invisible to this recruiter.
    if (error.status === 401) return "unauthenticated";
    if (error.status >= 500) return "server_error";
    if (error.status === 403 && envelope?.code === "forbidden") return "forbidden";
    if (error.status === 403 && envelope?.code === "company_inactive") return "company_inactive";
    if (error.status === 409 && envelope?.code === "company_not_active") return "company_not_active";
  }
  return "unrecognized_response";
}

/**
 * Called by the mounted client loader so getActionAccessToken can persist
 * refreshed session cookies on the action response. Credentials never cross
 * this boundary. getDraftV2 owns strict envelope/id/ETag decoding and no-store.
 */
export async function loadDraftForEditAction(id: string): Promise<DraftEditResult> {
  if (!isValidJobId(id)) return {ok:false,reason:"invalid_id"};
  let response: Awaited<ReturnType<typeof getDraftV2>>;
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return {ok:false,reason:"unauthenticated"};
    response = await getDraftV2({id,token});
  } catch {
    return {ok:false,reason:"no_response"};
  }
  if (!response.ok) return {ok:false,reason:failureReason(response)};
  try {
    return {ok:true,seed:draftEditSeedFromRead(response.data),identity:{draftId:response.data.id,etag:response.etag}};
  } catch {
    return {ok:false,reason:"unrecognized_response"};
  }
}
