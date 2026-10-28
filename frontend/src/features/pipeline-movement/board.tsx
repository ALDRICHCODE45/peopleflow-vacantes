"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRightLeft, BadgeCheck, Columns3, GripVertical, Settings2, Tags, UserPlus, UsersRound } from "lucide-react";
import { ActionStatus, ActionStatusSlot } from "@/components/feedback/action-status";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/feedback/confirm-action-dialog";
import { ImpactDetails } from "@/features/employer-vacancies/stage-config/impact-details";
import { Spinner } from "@/components/ui/spinner";
import { Separator } from "@/components/ui/separator";
import { Hint } from "./pipeline-presentation";
import { plural } from "@/features/employer-vacancies/plural";
import { ManualIntakeSheet } from "@/features/manual-intake/sheet";
import { loadParticipationAction } from "./actions";
import type { Participation } from "./model";
import { BoardDelivery } from "./board-delivery";
import type { Lifecycle } from "@/features/vacancy-lifecycle/model";
import { BoardLifecycle } from "./board-lifecycle";
import { LifecycleActionsMenu } from "@/features/vacancy-lifecycle/ui/lifecycle-actions-menu";
import { BoardColumns } from "./board-columns";
import { BoardCoverage, BoardError, BoardSkeleton, MovementDate } from "./board-states";
import { CandidateSheet } from "./candidate-sheet";
import { DispositionDialog } from "./disposition-dialog";
import { useMovementBoard } from "./use-movement-board";
import { BoardFilters } from "./board-filters";
import { activeFilterCount, applyFilters, type FilterSelection } from "./filters";
import { boardFilterDimensions } from "./board-filter-dimensions";
import { useLanguageCatalog } from "@/features/languages/use-language-catalog";
import { ChecklistProvider, useBoardChecklist } from "@/features/vacancy-checklist/board/state";
import { ChecklistComparison, ChecklistReminder, ChecklistRetry } from "@/features/vacancy-checklist/board/ui";
import { orderByFit } from "@/features/vacancy-checklist/board/fit";

