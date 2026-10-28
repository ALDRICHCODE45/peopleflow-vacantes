"use client";
import { useState } from "react";
import Link from "next/link";
import { Check, CircleHelp, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { Item, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { ActionStatus, ActionStatusSlot } from "@/components/feedback/action-status";
import type { Participation } from "@/features/pipeline-movement/model";
import { MovementDate } from "@/features/pipeline-movement/board-states";
import { evaluateCriterion, resultLabel, sourceLabel, summarize } from "../evaluate";
import type { Criterion, Mark } from "../model";
import { fitLine, fitTone, pendingRequired } from "./fit";
import { useBoardChecklist } from "./state";

export function ChecklistRetry() {
  const state = useBoardChecklist();
  return state?.failed ? <Button type="button" variant="ghost" disabled={state.reading} onClick={state.retry}>Reintentar checklist</Button> : null;
}
export function ChecklistFit({ item }: { item: Participation }) {
  const state = useBoardChecklist();
  if (!state?.checklist?.criteria.length) return null;
  const fit = summarize(state.checklist.criteria, item, state.marks);
  return <Badge variant={fitTone(fit)} className="whitespace-normal" aria-label={`Ajuste al checklist: ${fitLine(fit)}`}>{fitLine(fit)}</Badge>;
}
function CriterionRow({ criterion, item, inline = false }: { criterion: Criterion; item: Participation; inline?: boolean }) {
  const state = useBoardChecklist()!;
  const mark = state.marks.find(mark => mark.participation_id === item.id && mark.criterion_id === criterion.id);
  return <CriterionEditor key={`${criterion.id}:${mark?.note ?? ""}`} criterion={criterion} item={item} mark={mark} inline={inline} />;
}
function CriterionEditor({ criterion, item, mark, inline }: { criterion: Criterion; item: Participation; mark?: Mark; inline: boolean }) {
  const state = useBoardChecklist()!;
  const [note, setNote] = useState(mark?.note ?? "");
  const evaluation = evaluateCriterion(criterion, item, mark);
  const source = sourceLabel(evaluation, criterion);
  const Icon = evaluation.result === "met" ? Check : evaluation.result === "not_met" ? X : CircleHelp;
  const tooLong = [...note.trim()].length > 500;
  const disabled = state.disabled || state.pending.has(`${item.id}:${criterion.id}`);
  const suffix = inline ? " antes de mover" : "";
  return <Item variant="outline" size="sm"><ItemContent>
    <ItemTitle>{criterion.label} <Badge variant="secondary">{criterion.importance === "required" ? "Obligatorio" : "Deseable"}</Badge></ItemTitle>
    <ItemDescription><span className="inline-flex items-center gap-1"><Icon className="size-4" aria-hidden="true" />{resultLabel(evaluation.result)}</span>{source && <> · {source}{mark && <> · {mark.marked_by.full_name} · <MovementDate value={mark.marked_at} withTime /></>}</>}</ItemDescription>
    {!inline && <Field data-invalid={tooLong || undefined}>
      <FieldLabel htmlFor={`checklist-note-${criterion.id}`}>Nota de {criterion.label}</FieldLabel>
      <Textarea id={`checklist-note-${criterion.id}`} value={note} disabled={disabled} aria-invalid={tooLong} aria-describedby={`checklist-note-help-${criterion.id}`} onChange={event => setNote(event.target.value)} />
      <FieldDescription id={`checklist-note-help-${criterion.id}`}>Opcional, hasta 500 caracteres. Se guarda al marcar un resultado.</FieldDescription>
      {tooLong && <FieldError>La nota no puede superar 500 caracteres.</FieldError>}
    </Field>}
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" className="min-h-10" aria-label={`Marcar cumple${suffix}: ${criterion.label}`} aria-pressed={mark?.verdict === "met"} disabled={disabled || tooLong} onClick={() => void state.update(item.id, criterion.id, { verdict: "met", note: note.trim() || null })}><Check aria-hidden="true" />Cumple</Button>
      <Button type="button" variant="outline" className="min-h-10" aria-label={`Marcar no cumple${suffix}: ${criterion.label}`} aria-pressed={mark?.verdict === "not_met"} disabled={disabled || tooLong} onClick={() => void state.update(item.id, criterion.id, { verdict: "not_met", note: note.trim() || null })}><X aria-hidden="true" />No cumple</Button>
      {mark && !inline && <Button type="button" variant="ghost" className="min-h-10" aria-label={`Quitar marca: ${criterion.label}`} disabled={disabled} onClick={() => void state.update(item.id, criterion.id, null)}>Quitar marca</Button>}
    </div>
  </ItemContent></Item>;
}
function WriteStatus({ id }: { id: string }) {
  const state = useBoardChecklist()!;
  return <ActionStatusSlot>{state.notice ? <ActionStatus id={id} tone={state.notice.tone} text={state.notice.text} /> : state.disabled ? <ActionStatus id={id} tone="info" text="El proceso finalizó. Las marcas están en solo lectura." /> : null}</ActionStatusSlot>;
}
export function ChecklistPanel({ item }: { item: Participation }) {
  const state = useBoardChecklist();
  if (!state?.checklist?.criteria.length) return null;
  return <section aria-label="Checklist del candidato" className="flex flex-col gap-4"><p className="text-sm text-muted-foreground">Evaluación interna. Las marcas del reclutador prevalecen sobre el resultado automático.</p><WriteStatus id="checklist-write-status" />{state.checklist.criteria.map(criterion => <CriterionRow key={criterion.id} criterion={criterion} item={item} />)}</section>;
}
export function ChecklistReminder({ item, target }: { item: Participation; target: string }) {
  const state = useBoardChecklist();
  if (!state?.checklist) return null;
  const pending = pendingRequired(state.checklist.criteria, item, state.marks, state.checklist.reminder_stage_ids, target);
  if (!pending.length) return null;
  return <section aria-label="Antes de mover" className="flex flex-col gap-3"><h3 className="text-sm font-semibold">Antes de mover</h3><p className="text-sm text-muted-foreground">Estos obligatorios siguen sin evaluar. Puedes mover sin marcarlos.</p><WriteStatus id="checklist-reminder-status" />{pending.map(criterion => <CriterionRow key={criterion.id} criterion={criterion} item={item} inline />)}</section>;
}
export function ChecklistSelection({ item }: { item: Participation }) {
  const state = useBoardChecklist();
  if (!state?.checklist?.criteria.length) return null;
  const selected = state.selection.includes(item.id);
  return <Button type="button" variant="ghost" className="min-h-10" aria-label={`Seleccionar para comparar: ${item.candidate.full_name}`} aria-pressed={selected} disabled={!selected && state.selection.length >= 5} onClick={() => state.select(item.id)}>{selected ? "Seleccionado para comparar" : "Comparar"}</Button>;
}
export function ChecklistComparison({ vacancyId }: { vacancyId: string }) {
  const state = useBoardChecklist();
  if (!state?.checklist?.criteria.length || !state.selection.length) return null;
  return <div className="flex flex-wrap items-center gap-3"><p className="text-sm text-muted-foreground">{state.selection.length} de 5 seleccionados · Elige entre 2 y 5 candidatos</p>{state.selection.length >= 2 && <Link className={buttonVariants({ variant: "outline" })} href={`/empresa/vacantes/${vacancyId}/pipeline/comparar?ids=${state.selection.join(",")}`}>Comparar {state.selection.length} candidatos</Link>}</div>;
}
