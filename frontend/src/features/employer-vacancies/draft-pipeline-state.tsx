"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, GitBranch, Settings, Settings2 } from "lucide-react";
import { SiteHeader } from "@/components/company-dashboard/site-header";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DraftEditErrorState } from "@/features/jobs/drafts/reopen/error-state";
import { loadDraftForEditAction, type DraftEditResult } from "@/features/jobs/drafts/reopen/load";

import { loadDraftPublicationAction } from "@/features/jobs/drafts/pipeline/publication-actions";
import type { DraftPublication } from "@/features/jobs/drafts/pipeline/publication-client";
import { PublishButton } from "./publication/publish-dialog";
import { MovementBoard } from "@/features/pipeline-movement/board";

/** Reads readiness alongside the draft; published processes load their real board independently. */
export function DraftPipelineState({ draftId }: { draftId: string }) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ id: string; result: DraftEditResult; publication?: DraftPublication } | null>(null);
  const result = loaded?.id === draftId ? loaded.result : null;
  useEffect(() => {
    let current = true;
    async function load() {
      try {
        const [result, publication] = await Promise.all([loadDraftForEditAction(draftId), loadDraftPublicationAction(draftId)]);
        if (!current) return;
        if (!result.ok) { setLoaded({ id: draftId, result }); return; }
        if (!publication.ok) { setLoaded({ id: draftId, result: { ok: false, reason: "unrecognized_response" } }); return; }
        setLoaded({ id: draftId, result, publication: publication.publication });
      } catch { if (current) setLoaded({ id: draftId, result: { ok: false, reason: "no_response" } }); }
    }
    void load();
    return () => { current = false; };
  }, [draftId, attempt]);
  const retry = () => { setLoaded(null); setAttempt(value => value + 1); };
  const published = loaded?.id === draftId && loaded.publication?.status === "published";
  const publishedAt = published ? loaded?.publication?.publishedAt : null;
  const title = result?.ok ? result.seed.model.fields.title || "Sin título" : "Pipeline";
  const configHref = `/empresa/vacantes/${draftId}/configuracion/columnas`;
  return (
    <div className="flex flex-1 flex-col" aria-busy={result === null}>
      <SiteHeader title={title} parent={{ label: "Vacantes", href: "/empresa/vacantes" }} status={result?.ok ? <Badge variant={published ? "accent" : "info"} dot>{published ? "Activa" : "Borrador"}</Badge> : result === null ? <Skeleton aria-hidden="true" className="h-5 w-24" /> : undefined} />
      <div className="@container/main flex flex-1 flex-col">
        <DashboardPageContent width="screen-2xl" className="gap-5 md:gap-6">
          {!published && <section aria-labelledby="draft-pipeline-heading" className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-1.5">
              <h2 id="draft-pipeline-heading" className="font-heading text-[20px] font-semibold text-foreground">Pipeline</h2>
              <p className="max-w-prose text-[13.5px] text-muted-foreground">Da seguimiento a los candidatos de esta vacante.</p>
            </div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger render={<Button nativeButton={false} role="link" variant="outline" size="icon" className="size-10" aria-label="Configuración de la vacante" render={<Link href={configHref} />} />}>
                  <Settings2 aria-hidden="true" />
                </TooltipTrigger>
                <TooltipContent>Configuración de la vacante</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </section>}
          {result === null ? (
            <>
              <span role="status" className="sr-only">Cargando borrador</span>
              <Card aria-hidden="true"><CardContent className="flex min-h-80 flex-col items-center justify-center gap-4">
                <Skeleton className="size-10" /><Skeleton className="h-6 w-64 max-w-full" /><Skeleton className="h-5 w-80 max-w-full" /><Skeleton className="h-5 w-72 max-w-full" /><Skeleton className="h-10 w-48" />
              </CardContent></Card>
            </>
          ) : !result.ok ? <DraftEditErrorState reason={result.reason} onRetry={retry} /> : published ? (
            <MovementBoard vacancyId={draftId} vacancyTitle={title} publishedAt={publishedAt} />
          ) : (
            <Card><CardContent>
              <Empty className="min-h-80">
                <EmptyHeader>
                  <EmptyMedia variant="icon"><GitBranch aria-hidden="true" /></EmptyMedia>
                  <EmptyTitle role="heading" aria-level={3}>Esta vacante todavía no tiene pipeline</EmptyTitle>
                  <EmptyDescription>Esta vacante está en borrador. Los candidatos aparecerán aquí una vez que se publique. Puedes continuar editándola y preparar todo antes de publicar.</EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <div className="flex flex-wrap justify-center gap-2"><PublishButton draftId={draftId} variant="default" onPublished={retry} />
                  <Button nativeButton={false} role="link" variant="outline" render={<Link href={configHref} />} className="min-h-10"><Settings aria-hidden="true" data-icon="inline-start" />Configurar columnas</Button></div>
                  <Button nativeButton={false} role="link" variant="outline" render={<Link href={`/empresa/vacantes/borradores/${draftId}`} />} className="min-h-10">Continuar editando<ArrowRight aria-hidden="true" data-icon="inline-end" /></Button>
                  <Button nativeButton={false} role="link" variant="ghost" render={<Link href="/empresa/vacantes" />} className="min-h-10"><ArrowLeft aria-hidden="true" data-icon="inline-start" />Volver a Vacantes</Button>
                </EmptyContent>
              </Empty>
            </CardContent></Card>
          )}
        </DashboardPageContent>
      </div>
    </div>
  );
}
