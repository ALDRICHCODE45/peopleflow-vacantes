"use client";

import { useEffect, useState } from "react";
import { loadDraftForEditAction, type DraftEditResult } from "@/features/jobs/drafts/reopen/load";
import { loadDraftPublicationAction } from "@/features/jobs/drafts/pipeline/publication-actions";
import type { DraftPublication } from "@/features/jobs/drafts/pipeline/publication-client";
import { listDraftsAction } from "@/features/jobs/drafts/list/actions";
import type { CloseCoverage } from "@/features/vacancy-lifecycle/model";

/**
 * The live coverage the identity row needs to word a «filled» close («Cubierta» vs «Cubierta al cierre»). Only the pipeline's board
 * carries it; the other tabs read it from the draft list row of this process (the same `coverage` as the board's), asking for the
 * vacancy's own chain only (`root_process_id`) and only when the answer matters: a closed vacancy whose reason is «filled».
 * Any failure leaves it `undefined` (the plain label), so the identity row never blocks on it.
 */
export async function readClosedCoverage(vacancyId: string, result: DraftEditResult): Promise<CloseCoverage | undefined> {
  if (!result.ok) return undefined;
  const { lifecycle } = result.seed;
  if (lifecycle.publication !== "closed" || lifecycle.close_reason !== "filled" || !lifecycle.root_process_id) return undefined;
  try {
    const rows = await listDraftsAction({ limit: 50, rootProcessId: lifecycle.root_process_id });
    const coverage = rows.ok ? rows.items.find(row => row.id === vacancyId)?.coverage : undefined;
    return coverage ?? undefined;
  } catch { return undefined; }
}

/**
 * The same two reads the pipeline and configuration tabs make for the identity row (draft + publication), for tabs that have no
 * data of their own yet (Documentos). `result === null` while loading; a failed publication read leaves `publication` null.
 */
export function useVacancyIdentity(vacancyId: string) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ id: string; result: DraftEditResult; publication: DraftPublication | null; coverage?: CloseCoverage } | null>(null);
  useEffect(() => {
    let current = true;
    Promise.all([
      loadDraftForEditAction(vacancyId).catch((): DraftEditResult => ({ ok: false, reason: "no_response" })),
      loadDraftPublicationAction(vacancyId).catch(() => null),
    ]).then(async ([result, publication]) => {
      const coverage = await readClosedCoverage(vacancyId, result);
      if (current) setLoaded({ id: vacancyId, result, publication: publication?.ok ? publication.publication : null, ...(coverage ? { coverage } : {}) });
    });
    return () => { current = false; };
  }, [vacancyId, attempt]);
  const retry = () => { setLoaded(null); setAttempt(value => value + 1); };
  const own = loaded?.id === vacancyId ? loaded : null;
  return { result: own?.result ?? null, publication: own?.publication ?? null, coverage: own?.coverage, retry };
}
