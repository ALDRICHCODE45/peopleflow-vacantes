"use client";

import { useEffect, useState } from "react";
import { DraftEditErrorState } from "@/features/jobs/drafts/reopen/error-state";
import type { DraftEditFailureReason } from "@/features/jobs/drafts/reopen/load";
import { loadDraftPipelineAction, type DraftPipelineActionResult } from "@/features/jobs/drafts/pipeline/actions";
import { PipelineStageEditor } from "../stage-config/editor";
import { PipelineEditorSkeleton } from "../stage-config/loading";

function pipelineLoadReason(reason: string): DraftEditFailureReason {
  switch (reason) {
    case "unauthenticated": case "forbidden": case "not_found": case "company_inactive": case "company_not_active":
    case "no_response": case "server_error": case "unrecognized_response": return reason;
    default: return "unrecognized_response";
  }
}

/** The pipeline configuration is read only when this sub-module is mounted. */
export function VacancyColumnsModule({ draftId }: { draftId: string }) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ id: string; result: DraftPipelineActionResult } | null>(null);
  const result = loaded?.id === draftId ? loaded.result : null;
  useEffect(() => {
    let current = true;
    loadDraftPipelineAction(draftId).catch((): DraftPipelineActionResult => ({ ok: false, reason: "no_response", reference: {} })).then(result => {
      if (current) setLoaded({ id: draftId, result });
    });
    return () => { current = false; };
  }, [draftId, attempt]);
  const retry = () => { setLoaded(null); setAttempt(value => value + 1); };
  if (result === null) return <PipelineEditorSkeleton />;
  if (!result.ok) return <DraftEditErrorState reason={pipelineLoadReason(result.reason)} onRetry={retry} />;
  return <PipelineStageEditor key={draftId} draftId={draftId} pipeline={result.pipeline} etag={result.etag} />;
}
