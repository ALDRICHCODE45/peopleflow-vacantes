"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, FilePenLine } from "lucide-react";
import { cn } from "cn";
import { SiteHeader } from "@/components/company-dashboard/site-header";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { STAKEHOLDER_VACANCIES } from "@/features/identity/stakeholder-routes";
import { BoardLifecycle } from "@/features/pipeline-movement/board-lifecycle";
import type { CloseCoverage, Lifecycle } from "@/features/vacancy-lifecycle/model";
import { publicationStatus } from "@/features/vacancy-lifecycle/publication-status";
import { ReplacementBadges, ReplacementTags } from "@/features/vacancy-lifecycle/ui/replacement-badges";
import type { DocumentOverview } from "@/features/vacancy-documents/model";
import { ShareMenu } from "@/features/jobs/components/share-menu";
import { hasPublicPage, isEditablePublication, vacancyEditorHref, vacancyPipelineHref, vacancyPublicHref } from "./model";
import { VacancyTabRowContext } from "./vacancy-frame-slot";

export type VacancyTab = "pipeline" | "documentos" | "configuracion";
const TABS: Record<VacancyTab, { label: string; href: (vacancyId: string) => string }> = {
  pipeline: { label: "Pipeline", href: vacancyPipelineHref },
  documentos: { label: "Documentos", href: vacancyId => `/empresa/vacantes/${vacancyId}/documentos` },
  configuracion: { label: "Configuración", href: vacancyId => `/empresa/vacantes/${vacancyId}/configuracion` },
};

/** S11: an employer sees every tab; a stakeholder enters the vacancy and sees only Documentos (read-only, download only). */
export function vacancyTabsFor(audience: "employer" | "stakeholder"): readonly VacancyTab[] {
  return audience === "stakeholder" ? ["documentos"] : ["pipeline", "documentos", "configuracion"];
}

const TAB_CLASS = cn(
  "-mb-px flex min-h-10 items-center justify-center rounded-sm border-b-2 border-transparent px-0.5 text-sm font-medium whitespace-nowrap text-muted-foreground outline-none transition-colors sm:min-h-11",
  "hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 aria-[current=page]:border-primary-text aria-[current=page]:text-foreground",
  // Phones: the artboard's segmented control, the current segment raised on a muted track.
  "max-sm:mb-0 max-sm:rounded-[10px] max-sm:border-b-0 max-sm:px-2 max-sm:aria-[current=page]:bg-background max-sm:aria-[current=page]:shadow-sm dark:max-sm:aria-[current=page]:bg-foreground/10 dark:max-sm:aria-[current=page]:shadow-none",
);

type Props = {
  vacancyId: string;
  active: VacancyTab;
  /** The vacancy title once read; `undefined` shows `fallbackTitle` (while loading as a skeleton, after a failed read as text). */
  title?: string | undefined;
  fallbackTitle?: string;
  loading?: boolean;
  /** The lifecycle the caller already read (the seed, then the board's live one): state badges and the date lines come from it. */
  lifecycle?: Lifecycle | undefined;
  /** The publication read's date, used when the lifecycle carries none. */
  publishedAt?: string | null;
  /** The live coverage «Cubierta al cierre» needs: the board's on the pipeline tab, the draft list row's on the others (`readClosedCoverage`). */
  coverage?: CloseCoverage | undefined;
  /** False while the publication read failed: no state badge is invented. */
  showStatus?: boolean;
  /**
   * S11/S12: who is looking. A stakeholder gets Documentos only and the back crumb to the stakeholder list; the employer default
   * is every tab and the portfolio crumb. An explicit `tabs` wins over the audience's.
   */
  audience?: "employer" | "stakeholder";
  /**
   * The `vacancy` header of `document-overview`, for a stakeholder (who has no lifecycle read): the state badge and the
   * «Reemplazo»/«Privada» tags come from it when no `lifecycle` is given. It carries no dates.
   */
  vacancy?: DocumentOverview["vacancy"];
  /** Which tabs to offer; `[]` hides the tab row (the vacancy cannot be opened). */
  tabs?: readonly VacancyTab[];
  /** The live board owns a viewport-high frame on desktop; every other tab keeps page scrolling. */
  fill?: boolean;
  children: ReactNode;
};

/**
 * S9: the one frame of an employer vacancy. Above the tabs an identity row (title, state/«Reemplazo»/«Privada» badges, dates and
 * close reason); the tabs Pipeline · Documentos · Configuración as plain links; then the tab's content. The top bar keeps only the
 * menu, the «‹ Vacantes» crumb and the theme toggle. The caller passes what its own read already produced, so the frame reads nothing.
 */
