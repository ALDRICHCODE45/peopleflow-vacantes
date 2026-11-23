"use client";

import { useCallback, useState } from "react";
import { Lock } from "lucide-react";
import { useCompanyMembershipState } from "@/features/employer-company/company-membership-context";
import { DraftEditErrorState } from "@/features/jobs/drafts/reopen/error-state";
import type { DocumentOverview } from "@/features/vacancy-documents/model";
import { VacancyDocumentsTab } from "@/features/vacancy-documents/ui/vacancy-documents-tab";
import { useVacancyIdentity } from "./use-vacancy-identity";
import { VacancyFrame } from "./vacancy-frame";

/** `/empresa/vacantes/[jobId]/documentos`: the vacancy frame with the Documentos tab current, and the documents table (artboard 03) in it. */
export function VacancyDocumentsScreen({ vacancyId }: { vacancyId: string }) {
  const shared = useCompanyMembershipState();
  const membership = shared?.state?.kind === "exists" ? shared.state : null;
  // Inside the employer frame the guard keeps the page unmounted until the membership is known; a screen mounted while it is still
  // being read makes no read at all, because the recruiter-only ones would answer 403 to a stakeholder.
  if (shared && shared.userId !== null && shared.state === null) return <VacancyFrame vacancyId={vacancyId} active="documentos" fallbackTitle="Documentos" loading tabs={[]}>{null}</VacancyFrame>;
  return membership?.role === "stakeholder" ? <StakeholderDocumentsScreen vacancyId={vacancyId} /> : <EmployerDocumentsScreen vacancyId={vacancyId} />;
}

function EmployerDocumentsScreen({ vacancyId }: { vacancyId: string }) {
  const { result, publication, coverage, retry } = useVacancyIdentity(vacancyId);
  const ok = result?.ok ? result : null;
  return (
    <VacancyFrame vacancyId={vacancyId} active="documentos" fallbackTitle="Documentos" loading={result === null}
      title={ok ? ok.seed.model.fields.title || "Sin título" : undefined} lifecycle={ok?.seed.lifecycle} publishedAt={publication?.publishedAt ?? null} coverage={coverage} showStatus={!!publication}
      tabs={result && !result.ok ? [] : undefined}>
      {result && !result.ok ? <DraftEditErrorState reason={result.reason} onRetry={retry} /> : <VacancyDocumentsTab draftId={vacancyId} />}
    </VacancyFrame>
  );
}

type Header = { status: "loading" } | { status: "failed" } | { status: "ready"; vacancy: DocumentOverview["vacancy"] };

/**
 * The identity row's source for a stakeholder: the `vacancy` block of `document-overview`, the only vacancy read the role has. The read is
 * the tab's own (`onOverview`), so the screen makes no second one; a later failed read keeps the identity already shown.
 */
function useOverviewHeader(vacancyId: string): { header: Header; onOverview: (overview: DocumentOverview | null) => void } {
  const [loaded, setLoaded] = useState<{ id: string; header: Header } | null>(null);
  const onOverview = useCallback((overview: DocumentOverview | null) => setLoaded(previous => {
    if (overview) return { id: vacancyId, header: { status: "ready", vacancy: overview.vacancy } };
    return previous?.id === vacancyId && previous.header.status === "ready" ? previous : { id: vacancyId, header: { status: "failed" } };
  }), [vacancyId]);
  return { header: loaded?.id === vacancyId ? loaded.header : { status: "loading" }, onOverview };
}

/**
 * S11: the stakeholder's view of a vacancy: Documentos is the only tab, the back crumb returns to their own list, and the identity row
 * is the overview's `vacancy` header (no draft, lifecycle or publication read). The tab is read-only because the backend sends no
 * upload, link, replace or delete action to this role; the note says so, as in artboard 03.
 */
function StakeholderDocumentsScreen({ vacancyId }: { vacancyId: string }) {
  const { header, onOverview } = useOverviewHeader(vacancyId);
  const vacancy = header.status === "ready" ? header.vacancy : undefined;
  return (
    <VacancyFrame vacancyId={vacancyId} active="documentos" audience="stakeholder" fallbackTitle="Documentos" loading={header.status === "loading"}
      title={vacancy ? vacancy.title || "Sin título" : undefined} {...(vacancy ? { vacancy } : {})}>
      <p role="note" className="flex items-start gap-2.5 rounded-2xl bg-muted px-4 py-3 text-sm">
        <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span><strong className="font-medium">Solo consulta.</strong> Con tu rol de stakeholder esta vacante solo muestra la pestaña Documentos: puedes ver y descargar, incluso los de vacantes en borrador; no hay subir, reemplazar, vincular ni eliminar.</span>
      </p>
      <VacancyDocumentsTab draftId={vacancyId} onOverview={onOverview} />
    </VacancyFrame>
  );
}
