"use client";
import { useEffect, useState } from "react";
import { loadProfileAction } from "../actions";
import type { Profile, Result } from "../model";
import { loadDraftPipelineAction, type DraftPipelineActionResult } from "@/features/jobs/drafts/pipeline/actions";
import { DraftEditErrorState } from "@/features/jobs/drafts/reopen/error-state";
import { pipelineLoadReason } from "@/features/employer-vacancies/vacancy-config/columns-module";
import { ConfigLifecycleProvider } from "@/features/employer-vacancies/vacancy-config/lifecycle";
import { ProfileEditor } from "./editor";
import { ProfileSkeleton } from "./loading";

/** The pipeline's stages collection contains only current progression stages; exit/retired are separate. */
export function VacancyPsychometricsModule({ draftId }: { draftId: string }) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ id: string; profile: Result<Profile>; pipeline: DraftPipelineActionResult } | null>(null);
  const result = loaded?.id === draftId ? loaded : null;
  useEffect(() => {
    let current = true;
    Promise.all([
      loadProfileAction(draftId).catch((): Result<Profile> => ({ ok: false, reason: "no_response", reference: {} })),
      loadDraftPipelineAction(draftId).catch((): DraftPipelineActionResult => ({ ok: false, reason: "no_response", reference: {} })),
    ]).then(([profile, pipeline]) => { if (current) setLoaded({ id: draftId, profile, pipeline }); });
    return () => { current = false; };
  }, [draftId, attempt]);
  const retry = () => { setLoaded(null); setAttempt(value => value + 1); };
  if (!result) return <ProfileSkeleton />;
  if (!result.profile.ok) return <DraftEditErrorState reason={pipelineLoadReason(result.profile.reason)} onRetry={retry} />;
  if (!result.profile.etag) return <DraftEditErrorState reason="unrecognized_response" onRetry={retry} />;
  if (!result.pipeline.ok) return <DraftEditErrorState reason={pipelineLoadReason(result.pipeline.reason)} onRetry={retry} />;
  const editor = <ProfileEditor key={draftId} draftId={draftId} profile={result.profile.data} etag={result.profile.etag} stages={result.pipeline.pipeline.stages} />;
  return result.pipeline.pipeline.lifecycle ? <ConfigLifecycleProvider lifecycle={result.pipeline.pipeline.lifecycle}>{editor}</ConfigLifecycleProvider> : editor;
}
