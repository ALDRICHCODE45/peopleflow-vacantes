"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, TriangleAlert } from "lucide-react";
import { ActionBar, ActionStatus, ActionStatusSlot } from "@/components/feedback/action-status";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { BoardColumns } from "./board-columns";
import { BoardCoverage, BoardError, BoardSkeleton } from "./board-states";
import { CandidateSheet } from "./candidate-sheet";
import { DispositionDialog } from "./disposition-dialog";
import { useMovementBoard } from "./use-movement-board";

/** A keyed session prevents reads/writes from a previous vacancy reaching this one. */
export function MovementBoard({ vacancyId }: { vacancyId: string }) {
  return <BoardSession key={vacancyId} vacancyId={vacancyId} />;
}
function BoardSession({ vacancyId }: { vacancyId: string }) {
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
    if (focused?.id === `candidate-move-${id}` || focused?.id === `candidate-drag-${id}` || focused?.closest('[role="menu"]')) restoreFocus.current = id;
    state.requestMove(id, target);
  }
  const selectedItem = board?.participations.find(item => item.id === selected);
  const from = board?.stages.find(stage => stage.id === confirmation?.item.stage_id)?.name ?? "Placement";
  const to = board?.stages.find(stage => stage.id === confirmation?.target)?.name ?? "la etapa seleccionada";
  const confirming = !!confirmation && state.pending.has(confirmation.item.id);
  const dispositionDialog = board && state.disposition && <DispositionDialog key={`${state.disposition.kind}-${state.disposition.item.id}`} disposition={state.disposition} board={board} pending={pending.has(state.disposition.item.id)} stale={stale} reading={state.reading} notice={state.notices[state.disposition.item.id]} onClose={state.closeDisposition} onConfirm={state.confirmDisposition} finalFocus={() => document.getElementById(`${selectedItem ? "candidate-disposition" : "candidate-move"}-${state.disposition!.item.id}`)} />;
  if (!board && state.reading && !state.failure) return <BoardSkeleton />;
  return <section aria-label="Tablero de candidatos" className="flex min-w-0 flex-col gap-4" aria-busy={state.reading}>
    {board && <BoardCoverage coverage={board.coverage} />}
    {state.failure && <BoardError failure={state.failure} reading={state.reading} notice={state.readNotice} retry={() => void state.retry()} />}
    {!state.failure && state.readNotice && <ActionStatusSlot><ActionStatus id="board-read-status" tone={state.readNotice.tone} text={state.readNotice.text} /></ActionStatusSlot>}
    {state.stale && state.reading && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner aria-hidden="true" />Comprobando el estado del tablero…</p>}
    {board && <>
      {!board.participations.length && <p className="text-sm text-muted-foreground">Los candidatos aparecerán aquí cuando la vacante reciba postulaciones.</p>}
      <BoardColumns board={board} pending={state.pending} locked={state.stale || !!confirmation || !!state.disposition} notices={state.notices} onMove={requestMove} onDetail={setSelected} onDisposition={state.requestDisposition} />
      {Object.entries(state.notices).filter(([id]) => !board.participations.some(item => item.id === id)).map(([id, notice]) => <ActionStatusSlot key={id}><ActionStatus id={`move-status-${id}`} tone={notice.tone} text={notice.text} /></ActionStatusSlot>)}
      {selectedItem && <CandidateSheet vacancyId={vacancyId} item={selectedItem} board={board} onClose={() => setSelected(null)} onDisposition={state.requestDisposition} locked={stale || pending.has(selectedItem.id) || !!confirmation || !!state.disposition} notice={state.notices[selectedItem.id]}>{dispositionDialog}</CandidateSheet>}
      {!selectedItem && dispositionDialog}
    </>}
    <Dialog open={!!confirmation} onOpenChange={open => { if (!open) state.closeConfirmation(); }}>
      {confirmation && <DialogContent showCloseButton={!confirming} finalFocus={() => document.getElementById(`candidate-move-${confirmation.item.id}`)}>
        <DialogHeader><DialogTitle>Salir de {from}</DialogTitle><DialogDescription>Este movimiento reduce las plazas cubiertas y conserva el historial de contratación. Confirma antes de continuar.</DialogDescription></DialogHeader>
        <div className="flex flex-col gap-3"><p className="font-medium">{confirmation.item.candidate.full_name}</p><p className="flex items-center gap-2">{from}<ArrowRight aria-hidden="true" className="size-4" />{to}</p><p className="flex items-start gap-2 text-sm"><TriangleAlert aria-hidden="true" className="size-4 shrink-0" />Se registrará la salida de Placement sin borrar los movimientos anteriores.</p></div>
        <DialogFooter className="flex-row"><ActionBar status={confirming ? <span role="status" className="text-sm">Moviendo candidato…</span> : state.stale ? <ActionStatus id="placement-check-status" tone="info" text={state.reading ? "Actualizando el tablero. Espera antes de confirmar." : "Cancela y usa Reintentar para actualizar el tablero antes de confirmar."} /> : null}>
          <Button type="button" variant="outline" className="min-h-10" disabled={confirming} onClick={state.closeConfirmation}>Cancelar</Button>
          <Button type="button" className="min-h-10" disabled={confirming || state.reading || state.stale} aria-busy={confirming} aria-describedby={state.stale ? "placement-check-status" : undefined} onClick={state.confirmMove}>{confirming && <Spinner aria-hidden="true" data-icon="inline-start" />}Confirmar movimiento</Button>
        </ActionBar></DialogFooter>
      </DialogContent>}
    </Dialog>
  </section>;
}
