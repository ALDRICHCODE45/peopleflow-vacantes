"use client";
import { Fragment, useState } from "react";
import Link from "next/link";
import { Check, CircleHelp, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "cn";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { Item, ItemActions, ItemContent, ItemDescription, ItemFooter, ItemGroup, ItemSeparator, ItemTitle } from "@/components/ui/item";
import { ActionStatus } from "@/components/feedback/action-status";
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
  const required = fit.required.met + fit.required.not_met + fit.required.unknown;
  const unknown = fit.required.unknown + fit.desirable.unknown;
  const tone = fitTone(fit);
  // The icon follows the tone: a check only when every required criterion is met.
  const FitIcon = tone === "success" ? Check : tone === "review" ? X : CircleHelp;
  return <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1" aria-label={`Ajuste al checklist: ${fitLine(fit)}`}>
    <Badge variant={tone}><FitIcon aria-hidden="true" data-icon="inline-start" data-fit-icon={tone} />{fit.required.met}/{required} obligatorios</Badge>
    {unknown > 0 && <span className="text-xs text-muted-foreground">{unknown} sin evaluar</span>}
  </div>;
}
function CriterionRow({ criterion, item, inline = false }: { criterion: Criterion; item: Participation; inline?: boolean }) {
  const state = useBoardChecklist()!;
  const mark = state.marks.find(mark => mark.participation_id === item.id && mark.criterion_id === criterion.id);
  return <CriterionEditor key={`${criterion.id}:${mark?.note ?? ""}`} criterion={criterion} item={item} mark={mark} inline={inline} />;
}
function CriterionEditor({ criterion, item, mark, inline }: { criterion: Criterion; item: Participation; mark?: Mark; inline: boolean }) {
  const state = useBoardChecklist()!;
  const [note, setNote] = useState(mark?.note ?? "");
  const [editingNote, setEditingNote] = useState(false);
  const evaluation = evaluateCriterion(criterion, item, mark);
  const source = sourceLabel(evaluation, criterion);
  const Icon = evaluation.result === "met" ? Check : evaluation.result === "not_met" ? X : CircleHelp;
  const tooLong = [...note.trim()].length > 500;
  const disabled = state.disabled || state.pending.has(`${item.id}:${criterion.id}`);
  const suffix = inline ? " antes de mover" : "";
  const noteId = `checklist-note-${criterion.id}`;
  return <Item size="xs" className={inline ? "flex-nowrap" : undefined} data-checklist-row>
    <ItemContent className="min-w-0">
      <ItemTitle className="w-full line-clamp-none"><span className={inline ? "truncate" : "line-clamp-2 break-words"} title={criterion.label}>{criterion.label}</span></ItemTitle>
      {!inline && <>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={evaluation.result === "met" ? "success" : evaluation.result === "not_met" ? "review" : "neutral"}><Icon aria-hidden="true" data-icon="inline-start" />{resultLabel(evaluation.result)}</Badge>
          {source && <span className="text-xs text-muted-foreground">{source}{mark && <> · {mark.marked_by.full_name} · <MovementDate value={mark.marked_at} withTime /></>}</span>}
        </div>
        {mark?.note && !editingNote && <ItemDescription className="line-clamp-none whitespace-pre-wrap break-words">{mark.note}</ItemDescription>}
      </>}
    </ItemContent>
    <ItemActions>
      <Button type="button" variant="outline" size="icon" className="size-10" aria-label={`Marcar cumple${suffix}: ${criterion.label}`} aria-pressed={mark?.verdict === "met"} disabled={disabled || tooLong} onClick={() => void state.update(item.id, criterion.id, { verdict: "met", note: note.trim() || null })}><Check aria-hidden="true" /></Button>
      <Button type="button" variant="outline" size="icon" className="size-10" aria-label={`Marcar no cumple${suffix}: ${criterion.label}`} aria-pressed={mark?.verdict === "not_met"} disabled={disabled || tooLong} onClick={() => void state.update(item.id, criterion.id, { verdict: "not_met", note: note.trim() || null })}><X aria-hidden="true" /></Button>
    </ItemActions>
    {!inline && <ItemFooter className="basis-full flex-wrap justify-start">
      {/* Controlled disclosure: Button exposes its expanded state and the associated note Field. */}
      <Button type="button" variant="ghost" className="min-h-10" aria-expanded={editingNote} aria-controls={noteId} aria-label={`${mark?.note ? "Editar nota" : "Agregar nota"}: ${criterion.label}`} onClick={() => setEditingNote(value => !value)}>{mark?.note ? "Editar nota" : "Agregar nota"}</Button>
      {mark && <Button type="button" variant="ghost" className="min-h-10" aria-label={`Quitar marca: ${criterion.label}`} disabled={disabled} onClick={() => void state.update(item.id, criterion.id, null)}>Quitar marca</Button>}
      {editingNote && <Field data-invalid={tooLong || undefined}>
        <FieldLabel htmlFor={noteId}>Nota de {criterion.label}</FieldLabel>
        <Textarea id={noteId} value={note} disabled={disabled} aria-invalid={tooLong} aria-describedby={`${noteId}-help`} onChange={event => setNote(event.target.value)} />
        <FieldDescription id={`${noteId}-help`}>Opcional, hasta 500 caracteres. Se guarda al marcar un resultado.</FieldDescription>
        {tooLong && <FieldError>La nota no puede superar 500 caracteres.</FieldError>}
      </Field>}
    </ItemFooter>}
  </Item>;
}
function WriteStatus({ id }: { id: string }) {
  const state = useBoardChecklist()!;
  return state.notice ? <ActionStatus id={id} tone={state.notice.tone} text={state.notice.text} /> : state.disabled ? <ActionStatus id={id} tone="info" text="El proceso finalizó. Las marcas están en solo lectura." /> : null;
}
export function ChecklistPanel({ item }: { item: Participation }) {
  const state = useBoardChecklist();
  if (!state?.checklist?.criteria.length) return null;
  const fit = summarize(state.checklist.criteria, item, state.marks);
  return <section aria-label="Checklist del candidato" className="flex min-w-0 flex-col gap-3">
    <p className="text-sm text-muted-foreground">Evaluación interna. Las marcas del reclutador prevalecen sobre el resultado automático.</p>
    <p className="text-sm">{fitLine(fit)}</p>
    <p className="text-xs text-muted-foreground">{fit.required.not_met + fit.desirable.not_met} no cumple · {fit.desirable.met} deseables cumplidos</p>
    <WriteStatus id="checklist-write-status" />
    {(["required", "desirable"] as const).map(importance => {
      const criteria = state.checklist!.criteria.filter(criterion => criterion.importance === importance);
      return criteria.length > 0 && <section key={importance} className="flex min-w-0 flex-col gap-2"><h3 className="text-sm font-semibold">{importance === "required" ? "Obligatorios" : "Deseables"}</h3><ItemGroup className="gap-0">{criteria.map((criterion, index) => <Fragment key={criterion.id}>{index > 0 && <ItemSeparator className="my-0" />}<CriterionRow criterion={criterion} item={item} /></Fragment>)}</ItemGroup></section>;
    })}
  </section>;
}
export function ChecklistReminder({ item, target }: { item: Participation; target: string }) {
  const state = useBoardChecklist();
  if (!state?.checklist) return null;
  const pending = pendingRequired(state.checklist.criteria, item, state.marks, state.checklist.reminder_stage_ids, target);
  if (!pending.length) return null;
  return <section aria-label="Antes de mover" className="flex min-w-0 flex-col gap-2"><h3 className="text-sm font-semibold">Antes de mover</h3><p className="text-sm text-muted-foreground">Estos obligatorios siguen sin evaluar. Puedes mover sin marcarlos.</p><WriteStatus id="checklist-reminder-status" /><ItemGroup className="gap-0">{pending.slice(0, 5).map(criterion => <CriterionRow key={criterion.id} criterion={criterion} item={item} inline />)}</ItemGroup>{pending.length > 5 && <p className="text-xs text-muted-foreground">y {pending.length - 5} más — revísalos en la ficha del candidato</p>}</section>;
}
export function ChecklistSelection({ item }: { item: Participation }) {
  const state = useBoardChecklist();
  if (!state?.checklist?.criteria.length || !state.selecting) return null;
  const selected = state.selection.includes(item.id);
  return <Checkbox aria-label={`Seleccionar para comparar: ${item.candidate.full_name}`} checked={selected} disabled={!selected && state.selection.length >= 5} onClick={event => event.stopPropagation()} onCheckedChange={() => state.select(item.id)} />;
}
export function ChecklistComparison({ vacancyId }: { vacancyId: string }) {
  const state = useBoardChecklist();
  if (!state?.checklist?.criteria.length) return null;
  if (!state.selecting) return <Button type="button" variant="outline" className="min-h-10" onClick={state.startSelection}>Comparar candidatos</Button>;
  return <div className="flex flex-wrap items-center gap-2">{state.selection.length >= 2 && state.selection.length <= 5 ? <Link className={cn(buttonVariants({ variant: "outline" }), "min-h-10")} href={`/empresa/vacantes/${vacancyId}/pipeline/comparar?ids=${state.selection.join(",")}`}>Comparar ({state.selection.length})</Link> : <Button type="button" variant="outline" className="min-h-10" disabled>Comparar ({state.selection.length})</Button>}<Button type="button" variant="ghost" className="min-h-10" onClick={state.cancelSelection}>Cancelar</Button></div>;
}
