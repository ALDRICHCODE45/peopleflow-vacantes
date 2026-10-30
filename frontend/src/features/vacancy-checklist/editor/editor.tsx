"use client";
import { useEffect, useRef, useState } from "react";
import { Bell, Check, ListChecks, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useLanguageCatalog } from "@/features/languages/use-language-catalog";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ActionBar, ActionStatus } from "@/components/feedback/action-status";
import { notifyActionResult } from "@/components/feedback/notify";
import { ConfigReadOnlyNotice, useConfigLifecycle } from "@/features/employer-vacancies/vacancy-config/lifecycle";
import type { DraftPipelineStage } from "@/features/jobs/drafts/pipeline/client";
import type { ScreeningQuestionV2 } from "@/features/jobs/drafts/screening-v2/model";
import type { Lifecycle } from "@/features/vacancy-lifecycle/model";
import { loadChecklistAction, saveChecklistAction } from "../actions";
import { checklistBodySchema, criterionSchema, updateCriterionIdentity, type Checklist, type ChecklistBody, type Criterion, type Result } from "../model";
import { suggestCriteria, type SuggestionFields } from "../suggest";
import { CriterionFields, KIND_LABELS } from "./criterion-dialog";
import { CriteriaRows, CriterionMenu, applyCriterionAction } from "./rows";
import { failureNotice, fieldErrors, type Notice } from "./feedback";
export type ChecklistEditorProps = { draftId: string; checklist: Checklist; etag: string; stages: DraftPipelineStage[]; fields: SuggestionFields; questions: ScreeningQuestionV2[]; lifecycle?: Lifecycle; languageName?: (code: string) => string };
const bodyOf = (checklist: Checklist): ChecklistBody => ({ criteria: checklist.criteria, reminder_stage_ids: checklist.reminder_stage_ids });
/** Normalize schema key order/scalars: GET and PUT can have different object insertion order. */
const equal = (a: ChecklistBody, b: ChecklistBody) => {
  const left = checklistBodySchema.safeParse(a);
  const right = checklistBodySchema.safeParse(b);
  return left.success && right.success && JSON.stringify(left.data) === JSON.stringify(right.data);
};
const noResponse = (): Result<Checklist> => ({ ok: false, reason: "no_response", reference: {} });
/** Independent full-replacement save with opaque ETag, explicit read-only recovery, never PUT replay. */
export function ChecklistEditor({ draftId, checklist, etag: initialEtag, stages, fields, questions, lifecycle, languageName }: ChecklistEditorProps) {
  const { readOnly: lifecycleReadOnly } = useConfigLifecycle(lifecycle);
  const [finished, setFinished] = useState(false);
  const readOnly = lifecycleReadOnly || finished;
  const [baseline, setBaseline] = useState(() => bodyOf(checklist));
  const [body, setBody] = useState<ChecklistBody>(() => ({ criteria: checklist.criteria, reminder_stage_ids: checklist.version === "0" ? stages.filter(stage => stage.kind !== "new").map(stage => stage.id) : checklist.reminder_stage_ids }));
  const [etag, setEtag] = useState(initialEtag);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [errors, setErrors] = useState<{ rows: Record<number, string>; reminders?: string }>({ rows: {} });
  const [selected, setSelected] = useState(0);
  const catalog = useLanguageCatalog();
  const resolveLanguage = languageName ?? ((code: string) => catalog.data?.items.find(item => item.code === code)?.name ?? code);
  // Resolve only recognized generated labels for display; custom labels and stored data stay intact.
  function displayCriterion(criterion: Criterion): Criterion {
    if (criterion.kind !== "language") return criterion;
    const { code, min_level } = criterion.params;
    const generated = [`Idioma ${code}: mínimo ${min_level}`, `Idioma: ${code} · mínimo ${min_level}`];
    return generated.includes(criterion.label) ? { ...criterion, label: `Idioma: ${resolveLanguage(code)} · mínimo ${min_level}` } : criterion;
  }
  const [pending, setPending] = useState(false);
  const [recovery, setRecovery] = useState<"reload" | "check" | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const dirty = !equal(body, baseline);
  function report(next: Notice, reference?: { status?: number; code?: string }) {
    setNotice(next);
    notifyActionResult({ key: "checklist-save", type: next.tone, title: next.title, description: next.description, ...(next.tone === "error" ? { reference: { ...reference, at: new Date().toISOString() } } : {}) });
  }
  function edit(next: ChecklistBody) { if (busy.current || readOnly || recovery) return; setBody(next); setErrors({ rows: {} }); setNotice(null); }
  function focusDetail() {
    requestAnimationFrame(() => {
      const detail = root.current?.querySelector<HTMLElement>('#checklist-detail');
      detail?.focus();
      if (window.matchMedia?.('(max-width: 1023px)').matches) detail?.scrollIntoView?.({ block: "start", behavior: "instant" });
    });
  }
  function focusError(next: { rows: Record<number, string>; reminders?: string }) {
    const first = Object.keys(next.rows).map(Number).sort((a, b) => a - b)[0];
    if (first !== undefined) { setSelected(first); focusDetail(); }
    else requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
  }
  function add() {
    if (disabled || body.criteria.length >= 50) return;
    edit({ ...body, criteria: [...body.criteria, { id: crypto.randomUUID(), kind: "manual", params: {}, label: "", importance: "required" }] });
    setSelected(body.criteria.length); focusDetail();
  }
  async function persist() {
    if (busy.current || readOnly || recovery || !dirty) return;
    const parsed = checklistBodySchema.safeParse(body);
    if (!parsed.success) {
      const rows: Record<number, string> = {};
      for (const issue of parsed.error.issues) if (issue.path[0] === "criteria" && typeof issue.path[1] === "number") rows[issue.path[1]] = "Revisa este criterio";
      setErrors({ rows }); report(failureNotice("validation_error")); focusError({ rows }); return;
    }
    // Drafts may be incomplete between keystrokes. Apply the existing identity invariant only after validation.
    const candidate = { ...parsed.data, criteria: parsed.data.criteria.map(criterion => {
      const previous = baseline.criteria.find(item => item.id === criterion.id);
      return previous ? updateCriterionIdentity(previous, criterion) : criterion;
    }) };
    setBody(candidate);
    busy.current = true; setPending(true);
    const result = await saveChecklistAction({ vacancyId: draftId, ifMatch: etag, body: candidate }).catch(noResponse);
    if (!mounted.current) return;
    if (result.ok && result.etag) {
      const saved = bodyOf(result.data); setBody(saved); setBaseline(saved); setEtag(result.etag); setErrors({ rows: {} }); report({ tone: "success", title: "Checklist guardado", description: "Los criterios se contrastan con todos los candidatos del proceso." });
    } else {
      const failure = result.ok ? { ...noResponse(), reason: "unrecognized_response" as const } : result;
      const next = failureNotice(failure.reason);
      if (failure.reason === "process_finished") setFinished(true);
      setRecovery(next.recovery ?? null);
      if (!failure.ok && failure.reason === "validation_error") { const mapped = fieldErrors(failure.fields ?? []); setErrors(mapped); focusError(mapped); }
      report(next, !failure.ok ? failure.reference : undefined);
    }
    busy.current = false; setPending(false);
  }
  async function recover() {
    if (busy.current || readOnly || !recovery) return;
    busy.current = true; setPending(true);
    const result = await loadChecklistAction(draftId).catch(noResponse);
    if (!mounted.current) return;
    if (!result?.ok || !result.etag) report({ tone: "error", title: "No pudimos cargar la versión guardada", description: "Tus cambios siguen aquí. Vuelve a comprobar; no se enviará otro guardado." }, result && !result.ok ? result.reference : undefined);
    else {
      const saved = bodyOf(result.data);
      if (recovery === "reload") {
        setBaseline(saved); setBody(saved); setEtag(result.etag); setRecovery(null); setErrors({ rows: {} }); report({ tone: "info", title: "Versión actual cargada", description: "El editor muestra el checklist guardado actualmente." });
      } else if (equal(saved, body)) {
        setBaseline(saved); setBody(saved); setEtag(result.etag); setRecovery(null); report({ tone: "success", title: "Checklist guardado" });
      } else if (equal(saved, baseline) && result.etag === etag) {
        setRecovery(null); report({ tone: "info", title: "No se guardó el checklist", description: "Tus cambios siguen aquí. Puedes guardar de nuevo; es seguro." });
      } else { setRecovery("reload"); report(failureNotice("version_conflict")); }
    }
    busy.current = false; setPending(false);
  }
  const disabled = pending || readOnly || !!recovery;
  const index = Math.min(selected, Math.max(0, body.criteria.length - 1));
  const criteria = body.criteria.map(displayCriterion);
  const criterion = criteria[index];
  const required = criteria.filter(item => item.importance === "required").length;
  const summary = `${required} obligatorios · ${criteria.length - required} deseables`;
  const detailErrors: Record<string, string> = {};
  if (criterion && errors.rows[index]) {
    const parsed = criterionSchema.safeParse(criterion);
    if (!parsed.success) for (const issue of parsed.error.issues) detailErrors[String(issue.path.at(-1))] = "Revisa este dato";
  }
  return <div ref={root} className="flex min-w-0 flex-col gap-5 [&_[data-slot=button]]:min-h-10">
    <header className="flex items-start justify-between gap-3"><div><h3 id="checklist-heading" className="text-xl font-semibold">Checklist</h3><p className="text-sm text-muted-foreground">Define lo obligatorio y lo deseable. Solo lo ve tu equipo; nunca rechaza ni mueve candidatos.</p></div><Badge variant="neutral">{criteria.length} criterios</Badge></header>
    {readOnly && <ConfigReadOnlyNotice />}
    <Card role="region" aria-labelledby="checklist-reminders-title">
      <CardHeader className="border-b"><CardTitle><h4 id="checklist-reminders-title" className="flex items-center gap-2"><Bell aria-hidden="true" className="size-4" />Recordatorio al mover</h4></CardTitle><CardDescription>Te recordaremos los criterios obligatorios sin evaluar al mover a estas etapas. Puedes continuar sin marcarlos.</CardDescription><CardAction><Badge variant="neutral">{body.reminder_stage_ids.length} {body.reminder_stage_ids.length === 1 ? "etapa" : "etapas"}</Badge></CardAction></CardHeader>
      <CardContent><FieldSet disabled={disabled}><FieldLegend className="sr-only">Etapas con recordatorio</FieldLegend><FieldGroup data-slot="checkbox-group" className="flex-row flex-wrap gap-2">
        {stages.map(stage => <Field key={stage.id} orientation="horizontal" data-invalid={!!errors.reminders} className="w-auto"><FieldLabel className="min-h-10 rounded-xl border px-3 has-data-checked:border-primary/40 has-data-checked:bg-primary/10"><Checkbox id={`reminder-${stage.id}`} disabled={disabled} checked={body.reminder_stage_ids.includes(stage.id)} aria-invalid={!!errors.reminders} aria-describedby={errors.reminders ? "reminders-error" : undefined} onCheckedChange={checked => edit({ ...body, reminder_stage_ids: checked ? [...body.reminder_stage_ids, stage.id] : body.reminder_stage_ids.filter(id => id !== stage.id) })} />{stage.name}</FieldLabel></Field>)}
      </FieldGroup>{errors.reminders && <FieldError id="reminders-error">{errors.reminders}</FieldError>}</FieldSet></CardContent>
    </Card>
    <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(20rem,1fr)_minmax(0,1.2fr)]">
    <Card aria-labelledby="checklist-master-title">
      <CardHeader className="border-b"><CardTitle><h4 id="checklist-master-title" className="flex items-center gap-2"><ListChecks aria-hidden="true" className="size-4" />Criterios</h4></CardTitle><CardDescription>{summary}</CardDescription><CardAction><Button type="button" variant="outline" disabled={disabled || criteria.length >= 50} onClick={add}><Plus aria-hidden="true" />Agregar</Button></CardAction></CardHeader>
      <CardContent><FieldGroup>
        {body.criteria.length === 0 && <Empty><EmptyHeader><EmptyMedia variant="icon"><ListChecks aria-hidden="true" /></EmptyMedia><EmptyTitle>Todavía no tienes criterios</EmptyTitle><EmptyDescription>Este checklist es interno, nunca es público y se contrasta automáticamente con cada candidato.</EmptyDescription></EmptyHeader><EmptyContent className="flex-col sm:flex-row"><Button type="button" className="min-h-10" disabled={disabled} onClick={() => { const criteria = suggestCriteria(fields, questions, resolveLanguage); edit({ ...body, criteria }); if (!criteria.length) report({ tone: "info", title: "No encontramos criterios para sugerir", description: "Agrega un criterio o completa los requisitos de la vacante." }); }}>Sugerir desde la vacante</Button><Button type="button" variant="outline" className="min-h-10" disabled={disabled} onClick={add}>Agregar criterio</Button></EmptyContent></Empty>}
        {!!criteria.length && <CriteriaRows criteria={criteria} errors={errors.rows} selected={index} onSelect={next => { setSelected(next); if (window.matchMedia?.('(max-width: 1023px)').matches) focusDetail(); }} />}
      </FieldGroup></CardContent>
      <CardFooter className="border-t text-xs text-muted-foreground">Hasta 50 criterios. Se contrastan con cada candidato.</CardFooter>
    </Card>
    {criterion && <Card id="checklist-detail" role="region" aria-label="Detalle del criterio" tabIndex={-1} className="min-w-0 scroll-mt-5 outline-none focus-visible:ring-3 focus-visible:ring-ring/30">
      <CardHeader className="border-b"><CardTitle><h4 className="flex items-center gap-2"><Check aria-hidden="true" className="size-4 shrink-0" />{criterion.label || "Nuevo criterio"}</h4></CardTitle><CardDescription>Criterio {index + 1} de {criteria.length} · {KIND_LABELS[criterion.kind]}</CardDescription><CardAction><CriterionMenu criterion={criterion} index={index} length={criteria.length} disabled={disabled} onAction={action => {
        if (disabled) return;
        edit({ ...body, criteria: applyCriterionAction(body.criteria, index, action) });
        setSelected(action === "remove" ? Math.max(0, Math.min(index, criteria.length - 2)) : index + (action === "up" ? -1 : 1));
      }} /></CardAction></CardHeader>
      <CardContent><FieldSet disabled={disabled}><FieldLegend className="sr-only">Editar criterio</FieldLegend><FieldGroup>
        <Field><FieldLabel>Importancia</FieldLabel><ToggleGroup variant="segmented" aria-label={`Importancia: ${criterion.label}`} value={[criterion.importance]} disabled={disabled} onValueChange={values => { const importance = values[0]; if (importance === "required" || importance === "desirable") edit({ ...body, criteria: body.criteria.map((item, i) => i === index ? { ...item, importance } : item) }); }}><ToggleGroupItem value="required">Obligatorio</ToggleGroupItem><ToggleGroupItem value="desirable">Deseable</ToggleGroupItem></ToggleGroup></Field>
        <CriterionFields draft={criterion} questions={questions} errors={detailErrors} onChange={next => edit({ ...body, criteria: body.criteria.map((item, i) => i === index ? next : item) })} />
      </FieldGroup></FieldSet></CardContent>
      <CardFooter className="border-t text-xs text-muted-foreground">{criterion.kind === "manual" ? "Lo marcas tú" : criterion.kind === "skill" ? "Se evalúa solo si el candidato la declara" : "Se evalúa solo"}. {criterion.importance === "required" ? "Los obligatorios sin evaluar se recuerdan al mover." : "Los deseables suman al ajuste; nunca bloquean."}</CardFooter>
    </Card>}
    </div>
    <Card role="region" aria-label="Guardar checklist" size="sm" className="sticky bottom-3 z-10"><CardContent className="[&_[data-pf-action-bar]]:max-sm:flex-wrap [&_[data-pf-action-bar-actions]]:max-sm:w-full [&_[data-pf-action-bar]>div:last-child]:max-sm:basis-full"><ActionBar status={<div className="flex flex-col gap-2"><p className="text-sm font-medium">{summary}</p>{notice ? <ActionStatus id="checklist-save-status" tone={notice.tone} text={notice.title} action={recovery && <Button type="button" variant="outline" className="min-h-10" disabled={pending} onClick={() => void recover()}>{recovery === "reload" ? "Cargar versión actual" : "Comprobar"}</Button>} /> : <span className="text-xs text-muted-foreground max-sm:sr-only">{dirty ? "Cambios sin guardar" : "No hay cambios pendientes."}</span>}</div>}> 
        <Button type="button" variant="ghost" className="min-h-10" disabled={!dirty || disabled} onClick={() => edit(baseline)}>Descartar cambios</Button>
        <Button type="button" className="min-h-10" disabled={!dirty || disabled} aria-describedby={notice ? "checklist-save-status" : undefined} aria-busy={pending} onClick={() => void persist()}>{pending && <Spinner aria-hidden="true" data-icon="inline-start" />}{pending ? "Guardando…" : "Guardar cambios"}</Button>
      </ActionBar></CardContent></Card>
  </div>;
}
