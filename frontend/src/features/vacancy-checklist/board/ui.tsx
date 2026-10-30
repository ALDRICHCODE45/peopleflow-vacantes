"use client";
import { Fragment, useState } from "react";
import Link from "next/link";
import { Check, CircleHelp, ListChecks, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "cn";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Item, ItemActions, ItemContent, ItemDescription, ItemFooter, ItemGroup, ItemMedia, ItemSeparator, ItemTitle } from "@/components/ui/item";
import { plural } from "@/features/employer-vacancies/plural";
import { SectionEmpty, StateCard } from "@/components/feedback/state-card";
import { Skeleton } from "@/components/ui/skeleton";
import { ActionStatus } from "@/components/feedback/action-status";
import type { Participation } from "@/features/pipeline-movement/model";
import { MovementDate } from "@/features/pipeline-movement/board-states";
import { evaluateCriterion, resultLabel, sourceLabel, summarize, type FitSummary } from "../evaluate";
import type { Criterion, Mark } from "../model";
import { fitLine, pendingRequired } from "./fit";
import { useBoardChecklist } from "./state";

export function ChecklistRetry() {
  const state = useBoardChecklist();
  return state?.failed ? <Button type="button" variant="ghost" disabled={state.reading} onClick={state.retry}>Reintentar checklist</Button> : null;
}
const SEGMENT_CLASS = { met: "bg-status-success", not_met: "bg-status-review", unknown: "bg-border" } as const;
/** One segment per criterion, cumple → no cumple → sin evaluar; past 24 they collapse into three proportional runs. */
function fitSegments(counts: { met: number; not_met: number; unknown: number }) {
  const runs = (["met", "not_met", "unknown"] as const).map(result => ({ result, count: counts[result] })).filter(run => run.count > 0);
  return counts.met + counts.not_met + counts.unknown > 24 ? runs : runs.flatMap(run => Array.from({ length: run.count }, () => ({ result: run.result, count: 1 })));
}
// Data visualized, not a status pill (§10.6, §16): label row + segmented bar, breakdown in a tooltip.
export function ChecklistFit({ item }: { item: Participation }) {
  const state = useBoardChecklist();
  if (!state?.checklist?.criteria.length) return null;
  return <ChecklistFitSummary fit={summarize(state.checklist.criteria, item, state.marks)} />;
}
/** Read-only presentation shared by board cards and comparison; no context or profile data. */
export function ChecklistFitSummary({ fit }: { fit: FitSummary }) {
  const required = fit.required.met + fit.required.not_met + fit.required.unknown;
  const desirable = fit.desirable.met + fit.desirable.not_met + fit.desirable.unknown;
  const counts = required ? fit.required : fit.desirable;
  const rows: [string, string][] = [[required ? "Obligatorios cumplidos" : "Deseables cumplidos", `${counts.met} de ${required || desirable}`], ["No cumple", String(counts.not_met)], ["Sin evaluar", String(counts.unknown)]];
  if (required && desirable) rows.push(["Deseables cumplidos", `${fit.desirable.met} de ${desirable}`]);
  return <Tooltip>
    <TooltipTrigger render={<div className="flex min-w-0 flex-col gap-1.5" aria-label={`Ajuste al checklist: ${fitLine(fit)}`} />}>
      <span className="flex min-w-0 items-center gap-1.5 text-xs"><ListChecks aria-hidden="true" className="size-3.5 shrink-0" /><span className="font-medium text-foreground">Checklist</span><span className="ml-auto tabular-nums">{counts.met}/{required || desirable} {required ? "obligatorios" : "deseables"}</span></span>
      <span aria-hidden="true" className="flex h-1.5 gap-0.5">{fitSegments(counts).map((segment, index) => <span key={index} data-segment={segment.result} className={cn("rounded-[2px]", SEGMENT_CLASS[segment.result])} style={{ flexGrow: segment.count, flexBasis: 0 }} />)}</span>
    </TooltipTrigger>
    <TooltipContent className="flex-col items-stretch gap-0.5 py-2"><span className="font-semibold">Checklist</span>{rows.map(([label, value]) => <span key={label} className="flex justify-between gap-6"><span>{label}</span><span className="tabular-nums">{value}</span></span>)}</TooltipContent>
  </Tooltip>;
}
function CriterionRow({ criterion, item }: { criterion: Criterion; item: Participation }) {
  const state = useBoardChecklist()!;
  const mark = state.marks.find(mark => mark.participation_id === item.id && mark.criterion_id === criterion.id);
  return <CriterionEditor key={`${criterion.id}:${mark?.note ?? ""}`} criterion={criterion} item={item} mark={mark} />;
}
function CriterionEditor({ criterion, item, mark }: { criterion: Criterion; item: Participation; mark?: Mark }) {
  const state = useBoardChecklist()!;
  const [note, setNote] = useState(mark?.note ?? "");
  const [editingNote, setEditingNote] = useState(false);
  const evaluation = evaluateCriterion(criterion, item, mark);
  const source = sourceLabel(evaluation, criterion);
  const Icon = evaluation.result === "met" ? Check : evaluation.result === "not_met" ? X : CircleHelp;
  const tooLong = [...note.trim()].length > 500;
  const disabled = state.disabled || state.pending.has(`${item.id}:${criterion.id}`);
  const noteId = `checklist-note-${criterion.id}`;
  return <Item size="xs" data-checklist-row>
    <ItemContent className="min-w-0">
      <ItemTitle className="w-full line-clamp-none"><span className="line-clamp-2 break-words" title={criterion.label}>{criterion.label}</span></ItemTitle>
      <>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={evaluation.result === "met" ? "success" : evaluation.result === "not_met" ? "review" : "neutral"}><Icon aria-hidden="true" data-icon="inline-start" />{resultLabel(evaluation.result)}</Badge>
          {source && <span className="text-xs text-muted-foreground">{source}{mark && <> · {mark.marked_by.full_name} · <MovementDate value={mark.marked_at} withTime /></>}</span>}
        </div>
        {mark?.note && !editingNote && <ItemDescription className="line-clamp-none whitespace-pre-wrap break-words">{mark.note}</ItemDescription>}
      </>
    </ItemContent>
    <ItemActions>
      <Button type="button" variant="outline" size="icon" className="size-10" aria-label={`Marcar cumple: ${criterion.label}`} aria-pressed={mark?.verdict === "met"} disabled={disabled || tooLong} onClick={() => void state.update(item.id, criterion.id, { verdict: "met", note: note.trim() || null })}><Check aria-hidden="true" /></Button>
      <Button type="button" variant="outline" size="icon" className="size-10" aria-label={`Marcar no cumple: ${criterion.label}`} aria-pressed={mark?.verdict === "not_met"} disabled={disabled || tooLong} onClick={() => void state.update(item.id, criterion.id, { verdict: "not_met", note: note.trim() || null })}><X aria-hidden="true" /></Button>
    </ItemActions>
    <ItemFooter className="basis-full flex-wrap justify-start">
      {/* Controlled disclosure: Button exposes its expanded state and the associated note Field. */}
      <Button type="button" variant="ghost" className="min-h-10" aria-expanded={editingNote} aria-controls={noteId} aria-label={`${mark?.note ? "Editar nota" : "Agregar nota"}: ${criterion.label}`} onClick={() => setEditingNote(value => !value)}>{mark?.note ? "Editar nota" : "Agregar nota"}</Button>
      {mark && <Button type="button" variant="ghost" className="min-h-10" aria-label={`Quitar marca: ${criterion.label}`} disabled={disabled} onClick={() => void state.update(item.id, criterion.id, null)}>Quitar marca</Button>}
      {editingNote && <Field data-invalid={tooLong || undefined}>
        <FieldLabel htmlFor={noteId}>Nota de {criterion.label}</FieldLabel>
        <Textarea id={noteId} value={note} disabled={disabled} aria-invalid={tooLong} aria-describedby={`${noteId}-help`} onChange={event => setNote(event.target.value)} />
        <FieldDescription id={`${noteId}-help`}>Opcional, hasta 500 caracteres. Se guarda al marcar un resultado.</FieldDescription>
        {tooLong && <FieldError>La nota no puede superar 500 caracteres.</FieldError>}
      </Field>}
    </ItemFooter>
  </Item>;
}
function WriteStatus({ id }: { id: string }) {
  const state = useBoardChecklist()!;
  return state.notice ? <ActionStatus id={id} tone={state.notice.tone} text={state.notice.text} /> : state.disabled ? <ActionStatus id={id} tone="info" text="El proceso finalizó. Las marcas están en solo lectura." /> : null;
}
export function ChecklistPanel({ item, vacancyId, readOnly = false }: { item: Participation; vacancyId?: string; readOnly?: boolean }) {
  const state = useBoardChecklist();
  if (!state) return null;
  if (vacancyId && state.reading && !state.checklist) return <div aria-busy="true"><span role="status" className="sr-only">Cargando checklist</span><Skeleton aria-hidden="true" className="h-32 w-full" /></div>;
  if (vacancyId && state.failed && !state.checklist) return <StateCard icon={ListChecks} tone="error" title="No pudimos cargar el checklist" description="No se modificaron los criterios ni las marcas. Puedes volver a cargar el checklist." primaryAction={{ label: "Reintentar checklist", onClick: state.retry }} />;
  if (!state.checklist) return null;
  if (!state.checklist.criteria.length) return vacancyId ? <SectionEmpty icon={ListChecks} tone="info" title="Esta vacante todavía no tiene criterios" description={readOnly || state.disabled ? "El proceso finalizó. El checklist está en solo lectura." : "Define qué revisar en cada candidato con un checklist interno. No rechaza ni mueve personas automáticamente."} primaryAction={{ label: readOnly || state.disabled ? "Ver checklist" : "Agregar criterio", href: `/empresa/vacantes/${vacancyId}/configuracion/checklist` }} /> : null;
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
/** Names the first pending criteria as a Spanish list: «A, B y C» or «A, B, C y 4 más». */
function pendingNames(pending: Criterion[]) {
  const names = pending.slice(0, 3).map(criterion => criterion.label);
  const rest = pending.length - names.length;
  if (rest > 0) return `${names.join(", ")} y ${rest} más`;
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} y ${names.at(-1)}` : names[0];
}
// A notice, not a form: the move confirmation stays light and marks live in the sheet (§13.8, §17).
export function ChecklistReminder({ item, target, onReview }: { item: Participation; target: string; onReview: () => void }) {
  const state = useBoardChecklist();
  if (!state?.checklist) return null;
  const pending = pendingRequired(state.checklist.criteria, item, state.marks, state.checklist.reminder_stage_ids, target);
  if (!pending.length) return null;
  const names = pendingNames(pending);
  // Outline item + accent medallion: a muted surface disappears in dark mode (§13.1).
  return <section aria-label="Antes de mover" className="min-w-0">
    <Item variant="outline" size="sm">
      <ItemMedia className="size-9 rounded-xl bg-primary/12 text-foreground ring-1 ring-primary/40"><ListChecks aria-hidden="true" className="size-4" /></ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle>{plural(pending.length, "obligatorio sin evaluar", "obligatorios sin evaluar")}</ItemTitle>
        <ItemDescription className="break-words" title={pending.map(criterion => criterion.label).join("\n")}>{names}.</ItemDescription>
      </ItemContent>
      <ItemFooter className="flex-wrap">
        <p className="text-xs text-muted-foreground">{pending.length === 1 ? "Puedes mover sin marcarlo." : "Puedes mover sin marcarlos."}</p>
        <Button type="button" variant="outline" className="ml-auto min-h-10" onClick={onReview}>Revisar en la ficha</Button>
      </ItemFooter>
    </Item>
  </section>;
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
