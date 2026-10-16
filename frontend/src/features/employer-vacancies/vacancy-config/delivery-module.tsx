"use client";

import { useEffect, useState } from "react";
import { DraftEditErrorState } from "@/features/jobs/drafts/reopen/error-state";
import { loadDraftPipelineAction, type DraftPipelineActionResult } from "@/features/jobs/drafts/pipeline/actions";
import { loadDraftDeliveryAction, type DraftDeliveryActionResult } from "@/features/jobs/drafts/pipeline/delivery-actions";
import { DeliveryEditor } from "../delivery-config/editor";
import { DeliverySkeleton } from "../delivery-config/loading";
import { pipelineLoadReason } from "./columns-module";

export function VacancyDeliveryModule({ draftId }: { draftId: string }) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ id: string; pipeline: DraftPipelineActionResult; delivery: DraftDeliveryActionResult } | null>(null);
  const result = loaded?.id === draftId ? loaded : null;
  useEffect(() => {
    let current = true;
    Promise.all([
      loadDraftPipelineAction(draftId).catch((): DraftPipelineActionResult => ({ ok: false, reason: "no_response", reference: {} })),
      loadDraftDeliveryAction(draftId).catch((): DraftDeliveryActionResult => ({ ok: false, reason: "no_response", reference: {} })),
    ]).then(([pipeline, delivery]) => { if (current) setLoaded({ id: draftId, pipeline, delivery }); });
    return () => { current = false; };
  }, [draftId, attempt]);
  const retry = () => { setLoaded(null); setAttempt(value => value + 1); };
  if (result === null) return <DeliverySkeleton />;
  if (!result.pipeline.ok) return <DraftEditErrorState reason={pipelineLoadReason(result.pipeline.reason)} onRetry={retry} />;
  if (!result.delivery.ok) return <DraftEditErrorState reason={pipelineLoadReason(result.delivery.reason)} onRetry={retry} />;
  return <DeliveryEditor key={draftId} draftId={draftId} delivery={result.delivery.delivery} etag={result.delivery.etag} stages={result.pipeline.pipeline.stages} />;
}
