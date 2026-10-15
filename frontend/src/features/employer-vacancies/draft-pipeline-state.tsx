"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, GitBranch } from "lucide-react";
import { SiteHeader } from "@/components/company-dashboard/site-header";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { DraftEditErrorState } from "@/features/jobs/drafts/reopen/error-state";
import { loadDraftForEditAction, type DraftEditResult } from "@/features/jobs/drafts/reopen/load";

/** Owns the single header, so the title updates from the authenticated action without duplicate chrome. */
export function DraftPipelineState({ draftId }: { draftId: string }) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ id: string; result: DraftEditResult } | null>(null);
  const result = loaded?.id === draftId ? loaded.result : null;
  useEffect(() => {
    let current = true;
    loadDraftForEditAction(draftId).then(
      result => { if (current) setLoaded({ id: draftId, result }); },
      () => { if (current) setLoaded({ id: draftId, result: { ok: false, reason: "no_response" } }); },
    );
    return () => { current = false; };
  }, [draftId, attempt]);
  const retry = () => { setLoaded(null); setAttempt(value => value + 1); };
  const title = result?.ok ? result.seed.model.fields.title || "Sin título" : "Pipeline";
  return (
    <div className="flex flex-1 flex-col" aria-busy={result === null}>
      <SiteHeader title={title} parent={{ label: "Vacantes", href: "/empresa/vacantes" }} status={result?.ok ? <Badge variant="info" dot>Borrador</Badge> : result === null ? <Skeleton aria-hidden="true" className="h-5 w-24" /> : undefined} />
      <div className="@container/main flex flex-1 flex-col">
        <DashboardPageContent width="screen-2xl" className="gap-5 md:gap-6">
          <section aria-labelledby="draft-pipeline-heading" className="flex flex-col gap-1.5">
            <h2 id="draft-pipeline-heading" className="font-heading text-[20px] font-semibold text-foreground">Pipeline</h2>
            <p className="max-w-prose text-[13.5px] text-muted-foreground">Da seguimiento a los candidatos de esta vacante.</p>
          </section>
          {result === null ? (
            <>
              <span role="status" className="sr-only">Cargando borrador</span>
              <Card aria-hidden="true"><CardContent className="flex min-h-80 flex-col items-center justify-center gap-4">
                <Skeleton className="size-10" /><Skeleton className="h-6 w-64 max-w-full" /><Skeleton className="h-5 w-80 max-w-full" /><Skeleton className="h-5 w-72 max-w-full" /><Skeleton className="h-10 w-48" />
              </CardContent></Card>
            </>
          ) : !result.ok ? <DraftEditErrorState reason={result.reason} onRetry={retry} /> : (
            <Card><CardContent>
              <Empty className="min-h-80">
                <EmptyHeader>
                  <EmptyMedia variant="icon"><GitBranch aria-hidden="true" /></EmptyMedia>
                  <EmptyTitle role="heading" aria-level={3}>Esta vacante todavía no tiene pipeline</EmptyTitle>
                  <EmptyDescription>Esta vacante está en borrador. Los candidatos aparecerán aquí una vez que se publique. Puedes continuar editándola y preparar todo antes de publicar.</EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button nativeButton={false} role="link" render={<Link href={`/empresa/vacantes/borradores/${draftId}`} />} className="min-h-10">Continuar editando<ArrowRight aria-hidden="true" data-icon="inline-end" /></Button>
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
