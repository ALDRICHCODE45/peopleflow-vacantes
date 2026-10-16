"use client";

import { useEffect, useState } from "react";
import { DraftEditErrorState } from "@/features/jobs/drafts/reopen/error-state";
import type { DraftEditFailureReason } from "@/features/jobs/drafts/reopen/load";
import { loadDraftPipelineAction, type DraftPipelineActionResult } from "@/features/jobs/drafts/pipeline/actions";
import { loadDraftSubstatesAction, type DraftSubstatesActionResult } from "@/features/jobs/drafts/pipeline/substates-actions";
import { PipelineStageEditor } from "../stage-config/editor";
import { PipelineEditorSkeleton } from "../stage-config/loading";

export function pipelineLoadReason(reason: string): DraftEditFailureReason {
  switch (reason) {
    case "unauthenticated": case "forbidden": case "not_found": case "company_inactive": case "company_not_active":
    case "no_response": case "server_error": case "unrecognized_response": return reason;
    default: return "unrecognized_response";
  }
}

/** The pipeline configuration is read only when this sub-module is mounted. */
export function VacancyColumnsModule({ draftId }: { draftId: string }) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ id: string; pipeline: DraftPipelineActionResult; substates: DraftSubstatesActionResult } | null>(null);
  const result = loaded?.id === draftId ? loaded : null;
  useEffect(() => {
    let current = true;
    Promise.all([
      loadDraftPipelineAction(draftId).catch((): DraftPipelineActionResult => ({ ok: false, reason: "no_response", reference: {} })),
      loadDraftSubstatesAction(draftId).catch((): DraftSubstatesActionResult => ({ ok: false, reason: "no_response", reference: {} })),
    ]).then(([pipeline, substates]) => {
      if (current) setLoaded({ id: draftId, pipeline, substates });
    });
    return () => { current = false; };
  }, [draftId, attempt]);
  const retry = () => { setLoaded(null); setAttempt(value => value + 1); };
  if (result === null) return <PipelineEditorSkeleton />;
  if (!result.pipeline.ok) return <DraftEditErrorState reason={pipelineLoadReason(result.pipeline.reason)} onRetry={retry} />;
  if (!result.substates.ok) return <DraftEditErrorState reason={pipelineLoadReason(result.substates.reason)} onRetry={retry} />;
  return <PipelineStageEditor key={draftId} draftId={draftId} pipeline={result.pipeline.pipeline} etag={result.pipeline.etag}
    substates={result.substates.catalog} substatesEtag={result.substates.etag} />;
}
