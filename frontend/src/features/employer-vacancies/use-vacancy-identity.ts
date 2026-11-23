"use client";

import { useEffect, useState } from "react";
import { loadDraftForEditAction, type DraftEditResult } from "@/features/jobs/drafts/reopen/load";
import { loadDraftPublicationAction } from "@/features/jobs/drafts/pipeline/publication-actions";
import type { DraftPublication } from "@/features/jobs/drafts/pipeline/publication-client";

/**
 * The same two reads the pipeline and configuration tabs make for the identity row (draft + publication), for tabs that have no
 * data of their own yet (Documentos). `result === null` while loading; a failed publication read leaves `publication` null.
 */
export function useVacancyIdentity(vacancyId: string) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ id: string; result: DraftEditResult; publication: DraftPublication | null } | null>(null);
  useEffect(() => {
    let current = true;
    Promise.all([
      loadDraftForEditAction(vacancyId).catch((): DraftEditResult => ({ ok: false, reason: "no_response" })),
      loadDraftPublicationAction(vacancyId).catch(() => null),
    ]).then(([result, publication]) => {
      if (current) setLoaded({ id: vacancyId, result, publication: publication?.ok ? publication.publication : null });
    });
    return () => { current = false; };
  }, [vacancyId, attempt]);
  const retry = () => { setLoaded(null); setAttempt(value => value + 1); };
  const own = loaded?.id === vacancyId ? loaded : null;
  return { result: own?.result ?? null, publication: own?.publication ?? null, retry };
}
