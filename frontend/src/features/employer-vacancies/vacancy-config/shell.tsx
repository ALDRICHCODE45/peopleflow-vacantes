"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarCheck, ClipboardList, Columns3 } from "lucide-react";
import { cn } from "cn";
import { SiteHeader } from "@/components/company-dashboard/site-header";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DraftEditErrorState } from "@/features/jobs/drafts/reopen/error-state";
import { loadDraftForEditAction, type DraftEditResult } from "@/features/jobs/drafts/reopen/load";
import { PipelineEditorSkeleton } from "../stage-config/loading";
import { DeliverySkeleton } from "../delivery-config/loading";
import { ManagementSkeleton } from "../management-config/loading";

export const VACANCY_CONFIG_MODULES = [
  { slug: "columnas", title: "Columnas del pipeline", description: "Nombres, orden y columnas propias.", icon: Columns3 },
  { slug: "entrega", title: "Entrega", description: "Columna de corte, objetivo y fecha compromiso.", icon: CalendarCheck },
  { slug: "solicitud", title: "Solicitud", description: "Fecha de solicitud y plazas a cubrir.", icon: ClipboardList },
] as const;

/** Owns the vacancy header and gates sub-modules on an authorized draft read. */
export function VacancyConfigShell({ draftId, children }: { draftId: string; children: ReactNode }) {
  const pathname = usePathname();
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ id: string; result: DraftEditResult } | null>(null);
  const result = loaded?.id === draftId ? loaded.result : null;
  useEffect(() => {
    let current = true;
    loadDraftForEditAction(draftId).catch((): DraftEditResult => ({ ok: false, reason: "no_response" })).then(result => {
      if (current) setLoaded({ id: draftId, result });
    });
    return () => { current = false; };
  }, [draftId, attempt]);
  const retry = () => { setLoaded(null); setAttempt(value => value + 1); };
  const title = result?.ok ? result.seed.model.fields.title || "Sin título" : "Configuración";
  return (
    <div className="flex flex-1 flex-col" aria-busy={result === null}>
      <SiteHeader title={title} parent={{ label: "Pipeline", href: `/empresa/vacantes/${draftId}/pipeline` }} status={result?.ok ? <Badge variant="info" dot>Borrador</Badge> : result === null ? <Skeleton aria-hidden="true" className="h-5 w-20" /> : undefined} />
      <div className="@container/main flex flex-1 flex-col">
        <DashboardPageContent width="screen-2xl" className="gap-5 md:gap-6">
          {result && !result.ok ? <DraftEditErrorState reason={result.reason} onRetry={retry} /> : (
            <>
              <section aria-labelledby="vacancy-config-heading" className="flex flex-col gap-1.5">
                <h2 id="vacancy-config-heading" className="font-heading text-[20px] font-semibold text-foreground">Configuración de la vacante</h2>
                <p className="max-w-prose text-[13.5px] text-muted-foreground">Ajusta cómo funciona esta vacante. Los cambios de cada apartado se guardan por separado.</p>
              </section>
              {result === null ? (
                <section aria-label="Configuración de la vacante" className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
                  <span role="status" className="sr-only">Cargando configuración</span>
                  <div aria-hidden="true" className="min-w-0 lg:self-start"><ul className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-1">{VACANCY_CONFIG_MODULES.map(module => <li key={module.slug} className="flex min-h-10 min-w-0 items-start gap-2 rounded-2xl px-3 py-3"><Skeleton className="mt-0.5 size-4 shrink-0" /><span className="flex min-w-0 flex-1 flex-col gap-1"><Skeleton className="h-5 w-32 max-w-full" /><Skeleton className="h-8 w-full" /></span></li>)}</ul></div>
                  <div aria-hidden="true" className="flex min-w-0 flex-col gap-5">{pathname?.endsWith("/entrega") ? <DeliverySkeleton /> : pathname?.endsWith("/solicitud") ? <ManagementSkeleton /> : <PipelineEditorSkeleton />}</div>
                </section>
              ) : (
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
                  <nav aria-label="Apartados de configuración de la vacante" className="min-w-0 lg:sticky lg:top-4 lg:self-start">
                    <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-1">
                      {VACANCY_CONFIG_MODULES.map(({ slug, title, description, icon: Icon }) => {
                        const href = `/empresa/vacantes/${draftId}/configuracion/${slug}`;
                        const active = pathname === href;
                        return <li key={slug} className="min-w-0">
                          <Link href={href} aria-current={active ? "page" : undefined} className={cn("flex min-h-10 min-w-0 items-start gap-2 rounded-2xl px-3 py-3 text-sm outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30", active ? "bg-card text-foreground shadow-sm ring-1 ring-primary/40" : "text-muted-foreground")}>
                            <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                            <span className="flex min-w-0 flex-col gap-1"><span className="font-medium">{title}</span><span className="text-xs text-muted-foreground">{description}</span></span>
                          </Link>
                        </li>;
                      })}
                    </ul>
                  </nav>
                  <div className="flex min-w-0 flex-col gap-5">{children}</div>
                </div>
              )}
            </>
          )}
        </DashboardPageContent>
      </div>
    </div>
  );
}
