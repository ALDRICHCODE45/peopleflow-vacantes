"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, FilePen, GitBranch, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { DraftEditErrorState } from "@/features/jobs/drafts/reopen/error-state";
import { loadDraftForEditAction, type DraftEditResult } from "@/features/jobs/drafts/reopen/load";

import { loadDraftPublicationAction } from "@/features/jobs/drafts/pipeline/publication-actions";
import type { DraftPublication } from "@/features/jobs/drafts/pipeline/publication-client";
import { PublishButton, PublishDialog } from "./publication/publish-dialog";
import { MovementBoard } from "@/features/pipeline-movement/board";
import type { Board } from "@/features/pipeline-movement/model";
import type { CloseCoverage, Lifecycle } from "@/features/vacancy-lifecycle/model";
import { useStartReplacementRequest } from "./use-start-replacement-request";
import { replacementSource, type ReplacementSource } from "./replacement-source";
import { StartReplacementHost } from "./start-replacement-host";
import { VacancyFrame } from "./vacancy-frame";

/** Reads readiness alongside the draft; published processes load their real board independently. */
export function DraftPipelineState({ draftId }: { draftId: string }) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ id: string; result: DraftEditResult; publication?: DraftPublication } | null>(null);
  // «Publicar» of a private replacement (S5 publish later) opens the usual dialog; a successful publication re-reads the board.
  const [publishOpen, setPublishOpen] = useState(false);
  const [boardAttempt, setBoardAttempt] = useState(0);
  const [boardLifecycle, setBoardLifecycle] = useState<{ id: string; value: Lifecycle }>();
  const onLifecycleChange = useCallback((value: Lifecycle) => setBoardLifecycle({ id: draftId, value }), [draftId]);
  // The board's live coverage lets the identity row word the close result («Cubierta al cierre»); it is the board's own read, not a new one.
  const [boardCoverage, setBoardCoverage] = useState<{ id: string; value: CloseCoverage }>();
  const result = loaded?.id === draftId ? loaded.result : null;
  // «Iniciar reemplazo» (card «⋯» menu with its credit, header «Acciones» without one) lands in `startReplacement.open(draftId, creditId?)`.
  // The dialog needs the SOURCE board's stages and hires still in Placement, so the board reports what it loaded.
  const startReplacement = useStartReplacementRequest();
  const [source, setSource] = useState<{ id: string; value: ReplacementSource }>();
  const onBoardChange = useCallback((board: Board) => { setSource({ id: draftId, value: replacementSource(board) }); setBoardCoverage({ id: draftId, value: board.coverage }); }, [draftId]);
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
  // Publishing a private replacement creates its listing: the publication read now has the listing's own date, which the board header shows beside «Proceso iniciado».
  const refreshPublication = useCallback(async () => {
    try {
      const publication = await loadDraftPublicationAction(draftId);
      if (publication.ok) setLoaded(current => current?.id === draftId && current.result.ok ? { ...current, publication: publication.publication } : current);
    } catch { /* The date line stays as it was; the next load fixes it. */ }
  }, [draftId]);
  // Contract D4: a private replacement reads «draft» on `GET V/publication` while its lifecycle is published + private, with a process. The lifecycle
  // decides: only a draft that never published (no publication axis) keeps the draft screen.
  const seedLifecycle = result?.ok ? result.seed.lifecycle : undefined;
  const hasProcess = seedLifecycle?.publication != null && seedLifecycle.process != null;
  const published = (loaded?.id === draftId && loaded.publication?.status === "published") || hasProcess;
  const publishedAt = loaded?.id === draftId ? loaded.publication?.publishedAt ?? null : null;
  const title = result?.ok ? result.seed.model.fields.title || "Sin título" : "Pipeline";
  // The identity row (title, badges, dates) lives in the vacancy frame: it shows the board's live lifecycle once the board reports it, the seed's before.
  const lifecycle = result?.ok ? boardLifecycle?.id === draftId ? boardLifecycle.value : result.seed.lifecycle : undefined;
  const coverage = boardCoverage?.id === draftId ? boardCoverage.value : undefined;
  const configHref = `/empresa/vacantes/${draftId}/configuracion/columnas`;
  return (
    // The inset shell has 8px above and below it on desktop. Only the live
    // board owns a viewport frame; drafts and mobile retain page scrolling.
    <VacancyFrame vacancyId={draftId} active="pipeline" fallbackTitle="Pipeline" fill={published} loading={result === null}
      title={result?.ok ? title : undefined} lifecycle={lifecycle} publishedAt={publishedAt} coverage={coverage} tabs={result && !result.ok ? [] : undefined}>
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
        <>
          <MovementBoard key={boardAttempt} vacancyId={draftId} vacancyTitle={title} onLifecycleChange={onLifecycleChange} onBoardChange={onBoardChange} onStartReplacement={creditId => startReplacement.open(draftId, creditId)} onPublish={() => setPublishOpen(true)} />
          {publishOpen && <PublishDialog draftId={draftId} open onOpenChange={setPublishOpen} onPublished={() => { setBoardAttempt(value => value + 1); void refreshPublication(); }} />}
          {startReplacement.request?.draftId === draftId && source?.id === draftId && <StartReplacementHost key={draftId} draftId={draftId} title={title} creditId={startReplacement.request.creditId} source={source.value} onClose={startReplacement.close} />}
        </>
      ) : (
        <>
          <DraftPipelineCard
            state={<span className="flex items-center gap-1.5"><FilePen aria-hidden="true" className="size-4" />Vacante en borrador</span>}
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
    </VacancyFrame>
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