export function VacancyFrame({ vacancyId, active, title, fallbackTitle = "Vacante", loading = false, lifecycle, publishedAt, coverage, showStatus = true, audience = "employer", vacancy, tabs = vacancyTabsFor(audience), fill = false, children }: Props) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const status = lifecycle ? publicationStatus(lifecycle.publication, "accent", lifecycle.process)
    : vacancy ? publicationStatus(vacancy.publication, "accent", vacancy.process ?? undefined) : undefined;
  // The way back to the editor, and sharing, belong to a live vacancy; a stakeholder gets neither. A private replacement has no public page.
  const live = audience === "employer" && !loading && lifecycle?.publication ? lifecycle.publication : null;
  const editable = live !== null && isEditablePublication(live);
  const publicPage = live !== null && hasPublicPage({ status: live, visibility: lifecycle?.visibility });
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", fill && "md:h-[calc(100dvh-1rem)] md:flex-none md:overflow-hidden")} aria-busy={loading}>
      {/* `title={null}` (not omitted: that reads «Dashboard») leaves only menu, back crumb and theme toggle. */}
      <SiteHeader title={null} parent={{ label: "Vacantes", href: audience === "stakeholder" ? STAKEHOLDER_VACANCIES : "/empresa/vacantes" }} />
      <div className="@container/main flex min-h-0 flex-1 flex-col">
        <DashboardPageContent width="screen-2xl" className="min-h-0 flex-1 gap-0">
          {/* The top-bar crumb reads as plain text on desktop: a stakeholder, who has no tabs to leave by, gets an explicit way back. */}
          {audience === "stakeholder" && <Link href={STAKEHOLDER_VACANCIES} data-pf-vacancy-back="" className="mb-2 inline-flex min-h-10 w-fit shrink-0 items-center gap-1.5 rounded-sm text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"><ArrowLeft aria-hidden="true" className="size-4" />Volver a Vacantes</Link>}
          <div data-pf-vacancy-identity="" className="flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-1 pb-1 max-sm:pb-3">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
              {loading
                ? <><h1 className="sr-only">{fallbackTitle}</h1><Skeleton aria-hidden="true" className="h-7 w-64 max-w-full" /><Skeleton aria-hidden="true" className="h-5 w-20" /></>
                : <h1 className="font-heading text-xl font-semibold tracking-tight [overflow-wrap:anywhere]">{title ?? fallbackTitle}</h1>}
              {!loading && showStatus && status && (lifecycle || vacancy) && <><Badge variant={status.variant} dot>{status.label}</Badge>{lifecycle ? <ReplacementBadges lifecycle={lifecycle} /> : <ReplacementTags kind={vacancy?.kind} visibility={vacancy?.visibility} />}</>}
            </div>
            {(editable || publicPage) && <div data-pf-vacancy-actions="" className="flex flex-wrap items-center gap-2">
              {editable && <Button nativeButton={false} role="link" variant="outline" className="min-h-10" render={<Link href={vacancyEditorHref(vacancyId)} />}><FilePenLine aria-hidden="true" data-icon="inline-start" />Editar publicación</Button>}
              {publicPage && <>
                <ShareMenu title={title ?? fallbackTitle} url={vacancyPublicHref(vacancyId)} label="Compartir" variant="outline" className="min-h-10 w-auto" />
                <Button nativeButton={false} role="link" variant="outline" className="min-h-10" render={<Link href={vacancyPublicHref(vacancyId)} target="_blank" rel="noopener noreferrer" />}><ExternalLink aria-hidden="true" data-icon="inline-start" />Ver página pública<span className="sr-only"> (se abre en una pestaña nueva)</span></Button>
              </>}
            </div>}
            <div className="flex min-w-0 flex-col gap-0.5 text-xs text-muted-foreground empty:hidden sm:text-right">
              {lifecycle && <BoardLifecycle lifecycle={lifecycle} publishedAt={publishedAt} {...(coverage ? { coverage } : {})} />}
            </div>
          </div>
          {tabs.length > 0 && <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b max-sm:grid max-sm:border-b-0">
            <nav aria-label="Secciones de la vacante">
              <ul className="flex gap-7 max-sm:grid max-sm:auto-cols-fr max-sm:grid-flow-col max-sm:gap-0.5 max-sm:rounded-2xl max-sm:bg-muted max-sm:p-1">
                {tabs.map(tab => <li key={tab} className="flex max-sm:min-w-0">
                  <Link href={TABS[tab].href(vacancyId)} aria-current={tab === active ? "page" : undefined} className={cn(TAB_CLASS, "max-sm:flex-1")}>{TABS[tab].label}</Link>
                </li>)}
              </ul>
            </nav>
            <div ref={setSlot} className="min-w-0 empty:hidden" />
          </div>}
          <VacancyTabRowContext.Provider value={tabs.length > 0 ? slot : undefined}>
            <div className="flex min-h-0 flex-1 flex-col gap-5 pt-4 md:gap-6">{children}</div>
          </VacancyTabRowContext.Provider>
        </DashboardPageContent>
      </div>
    </div>
  );
}