/** A keyed session prevents reads/writes from a previous vacancy reaching this one. */
type Props = { vacancyId: string; vacancyTitle?: string; publishedAt?: string | null; onLifecycleChange?: (lifecycle: Lifecycle) => void };
export function MovementBoard(props: Props) {
  return <BoardSession key={props.vacancyId} {...props} />;
}
function BoardSession(props: Props) {
  const state = useMovementBoard(props.vacancyId);
  return <ChecklistProvider vacancyId={props.vacancyId} readOnly={state.board?.lifecycle.process === "finished"}><BoardContent {...props} state={state} /></ChecklistProvider>;
}
function BoardContent({ vacancyId, vacancyTitle, publishedAt, onLifecycleChange, state }: Props & { state: ReturnType<typeof useMovementBoard> }) {
  const checklist = useBoardChecklist()!;
  const [bestFit, setBestFit] = useState(false);
  const languages = useLanguageCatalog();
  const [filters, setFilters] = useState<FilterSelection>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [sheetTab, setSheetTab] = useState<{ id: string; tab: string } | undefined>();
  const [intake, setIntake] = useState(false);
  const [externalItem, setExternalItem] = useState<Participation | null>(null);
  const { board, confirmation, pending, stale } = state;
  useEffect(() => { if (board) onLifecycleChange?.(board.lifecycle); }, [board?.lifecycle, onLifecycleChange]);
  const readOnly = board?.lifecycle.process === "finished";
  const dimensions = board ? boardFilterDimensions(board, languages.data?.items, checklist.checklist?.criteria, checklist.marks) : [];
  const matchingItems = applyFilters(board?.participations ?? [], dimensions, filters);
  const visibleItems = bestFit && checklist.checklist?.criteria.length ? orderByFit(matchingItems, checklist.checklist.criteria, checklist.marks) : matchingItems;
  const restoreFocus = useRef<string | null>(null);
  useEffect(() => {
    const id = restoreFocus.current;
    if (!id || pending.has(id) || stale || confirmation) return;
    // A moved card is remounted under its new column. Restore lost keyboard
    // focus, but never steal it from another control used during the request.
    if (document.activeElement === document.body) (document.getElementById(`candidate-move-${id}`) ?? document.getElementById("board-filters"))?.focus();
    restoreFocus.current = null;
  }, [pending, stale, confirmation]);
  function requestMove(id: string, target: string) {
    const focused = document.activeElement;
    if (!focused?.closest('[data-slot="sheet-content"]') && (focused?.id === `candidate-move-${id}` || focused?.id === `candidate-drag-${id}` || focused?.closest('[role="menu"]'))) restoreFocus.current = id;
    state.requestMove(id, target);
  }
  function setSubstate(id: string, value: string | null) {
    if (!document.activeElement?.closest('[data-slot="sheet-content"]')) restoreFocus.current = id;
    state.setSubstate(id, value);
  }
  const selectedItem = board?.participations.find(item => item.id === selected) ?? (externalItem?.id === selected ? externalItem : undefined);
  const from = board?.stages.find(stage => stage.id === confirmation?.item.stage_id)?.name ?? "Placement";
  const to = board?.stages.find(stage => stage.id === confirmation?.target)?.name ?? "la etapa seleccionada";
  const confirming = !!confirmation && state.pending.has(confirmation.item.id);
  const dispositionDialog = !readOnly && board && state.disposition && <DispositionDialog key={`${state.disposition.kind}-${state.disposition.item.id}`} disposition={state.disposition} board={board} pending={pending.has(state.disposition.item.id)} stale={stale} reading={state.reading} notice={state.notices[state.disposition.item.id]} onClose={state.closeDisposition} onConfirm={state.confirmDisposition} finalFocus={() => document.getElementById(`${selectedItem ? "candidate-disposition" : "candidate-move"}-${state.disposition!.item.id}`)} />;
  const placementDialog = !readOnly && confirmation && <ConfirmActionDialog icon={confirmation.placementExit ? BadgeCheck : ArrowRightLeft} open onOpenChange={open => { if (!open) state.closeConfirmation(); }}
    finalFocus={() => document.getElementById(`${selectedItem ? "candidate-sheet-move" : "candidate-move"}-${confirmation.item.id}`)}
    title={`¿Mover a ${confirmation.item.candidate.full_name} a ${to}?`}
    description={`Pasa de ${from} a ${to}. El cambio queda en su historial.${confirmation.placementExit ? " Las plazas cubiertas disminuyen en una y se conserva el historial de contratación." : ""}`}
    confirmLabel="Mover" pendingLabel="Moviendo…" pending={confirming} confirmDisabled={state.reading || stale} onConfirm={state.confirmMove}>
    <ChecklistReminder item={confirmation.item} target={confirmation.target} onReview={() => { const id = confirmation.item.id; state.closeConfirmation(); setSheetTab({ id, tab: "checklist" }); setSelected(id); }} />
    {stale && <ActionStatus id="placement-check-status" tone="info" text={state.reading ? "Actualizando el tablero. Espera antes de confirmar." : "Cancela y usa Reintentar para actualizar el tablero antes de confirmar."} />}
  </ConfirmActionDialog>;
  const substate = state.substateConfirmation;
  const substateName = (id: string | null) => board?.substates.find(item => item.id === id)?.name ?? "Sin subestado";
  const substateDialog = !readOnly && substate && <ConfirmActionDialog icon={Tags} open onOpenChange={open => { if (!open) state.closeSubstateConfirmation(); }}
    finalFocus={() => document.getElementById(selectedItem ? `candidate-substate-${substate.item.id}` : `candidate-move-${substate.item.id}`)}
    title={`¿Cambiar el subestado de ${substate.item.candidate.full_name}?`} description={`Pasa de ${substateName(substate.item.substate_id)} a ${substateName(substate.value)}.`}
    confirmLabel="Cambiar subestado" pendingLabel="Cambiando subestado…" pending={pending.has(substate.item.id)} confirmDisabled={state.reading || stale} onConfirm={state.confirmSubstate} />;
  const column = state.columns.confirmation;
  const columnDialog = column && <ConfirmActionDialog icon={Columns3} open onOpenChange={open => { if (!open) state.columns.closeConfirmation(); }}
    finalFocus={() => document.getElementById(`column-menu-${column.key}`)}
    title={`¿Mover la columna ${column.name}?`} description="Ningún candidato cambia de columna. El nuevo orden aplica a los próximos movimientos."
    confirmLabel="Mover columna" pendingLabel="Moviendo columna…" pending={state.columns.busy} confirmDisabled={state.reading || stale} onConfirm={() => void state.columns.confirmMove()}>
    <p className="text-sm">Queda {column.position}.</p>
    <ImpactDetails preview={column.preview} baseline={column.next.baseline} />
  </ConfirmActionDialog>;
  return <section aria-label="Tablero de candidatos" className="flex min-h-0 min-w-0 flex-1 flex-col gap-4" aria-busy={state.reading}>
    <div className="flex shrink-0 flex-col items-start justify-between gap-4 pb-2 lg:flex-row lg:items-center">
      <div className="flex flex-col gap-1.5"><h2 className="text-xl font-semibold tracking-tight">Pipeline</h2>{board ? <BoardLifecycle lifecycle={board.lifecycle} publishedAt={publishedAt} /> : publishedAt && <p className="text-xs text-muted-foreground">Publicada el <MovementDate value={publishedAt} /></p>}</div>
      <div className="flex w-full flex-wrap items-center gap-4 lg:w-auto">{board && !readOnly && board.lifecycle.publication !== null && <Button id="manual-intake-open" type="button" className="min-h-10" disabled={stale || state.reading || pending.size > 0 || state.columns.busy} onClick={() => setIntake(true)}><UserPlus aria-hidden="true" data-icon="inline-start" />Agregar candidato</Button>}{board && board.lifecycle.allowed_actions.some(action => action !== "publish") && <LifecycleActionsMenu coverage={board.coverage} draftId={vacancyId} title={vacancyTitle ?? "la vacante"} onChanged={state.updateLifecycle} />}{board && <div role="group" aria-label="Progreso de la vacante" className="flex min-w-0 flex-wrap items-start gap-4"><BoardCoverage coverage={board.coverage} /><Separator orientation="vertical" className="hidden sm:block" /><BoardDelivery delivery={board.delivery} status={state.deliveryStatus} finished={readOnly} /></div>}<Hint text="Configuración de la vacante"><Button nativeButton={false} role="link" variant="outline" size="icon" className="size-10 bg-card" aria-label="Configuración de la vacante" render={<Link href={`/empresa/vacantes/${vacancyId}/configuracion/columnas`} />}><Settings2 aria-hidden="true" /></Button></Hint></div>
    </div>
    {readOnly && <ActionStatus id="board-process-finished" tone="info" text={`El proceso de esta vacante finalizó. El tablero está en solo lectura${board.lifecycle.allowed_actions.includes("reopen") ? "; reábrela para volver a editarlo." : "."}`} />}
    {!board && state.reading && !state.failure && <BoardSkeleton columnCount={state.columns.editor ? state.columns.editor.stages.length + 1 : undefined} />}
    {state.failure && <BoardError failure={state.failure} reading={state.reading} notice={state.readNotice} retry={() => void state.retry()} />}
    {!state.failure && state.readNotice && <ActionStatusSlot><ActionStatus id="board-read-status" tone={state.readNotice.tone} text={state.readNotice.text} /></ActionStatusSlot>}
    {state.stale && state.reading && !state.columns.busy && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner aria-hidden="true" />Comprobando el estado del tablero…</p>}
    {board && <>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground"><UsersRound aria-hidden="true" className="size-4" /><span><strong className="font-medium text-foreground tabular-nums">{board.participations.length}</strong> {plural(board.participations.length, "candidato", "candidatos").split(" ")[1]} en el pipeline</span></p>
        <div className="ml-auto flex min-w-0 flex-wrap items-center gap-3"><ActionStatusSlot>
          {state.columns.busy ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner aria-hidden="true" />{state.columns.pending === "preview" ? "Revisando el impacto…" : "Guardando y actualizando columnas…"}</p> : state.columns.notice ? <ActionStatus id="column-order-status" tone={state.columns.notice.tone} text={state.columns.notice.text} action={state.columns.notice.link && <Link className="inline-flex min-h-10 items-center underline" href={state.columns.notice.link.href}>{state.columns.notice.link.title}</Link>} /> : state.columns.unavailable ? <p className="text-sm text-muted-foreground">No pudimos cargar el orden de columnas.</p> : !state.columns.locked && <span className="hidden items-center gap-1.5 text-[11px] text-muted-foreground lg:flex"><GripVertical aria-hidden="true" className="size-3.5" />Reordena columnas y revisa el impacto antes de guardar</span>}
        </ActionStatusSlot>{state.columns.unavailable && <Button type="button" variant="outline" className="min-h-10" disabled={state.columns.busy} onClick={() => void state.columns.refresh()}>Actualizar columnas</Button>}</div>
      </div>
      <BoardFilters items={board.participations} dimensions={dimensions} selection={filters} onChange={setFilters} resultCount={visibleItems.length} toolbar={<><ChecklistRetry />{checklist.checklist?.criteria.length ? <Button type="button" variant={bestFit ? "secondary" : "outline"} className="min-h-10" aria-pressed={bestFit} onClick={() => setBestFit(value => !value)}>Ordenar: Mejor ajuste</Button> : null}<ChecklistComparison vacancyId={vacancyId} /></>} />
      <BoardColumns visibleItems={visibleItems} filtered={activeFilterCount(filters) > 0} onSubstate={setSubstate} columnOrder={state.columns} board={board} pending={state.pending} locked={readOnly || state.stale || state.columns.busy || !!confirmation || !!substate || !!column || !!state.disposition} notices={state.notices} onMove={requestMove} onDetail={setSelected} onDisposition={state.requestDisposition} />
      {Object.entries(state.notices).filter(([id]) => !visibleItems.some(item => item.id === id)).map(([id, notice]) => <ActionStatusSlot key={id}><ActionStatus id={`move-status-${id}`} tone={notice.tone} text={notice.text} /></ActionStatusSlot>)}
      {selectedItem && <CandidateSheet vacancyId={vacancyId} vacancyTitle={vacancyTitle} item={selectedItem} board={board} tabRequest={sheetTab?.id === selectedItem.id ? sheetTab : undefined} onClose={() => { setSelected(null); setSheetTab(undefined); }} onSubstate={setSubstate} onMove={requestMove} onDisposition={state.requestDisposition} locked={readOnly || stale || state.columns.busy || !!column || pending.has(selectedItem.id) || !!confirmation || !!substate || !!state.disposition} notice={state.notices[selectedItem.id]}>{dispositionDialog}{placementDialog}{substateDialog}</CandidateSheet>}
      {intake && <ManualIntakeSheet vacancyId={vacancyId} stages={board.stages} disabled={readOnly || stale} onClose={() => setIntake(false)} onSuccess={value => { state.addCandidate(value); setFilters({}); }} onViewExisting={async id => {
        const known = board.participations.find(item => item.id === id);
        if (known) { setSelected(id); setIntake(false); return; }
        const result = await loadParticipationAction(vacancyId, id);
        if (result.ok) { setExternalItem(result.data); setSelected(id); setIntake(false); }
      }} />}
      {!selectedItem && dispositionDialog}
    </>}
    {!selectedItem && placementDialog}
    {!selectedItem && substateDialog}
    {!readOnly && columnDialog}
  </section>;
}
