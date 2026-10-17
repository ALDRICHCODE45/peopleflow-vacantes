"use client";
import { useEffect, useState } from "react";
import { CalendarDays, Download, History as HistoryIcon, ListChecks } from "lucide-react";
import { ActionBar, ActionStatus } from "@/components/feedback/action-status";
import { notifyActionResult } from "@/components/feedback/notify";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { StageKindBadge } from "@/features/employer-vacancies/stage-config/stage-row";
import { loadHistoryAction, loadParticipationAction } from "./actions";
import { MovementDate } from "./board-states";
import type { Notice } from "./board-feedback";
import type { Board, Failure, History, Participation, ParticipationDetail } from "./model";

type Props = { vacancyId: string; item: Participation; board: Board; onClose: () => void };
export function CandidateSheet(props: Props) {
  return <Sheet open onOpenChange={open => { if (!open) props.onClose(); }}><CandidateSession key={props.item.id} {...props} /></Sheet>;
}
function CandidateSession({ vacancyId, item, board, onClose }: Props) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ detail: ParticipationDetail; history: History } | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [reading, setReading] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  useEffect(() => {
    let current = true;
    async function load() {
      let result;
      try {
        const [detail, history] = await Promise.all([loadParticipationAction(vacancyId, item.id), loadHistoryAction(vacancyId, item.id)]);
        result = !detail.ok ? detail : !history.ok ? history : { ok: true, data: { detail: detail.data, history: history.data } } as const;
      } catch { result = { ok: false, reason: "no_response", reference: {} } as const; }
      if (!current) return;
      setReading(false);
      if (result.ok) { setLoaded(result.data); setFailure(null); }
      else setFailure(result);
      if (attempt > 0) {
        const next: Notice = result.ok ? { tone: "info", text: "Detalle actualizado" } : { tone: "error", text: "No pudimos cargar el detalle" };
        setNotice(next);
        notifyActionResult({ key: "pipeline-detail-read", type: next.tone, title: next.text,
          description: result.ok ? "Las respuestas y el historial están actualizados." : "No se modificó ninguna postulación. Es seguro volver a cargar el detalle.",
          ...(!result.ok ? { reference: { ...result.reference, at: new Date().toISOString() } } : {}) });
      }
    }
    void load(); return () => { current = false; };
  }, [vacancyId, item.id, attempt]);
  const stages = [...board.stages, board.exit];
  const stageName = (id: string) => stages.find(stage => stage.id === id)?.name ?? "Etapa no disponible";
  const detail = loaded?.detail ?? item;
  const stage = stages.find(stage => stage.id === detail.stage_id);
  return <SheetContent showCloseButton={false} finalFocus={() => document.getElementById(`candidate-detail-${item.id}`)}>
    <SheetHeader><SheetTitle>{item.candidate.full_name}</SheetTitle><SheetDescription>Postulación, respuestas e historial de etapas.</SheetDescription></SheetHeader>
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pb-6" aria-busy={reading}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2"><span className="text-sm">Etapa: {stageName(detail.stage_id)}</span>{stage && <StageKindBadge kind={stage.kind} />}</div>
        <p className="flex items-center gap-2 text-xs text-muted-foreground"><CalendarDays aria-hidden="true" className="size-3.5" />Postulación: <MovementDate value={detail.applied_at} /></p>
        <a href={`/api/company/vacancies/${encodeURIComponent(vacancyId)}/participations/${encodeURIComponent(item.id)}/cv`} download className="inline-flex min-h-10 items-center gap-2 break-words underline underline-offset-4"><Download aria-hidden="true" className="size-4 shrink-0" />Descargar {detail.cv.name}</a>
      </div>
      {reading ? <><span role="status" className="sr-only">Cargando detalle e historial</span>{[0, 1, 2].map(key => <Skeleton key={key} aria-hidden="true" className="h-20 w-full" />)}</> : failure ? <Empty><EmptyHeader><EmptyTitle role="heading" aria-level={3}>No pudimos cargar el detalle</EmptyTitle><EmptyDescription>{failure.reason === "unauthenticated" ? "Tu sesión expiró. Inicia sesión de nuevo." : "No se modificó la postulación. Puedes volver a cargar las respuestas y el historial."}</EmptyDescription></EmptyHeader></Empty> : loaded && <>
        <Separator />
        <section aria-labelledby="screening-heading" className="flex flex-col gap-3"><h3 id="screening-heading" className="flex items-center gap-2 font-heading font-semibold"><ListChecks aria-hidden="true" className="size-4" />Respuestas de screening</h3>
          {loaded.detail.screening.length ? <dl className="flex flex-col gap-4">{loaded.detail.screening.map(answer => <div key={answer.question_id} className="flex flex-col gap-1"><dt className="font-medium">{answer.prompt}</dt><dd className="whitespace-pre-wrap break-words text-muted-foreground">{answer.type === "open" ? answer.answer.text : answer.answer.label}</dd></div>)}</dl> : <p className="text-sm text-muted-foreground">Esta postulación no tiene preguntas de screening.</p>}
        </section>
        <Separator />
        <section aria-labelledby="history-heading" className="flex flex-col gap-3"><h3 id="history-heading" className="flex items-center gap-2 font-heading font-semibold"><HistoryIcon aria-hidden="true" className="size-4" />Historial</h3>
          {loaded.history.items.length ? <ol className="flex flex-col gap-4 border-l border-border pl-4">{loaded.history.items.map((entry, index) => <li key={`${entry.at}-${index}`} className="flex flex-col gap-1.5">
            <p className="font-medium">{entry.kind === "intake" ? "Postulación recibida" : `${entry.from_stage_id ? stageName(entry.from_stage_id) : "Etapa no disponible"} → ${stageName(entry.to_stage_id)}`}</p>
            {entry.kind === "intake" && <p className="text-sm text-muted-foreground">Ingreso a {stageName(entry.to_stage_id)}</p>}
            <div className="flex flex-wrap gap-2">{entry.hire && <Badge variant="success">Contratación registrada</Badge>}{entry.departure && <Badge variant="review">Salida registrada</Badge>}</div>
            <p className="text-xs text-muted-foreground">{entry.actor.full_name} · {entry.actor.kind === "candidate" ? "Candidato" : "Reclutador"}</p>
            <p className="text-xs text-muted-foreground"><MovementDate value={entry.at} /></p>
          </li>)}</ol> : <p className="text-sm text-muted-foreground">No hay movimientos registrados.</p>}
        </section>
      </>}
    </div>
    <SheetFooter><ActionBar status={notice ? <ActionStatus id="detail-read-status" tone={notice.tone} text={notice.text} /> : null}>
      <SheetClose render={<Button type="button" variant="outline" className="min-h-10" />} onClick={onClose}>Cerrar</SheetClose>
      {failure && <Button type="button" variant="outline" className="min-h-10" disabled={reading} aria-describedby={notice ? "detail-read-status" : undefined} onClick={() => { setReading(true); setNotice(null); setAttempt(value => value + 1); }}>Reintentar</Button>}
    </ActionBar></SheetFooter>
  </SheetContent>;
}
