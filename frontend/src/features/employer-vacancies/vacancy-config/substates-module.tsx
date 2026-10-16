"use client";

import { useEffect, useState } from "react";
import { DraftEditErrorState } from "@/features/jobs/drafts/reopen/error-state";
import { loadDraftPipelineAction, type DraftPipelineActionResult } from "@/features/jobs/drafts/pipeline/actions";
import { loadDraftSubstatesAction, type DraftSubstatesActionResult } from "@/features/jobs/drafts/pipeline/substates-actions";
import { SubstatesEditor } from "../substates-config/editor";
import { SubstatesEditorSkeleton } from "../substates-config/loading";
import { pipelineLoadReason } from "./columns-module";

type Loaded = { id: string; pipeline: DraftPipelineActionResult; substates: DraftSubstatesActionResult };
const noResponse = () => ({ ok: false, reason: "no_response", reference: {} } as const);

/** The semantic column name and independently versioned catalog are read in parallel. */
export function VacancySubstatesModule({ draftId }: { draftId: string }) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const result = loaded?.id === draftId ? loaded : null;
  useEffect(() => {
    let current = true;
    Promise.all([loadDraftPipelineAction(draftId).catch(noResponse), loadDraftSubstatesAction(draftId).catch(noResponse)]).then(([pipeline, substates]) => {
      if (current) setLoaded({ id: draftId, pipeline, substates });
    });
    return () => { current = false; };
  }, [draftId, attempt]);
  const retry = () => { setLoaded(null); setAttempt(value => value + 1); };
  if (!result) return <SubstatesEditorSkeleton />;
  if (!result.pipeline.ok) return <DraftEditErrorState reason={pipelineLoadReason(result.pipeline.reason)} onRetry={retry} />;
  if (!result.substates.ok) return <DraftEditErrorState reason={pipelineLoadReason(result.substates.reason)} onRetry={retry} />;
  const inProcess = result.pipeline.pipeline.stages.find(stage => stage.kind === "in_process");
  if (!inProcess) return <DraftEditErrorState reason="unrecognized_response" onRetry={retry} />;
  return <SubstatesEditor key={draftId} draftId={draftId} inProcessName={inProcess.name} catalog={result.substates.catalog} etag={result.substates.etag} />;
}
