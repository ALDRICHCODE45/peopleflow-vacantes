"use client";
import { useEffect, useState } from "react";
import { loadChecklistAction } from "@/features/vacancy-checklist/actions";
import type { Checklist, Result } from "@/features/vacancy-checklist/model";
import { ChecklistEditor } from "@/features/vacancy-checklist/editor/editor";
import { ChecklistSkeleton } from "@/features/vacancy-checklist/editor/loading";
import { loadDraftForEditAction, type DraftEditResult } from "@/features/jobs/drafts/reopen/load";
import { DraftEditErrorState } from "@/features/jobs/drafts/reopen/error-state";
import { loadDraftPipelineAction, type DraftPipelineActionResult } from "@/features/jobs/drafts/pipeline/actions";
import { useLanguageCatalog } from "@/features/languages/use-language-catalog";
import { pipelineLoadReason } from "./columns-module";
/** Same mounted-client loading boundary as Columns, Delivery and Management. */
export function VacancyChecklistModule({ draftId }: { draftId: string }) {
  const languages = useLanguageCatalog();
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ id: string; checklist: Result<Checklist>; draft: DraftEditResult; pipeline: DraftPipelineActionResult } | null>(null);
  const result = loaded?.id === draftId ? loaded : null;
  useEffect(() => {
    let current = true;
    Promise.all([
      loadChecklistAction(draftId).catch((): Result<Checklist> => ({ ok: false, reason: "no_response", reference: {} })),
      loadDraftForEditAction(draftId).catch((): DraftEditResult => ({ ok: false, reason: "no_response" })),
      loadDraftPipelineAction(draftId).catch((): DraftPipelineActionResult => ({ ok: false, reason: "no_response", reference: {} })),
    ]).then(([checklist, draft, pipeline]) => { if (current) setLoaded({ id: draftId, checklist, draft, pipeline }); });
    return () => { current = false; };
  }, [draftId, attempt]);
  const retry = () => { setLoaded(null); setAttempt(value => value + 1); };
  if (!result) return <ChecklistSkeleton />;
  if (!result.checklist.ok) return <DraftEditErrorState reason={pipelineLoadReason(result.checklist.reason)} onRetry={retry} />;
  if (!result.checklist.etag) return <DraftEditErrorState reason="unrecognized_response" onRetry={retry} />;
  if (!result.draft.ok) return <DraftEditErrorState reason={result.draft.reason} onRetry={retry} />;
  if (!result.pipeline.ok) return <DraftEditErrorState reason={pipelineLoadReason(result.pipeline.reason)} onRetry={retry} />;
  if (languages.status === "idle" || languages.status === "loading") return <ChecklistSkeleton />;
  if (languages.status === "error") return <DraftEditErrorState reason="no_response" onRetry={languages.retry} />;
  return <ChecklistEditor languageName={code => languages.data?.items.find(item => item.code === code)?.name ?? code} key={draftId} draftId={draftId} checklist={result.checklist.data} etag={result.checklist.etag} stages={result.pipeline.pipeline.stages} lifecycle={result.pipeline.pipeline.lifecycle ?? result.draft.seed.lifecycle} fields={{ ...result.draft.seed.model.fields, location: result.draft.seed.model.locationRead ?? result.draft.seed.model.fields.location }} questions={result.draft.seed.screeningQuestionsV2} />;
}
