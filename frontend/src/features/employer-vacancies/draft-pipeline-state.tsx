"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, FilePen, GitBranch, SlidersHorizontal } from "lucide-react";
import { SiteHeader } from "@/components/company-dashboard/site-header";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { DraftEditErrorState } from "@/features/jobs/drafts/reopen/error-state";
import { loadDraftForEditAction, type DraftEditResult } from "@/features/jobs/drafts/reopen/load";

import { loadDraftPublicationAction } from "@/features/jobs/drafts/pipeline/publication-actions";
import type { DraftPublication } from "@/features/jobs/drafts/pipeline/publication-client";
import { PublishButton } from "./publication/publish-dialog";
import { MovementBoard } from "@/features/pipeline-movement/board";
import { cn } from "@/lib/utils";
import { publicationStatus } from "@/features/vacancy-lifecycle/publication-status";

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
  const status = publicationStatus(result?.ok ? result.seed.lifecycle.publication : undefined);
  const configHref = `/empresa/vacantes/${draftId}/configuracion/columnas`;
  return (
    // The inset shell has 8px above and below it on desktop. Only the live
    // board owns a viewport frame; drafts and mobile retain page scrolling.
    <div className={cn("flex min-h-0 flex-1 flex-col", published && "md:h-[calc(100dvh-1rem)] md:flex-none md:overflow-hidden")} aria-busy={result === null}>
      <SiteHeader title={title} parent={{ label: "Vacantes", href: "/empresa/vacantes" }} status={result?.ok ? <Badge variant={status.variant} dot>{status.label}</Badge> : result === null ? <Skeleton aria-hidden="true" className="h-5 w-20" /> : undefined} />
      <div className="@container/main flex min-h-0 flex-1 flex-col">
        <DashboardPageContent width="screen-2xl" className="min-h-0 flex-1 gap-5 md:gap-6">
          {!published && <section aria-labelledby="draft-pipeline-heading" className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-1.5">
              <h2 id="draft-pipeline-heading" className="font-heading text-[20px] font-semibold text-foreground">Pipeline</h2>
              <p className="max-w-prose text-[13.5px] text-muted-foreground">Da seguimiento a los candidatos de esta vacante.</p>
            </div>
          </section>}
          {result === null ? (
            <>
              <span role="status" className="sr-only">Cargando borrador</span>
              <DraftPipelineCard aria-hidden="true"
                state={<Skeleton className="h-7 w-40 rounded-full" />}
                settings={<Skeleton className="h-10 w-44" />}
                icon={<Skeleton className="size-10" />}
                title={<Skeleton className="h-7 w-96 max-w-full" />}
                description={<Skeleton className="h-16 w-full max-w-md"><span className="invisible">&nbsp;</span></Skeleton>}
                actions={<><Skeleton className="h-10 w-full sm:w-40" /><Skeleton className="h-10 w-full sm:w-44" /></>}
                hint={<Skeleton className="h-5 w-96 max-w-full" />}
              />
              <Skeleton aria-hidden="true" className="h-10 w-40" />
            </>
          ) : !result.ok ? <DraftEditErrorState reason={result.reason} onRetry={retry} /> : published ? (
            <MovementBoard vacancyId={draftId} vacancyTitle={title} publishedAt={publishedAt} />
          ) : (
            <>
              <DraftPipelineCard
                state={<Badge variant="secondary" className="h-7 gap-1.5 px-3 font-normal"><FilePen aria-hidden="true" />Vacante en borrador</Badge>}
                settings={<Button nativeButton={false} role="link" variant="ghost" render={<Link href={configHref} />} className="min-h-10"><SlidersHorizontal aria-hidden="true" data-icon="inline-start" />Configurar columnas</Button>}
                icon={<GitBranch aria-hidden="true" />}
                title="Esta vacante todavía no tiene pipeline"
                description="Los candidatos aparecerán aquí una vez que publiques la vacante. Mientras tanto, puedes continuar editándola y preparar todo antes de publicar."
                actions={<>
                  <PublishButton draftId={draftId} variant="default" label="Publicar vacante" onPublished={retry} />
                  <Button nativeButton={false} role="link" variant="outline" render={<Link href={`/empresa/vacantes/borradores/${draftId}`} />} className="min-h-10">Continuar editando<ArrowRight aria-hidden="true" data-icon="inline-end" /></Button>
                </>}
                hint={<><GitBranch aria-hidden="true" className="size-4 shrink-0" />Puedes configurar las columnas de tu proceso antes de publicar.</>}
              />
              {/* Leaving the screen is navigation, kept outside the card so it never competes with the task. */}
              <Button nativeButton={false} role="link" variant="ghost" render={<Link href="/empresa/vacantes" />} className="min-h-10 self-start"><ArrowLeft aria-hidden="true" data-icon="inline-start" />Volver a Vacantes</Button>
            </>
          )}
        </DashboardPageContent>
      </div>
    </div>
  );
}

/**
 * Draft pipeline card: state and pipeline settings in the header, the action-oriented empty state
 * (what happens → what will happen → what you can do) in the content, and a hint in the footer.
 * The loading skeleton renders this same component with placeholders, so nothing shifts.
 */
function DraftPipelineCard({ state, settings, icon, title, description, actions, hint, ...props }: {
  state: ReactNode; settings: ReactNode; icon: ReactNode; title: ReactNode; description: ReactNode; actions: ReactNode; hint: ReactNode; "aria-hidden"?: "true";
}) {
  return (
    <Card {...props}>
      <CardHeader className="border-b">
        <CardTitle>{state}</CardTitle>
        <CardAction>{settings}</CardAction>
      </CardHeader>
      <CardContent>
        <Empty className="py-10">
          <EmptyHeader className="max-w-md">
            <EmptyMedia variant="icon">{icon}</EmptyMedia>
            <EmptyTitle role="heading" aria-level={3} className="text-xl font-semibold">{title}</EmptyTitle>
            <EmptyDescription>{description}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-col gap-2 sm:flex-row sm:justify-center">{actions}</EmptyContent>
        </Empty>
      </CardContent>
      <CardFooter className="justify-center gap-2 border-t text-sm text-muted-foreground">{hint}</CardFooter>
    </Card>
  );
}
