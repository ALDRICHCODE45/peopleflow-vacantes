"use server";

import { getActionAccessToken } from "@/lib/auth/action-session";
import { mapDraftPipelineFailure, type DraftPipelineActionFailure } from "./failure";
import {
  getDraftPipeline,
  previewPipeline,
  type PipelineImpactPreview,
  saveDraftPipeline,
  type DraftPipeline,
  type SaveDraftPipelineInput,
} from "./client";

export type { DraftPipelineActionFailure } from "./failure";
export type DraftPipelineActionResult =
  | { ok: true; pipeline: DraftPipeline; etag: string }
  | DraftPipelineActionFailure;

export type PipelinePreviewActionResult = { ok: true; preview: PipelineImpactPreview } | DraftPipelineActionFailure;

export async function previewPipelineAction(input: { draftId: string; body: unknown }): Promise<PipelinePreviewActionResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return { ok: false, reason: "unauthenticated", reference: {} };
    const result = await previewPipeline({ ...input, token });
    return result.ok ? { ok: true, preview: result.data } : mapDraftPipelineFailure(result);
  } catch {
    return { ok: false, reason: "no_response", reference: {} };
  }
}

export async function loadDraftPipelineAction(draftId: string): Promise<DraftPipelineActionResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return { ok: false, reason: "unauthenticated", reference: {} };
    const result = await getDraftPipeline({ token, draftId });
    return result.ok ? { ok: true, pipeline: result.data, etag: result.etag } : mapDraftPipelineFailure(result);
  } catch {
    return { ok: false, reason: "no_response", reference: {} };
  }
}

export async function saveDraftPipelineAction(input: Omit<SaveDraftPipelineInput, "token">): Promise<DraftPipelineActionResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return { ok: false, reason: "unauthenticated", reference: {} };
    const result = await saveDraftPipeline({ ...input, token });
    return result.ok ? { ok: true, pipeline: result.data, etag: result.etag } : mapDraftPipelineFailure(result);
  } catch {
    // The request may have reached the API. Never retry implicitly.
    return { ok: false, reason: "no_response", reference: {} };
  }
}
