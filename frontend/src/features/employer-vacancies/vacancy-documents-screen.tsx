"use client";

import { DraftEditErrorState } from "@/features/jobs/drafts/reopen/error-state";
import { VacancyDocumentsTab } from "@/features/vacancy-documents/ui/vacancy-documents-tab";
import { useVacancyIdentity } from "./use-vacancy-identity";
import { VacancyFrame } from "./vacancy-frame";

/** `/empresa/vacantes/[jobId]/documentos`: the vacancy frame with the Documentos tab current, and the documents table (artboard 03) in it. */
export function VacancyDocumentsScreen({ vacancyId }: { vacancyId: string }) {
  const { result, publication, retry } = useVacancyIdentity(vacancyId);
  const ok = result?.ok ? result : null;
  return (
    <VacancyFrame vacancyId={vacancyId} active="documentos" fallbackTitle="Documentos" loading={result === null}
      title={ok ? ok.seed.model.fields.title || "Sin título" : undefined} lifecycle={ok?.seed.lifecycle} publishedAt={publication?.publishedAt ?? null} showStatus={!!publication}
      tabs={result && !result.ok ? [] : undefined}>
      {result && !result.ok ? <DraftEditErrorState reason={result.reason} onRetry={retry} /> : <VacancyDocumentsTab draftId={vacancyId} />}
    </VacancyFrame>
  );
}
