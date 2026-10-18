"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, GripVertical, Settings2, TriangleAlert, UsersRound } from "lucide-react";
import { ActionBar, ActionStatus, ActionStatusSlot } from "@/components/feedback/action-status";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Separator } from "@/components/ui/separator";
import { Hint } from "./pipeline-presentation";
import { BoardColumns } from "./board-columns";
import { BoardCoverage, BoardError, BoardSkeleton, MovementDate } from "./board-states";
import { CandidateSheet } from "./candidate-sheet";
import { DispositionDialog } from "./disposition-dialog";
import { useMovementBoard } from "./use-movement-board";

/** A keyed session prevents reads/writes from a previous vacancy reaching this one. */
type Props = { vacancyId: string; vacancyTitle?: string; publishedAt?: string | null };
export function MovementBoard(props: Props) {
  return <BoardSession key={props.vacancyId} {...props} />;
}
function BoardSession({ vacancyId, vacancyTitle, publishedAt }: Props) {
  const state = useMovementBoard(vacancyId);
  const [selected, setSelected] = useState<string | null>(null);
  const { board, confirmation, pending, stale } = state;
  const restoreFocus = useRef<string | null>(null);
  useEffect(() => {
    const id = restoreFocus.current;
    if (!id || pending.has(id) || stale || confirmation) return;
    // A moved card is remounted under its new column. Restore lost keyboard
    // focus, but never steal it from another control used during the request.
    if (document.activeElement === document.body) document.getElementById(`candidate-move-${id}`)?.focus();
    restoreFocus.current = null;
  }, [pending, stale, confirmation]);
  function requestMove(id: string, target: string) {
    const focused = document.activeElement;
    if (!focused?.closest('[data-slot="sheet-content"]') && (focused?.id === `candidate-move-${id}` || focused?.id === `candidate-drag-${id}` || focused?.closest('[role="menu"]'))) restoreFocus.current = id;
    state.requestMove(id, target);
  }
  const selectedItem = board?.participations.find(item => item.id === selected);
  const from = board?.stages.find(stage => stage.id === confirmation?.item.stage_id)?.name ?? "Placement";
  const to = board?.stages.find(stage => stage.id === confirmation?.target)?.name ?? "la etapa seleccionada";
  const confirming = !!confirmation && state.pending.has(confirmation.item.id);
  const dispositionDialog = board && state.disposition && <DispositionDialog key={`${state.disposition.kind}-${state.disposition.item.id}`} disposition={state.disposition} board={board} pending={pending.has(state.disposition.item.id)} stale={stale} reading={state.reading} notice={state.notices[state.disposition.item.id]} onClose={state.closeDisposition} onConfirm={state.confirmDisposition} finalFocus={() => document.getElementById(`${selectedItem ? "candidate-disposition" : "candidate-move"}-${state.disposition!.item.id}`)} />;
  const placementDialog = <Dialog open={!!confirmation} onOpenChange={open => { if (!open) state.closeConfirmation(); }}>
    {confirmation && <DialogContent showCloseButton={!confirming} finalFocus={() => document.getElementById(`${selectedItem ? "candidate-sheet-move" : "candidate-move"}-${confirmation.item.id}`)}>
      <DialogHeader><DialogTitle>Salir de {from}</DialogTitle><DialogDescription>Este movimiento reduce las plazas cubiertas y conserva el historial de contratación. Confirma antes de continuar.</DialogDescription></DialogHeader>
      <div className="flex flex-col gap-3"><p className="font-medium">{confirmation.item.candidate.full_name}</p><p className="flex items-center gap-2">{from}<ArrowRight aria-hidden="true" className="size-4" />{to}</p><p className="flex items-start gap-2 text-sm"><TriangleAlert aria-hidden="true" className="size-4 shrink-0" />Se registrará la salida de Placement sin borrar los movimientos anteriores.</p></div>
      <DialogFooter className="flex-row"><ActionBar status={confirming ? <span role="status" className="text-sm">Moviendo candidato…</span> : state.stale ? <ActionStatus id="placement-check-status" tone="info" text={state.reading ? "Actualizando el tablero. Espera antes de confirmar." : "Cancela y usa Reintentar para actualizar el tablero antes de confirmar."} /> : null}>
        <Button type="button" variant="outline" className="min-h-10" disabled={confirming} onClick={state.closeConfirmation}>Cancelar</Button>
        <Button type="button" className="min-h-10" disabled={confirming || state.reading || state.stale} aria-busy={confirming} aria-describedby={state.stale ? "placement-check-status" : undefined} onClick={state.confirmMove}>{confirming && <Spinner aria-hidden="true" data-icon="inline-start" />}Confirmar movimiento</Button>
      </ActionBar></DialogFooter>
    </DialogContent>}
  </Dialog>;
  return <section aria-label="Tablero de candidatos" className="flex min-h-0 min-w-0 flex-1 flex-col gap-4" aria-busy={state.reading}>
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-4 pb-2">
      <div className="flex flex-col gap-1.5"><h2 className="text-xl font-semibold tracking-tight">Pipeline</h2>{publishedAt && <p className="text-xs text-muted-foreground">Publicada el <MovementDate value={publishedAt} /></p>}</div>
      <div className="flex items-center gap-5">{board && <BoardCoverage coverage={board.coverage} />}<Separator orientation="vertical" className="h-8" /><Hint text="Configuración de la vacante"><Button nativeButton={false} role="link" variant="outline" size="icon" className="size-10 bg-card" aria-label="Configuración de la vacante" render={<Link href={`/empresa/vacantes/${vacancyId}/configuracion/columnas`} />}><Settings2 aria-hidden="true" /></Button></Hint></div>
    </div>
    {!board && state.reading && !state.failure && <BoardSkeleton columnCount={state.columns.editor ? state.columns.editor.stages.length + 1 : undefined} />}
    {state.failure && <BoardError failure={state.failure} reading={state.reading} notice={state.readNotice} retry={() => void state.retry()} />}
    {!state.failure && state.readNotice && <ActionStatusSlot><ActionStatus id="board-read-status" tone={state.readNotice.tone} text={state.readNotice.text} /></ActionStatusSlot>}
    {state.stale && state.reading && !state.columns.busy && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner aria-hidden="true" />Comprobando el estado del tablero…</p>}
    {board && <>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground"><UsersRound aria-hidden="true" className="size-4" /><span><strong className="font-medium text-foreground tabular-nums">{board.participations.length}</strong> candidatos en el pipeline</span></p>
        <div className="flex min-w-0 items-center gap-3"><ActionStatusSlot>
          {state.columns.busy ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner aria-hidden="true" />Guardando y actualizando columnas…</p> : state.columns.notice ? <ActionStatus id="column-order-status" tone={state.columns.notice.tone} text={state.columns.notice.text} /> : state.columns.unavailable ? <p className="text-sm text-muted-foreground">No pudimos cargar el orden de columnas.</p> : (state.columns.structureLocked || !state.columns.locked) && <span className="hidden items-center gap-1.5 text-[11px] text-muted-foreground sm:flex"><GripVertical aria-hidden="true" className="size-3.5" />{state.columns.structureLocked ? "Arrastra una tarjeta para moverla" : "Arrastra una columna para reordenarla"}</span>}
        </ActionStatusSlot>{state.columns.unavailable && <Button type="button" variant="outline" className="min-h-10" disabled={state.columns.busy} onClick={() => void state.columns.refresh()}>Actualizar columnas</Button>}</div>
      </div>
      <BoardColumns columnOrder={state.columns} board={board} pending={state.pending} locked={state.stale || !!confirmation || !!state.disposition} notices={state.notices} onMove={requestMove} onDetail={setSelected} onDisposition={state.requestDisposition} />
      {Object.entries(state.notices).filter(([id]) => !board.participations.some(item => item.id === id)).map(([id, notice]) => <ActionStatusSlot key={id}><ActionStatus id={`move-status-${id}`} tone={notice.tone} text={notice.text} /></ActionStatusSlot>)}
      {selectedItem && <CandidateSheet vacancyId={vacancyId} vacancyTitle={vacancyTitle} item={selectedItem} board={board} onClose={() => setSelected(null)} onMove={requestMove} onDisposition={state.requestDisposition} locked={stale || pending.has(selectedItem.id) || !!confirmation || !!state.disposition} notice={state.notices[selectedItem.id]}>{dispositionDialog}{placementDialog}</CandidateSheet>}
      {!selectedItem && dispositionDialog}
    </>}
    {!selectedItem && placementDialog}
  </section>;
}
