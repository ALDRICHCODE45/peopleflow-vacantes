"use client";

import { DraftEditErrorState } from "@/features/jobs/drafts/reopen/error-state";
import { useVacancyIdentity } from "./use-vacancy-identity";
import { VacancyDocumentsPlaceholder } from "./vacancy-documents-placeholder";
import { VacancyFrame } from "./vacancy-frame";

/** `/empresa/vacantes/[jobId]/documentos`: the vacancy frame with the Documentos tab current. A later task replaces the placeholder. */
export function VacancyDocumentsScreen({ vacancyId }: { vacancyId: string }) {
  const { result, publication, retry } = useVacancyIdentity(vacancyId);
  const ok = result?.ok ? result : null;
  return (
    <VacancyFrame vacancyId={vacancyId} active="documentos" fallbackTitle="Documentos" loading={result === null}
      title={ok ? ok.seed.model.fields.title || "Sin título" : undefined} lifecycle={ok?.seed.lifecycle} publishedAt={publication?.publishedAt ?? null} showStatus={!!publication}
      tabs={result && !result.ok ? [] : undefined}>
      {result && !result.ok ? <DraftEditErrorState reason={result.reason} onRetry={retry} /> : <VacancyDocumentsPlaceholder />}
    </VacancyFrame>
  );
}
