"use client";

import { useEffect, useState } from "react";
import { DraftEditErrorState } from "@/features/jobs/drafts/reopen/error-state";
import { loadDraftManagementAction, type DraftManagementActionResult } from "@/features/jobs/drafts/pipeline/management-actions";
import { ManagementEditor } from "../management-config/editor";
import { ManagementSkeleton } from "../management-config/loading";
import { pipelineLoadReason } from "./columns-module";

export function VacancyManagementModule({ draftId }: { draftId: string }) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ id: string; management: DraftManagementActionResult } | null>(null);
  const result = loaded?.id === draftId ? loaded.management : null;
  useEffect(() => {
    let current = true;
    loadDraftManagementAction(draftId).catch((): DraftManagementActionResult => ({ ok: false, reason: "no_response", reference: {} }))
      .then(management => { if (current) setLoaded({ id: draftId, management }); });
    return () => { current = false; };
  }, [draftId, attempt]);
  const retry = () => { setLoaded(null); setAttempt(value => value + 1); };
  if (result === null) return <ManagementSkeleton />;
  if (!result.ok) return <DraftEditErrorState reason={pipelineLoadReason(result.reason)} onRetry={retry} />;
  return <ManagementEditor key={draftId} draftId={draftId} management={result.management} etag={result.etag} />;
}
