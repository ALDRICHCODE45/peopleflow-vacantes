"use client";
import { useEffect, useRef, useState } from "react";
import { ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { StateCard } from "@/components/feedback/state-card";
import { ActionBar, ActionStatus } from "@/components/feedback/action-status";
import { notifyActionResult } from "@/components/feedback/notify";
import { ConfigReadOnlyNotice, useConfigLifecycle } from "@/features/employer-vacancies/vacancy-config/lifecycle";
import type { DraftPipelineStage } from "@/features/jobs/drafts/pipeline/client";
import type { ScreeningQuestionV2 } from "@/features/jobs/drafts/screening-v2/model";
import type { Lifecycle } from "@/features/vacancy-lifecycle/model";
import { loadChecklistAction, saveChecklistAction } from "../actions";
import { checklistBodySchema, updateCriterionIdentity, type Checklist, type ChecklistBody, type Criterion, type Result } from "../model";
import { suggestCriteria, type SuggestionFields } from "../suggest";
import { CriterionDialog } from "./criterion-dialog";
import { CriteriaRows } from "./rows";
import { failureNotice, fieldErrors, type Notice } from "./feedback";
export type ChecklistEditorProps = { draftId: string; checklist: Checklist; etag: string; stages: DraftPipelineStage[]; fields: SuggestionFields; questions: ScreeningQuestionV2[]; lifecycle?: Lifecycle };
const bodyOf = (checklist: Checklist): ChecklistBody => ({ criteria: checklist.criteria, reminder_stage_ids: checklist.reminder_stage_ids });
/** Normalize schema key order/scalars: GET and PUT can have different object insertion order. */
const equal = (a: ChecklistBody, b: ChecklistBody) => {
  const left = checklistBodySchema.safeParse(a);
  const right = checklistBodySchema.safeParse(b);
  return left.success && right.success && JSON.stringify(left.data) === JSON.stringify(right.data);
};
const noResponse = (): Result<Checklist> => ({ ok: false, reason: "no_response", reference: {} });
/** Independent full-replacement save with opaque ETag, explicit read-only recovery, never PUT replay. */
export function ChecklistEditor({ draftId, checklist, etag: initialEtag, stages, fields, questions, lifecycle }: ChecklistEditorProps) {
  const { readOnly: lifecycleReadOnly } = useConfigLifecycle(lifecycle);
  const [finished, setFinished] = useState(false);
  const readOnly = lifecycleReadOnly || finished;
  const [baseline, setBaseline] = useState(() => bodyOf(checklist));
  const [body, setBody] = useState<ChecklistBody>(() => ({ criteria: checklist.criteria, reminder_stage_ids: checklist.version === "0" ? stages.filter(stage => stage.kind !== "new").map(stage => stage.id) : checklist.reminder_stage_ids }));
  const [etag, setEtag] = useState(initialEtag);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [errors, setErrors] = useState<{ rows: Record<number, string>; reminders?: string }>({ rows: {} });
  const [dialog, setDialog] = useState<Criterion | "new" | null>(null);
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
  function focusError() { requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()); }
  async function persist() {
    if (busy.current || readOnly || recovery || !dirty) return;
    const parsed = checklistBodySchema.safeParse(body);
    if (!parsed.success) {
      const rows: Record<number, string> = {};
      for (const issue of parsed.error.issues) if (issue.path[0] === "criteria" && typeof issue.path[1] === "number") rows[issue.path[1]] = "Revisa este criterio";
      setErrors({ rows }); report(failureNotice("validation_error")); focusError(); return;
    }
    busy.current = true; setPending(true);
    const result = await saveChecklistAction({ vacancyId: draftId, ifMatch: etag, body: parsed.data }).catch(noResponse);
    if (!mounted.current) return;
    if (result.ok && result.etag) {
      const saved = bodyOf(result.data); setBody(saved); setBaseline(saved); setEtag(result.etag); setErrors({ rows: {} }); report({ tone: "success", title: "Checklist guardado", description: "Los criterios se contrastan con todos los candidatos del proceso." });
    } else {
      const failure = result.ok ? { ...noResponse(), reason: "unrecognized_response" as const } : result;
      const next = failureNotice(failure.reason);
      if (failure.reason === "process_finished") setFinished(true);
      setRecovery(next.recovery ?? null);
      if (!failure.ok && failure.reason === "validation_error") { setErrors(fieldErrors(failure.fields ?? [])); focusError(); }
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
  return <div ref={root} className="flex flex-col gap-5">
    {body.criteria.length === 0 && <StateCard icon={ListChecks} tone="empty" title="Todavía no tienes criterios" description="Este checklist es interno, nunca es público y se contrasta automáticamente con cada candidato." primaryAction={{ label: "Sugerir desde la vacante", disabled, onClick: () => { const criteria = suggestCriteria(fields, questions); edit({ ...body, criteria }); if (!criteria.length) report({ tone: "info", title: "No encontramos criterios para sugerir", description: "Agrega un criterio o completa los requisitos de la vacante." }); } }} />}
    <Card aria-labelledby="checklist-heading">
      <CardHeader className="border-b"><CardTitle><h3 id="checklist-heading">Checklist</h3></CardTitle><CardDescription>Define lo obligatorio y lo deseable. Solo lo ve tu equipo; nunca rechaza ni mueve candidatos.</CardDescription></CardHeader>
      <CardContent><FieldGroup>
        {readOnly && <ConfigReadOnlyNotice />}
        {!!body.criteria.length && <CriteriaRows criteria={body.criteria} errors={errors.rows} disabled={disabled} onChange={criteria => edit({ ...body, criteria })} onEdit={setDialog} />}
        <Button type="button" variant="outline" className="min-h-10" disabled={disabled || body.criteria.length >= 50} onClick={() => setDialog("new")}>Agregar criterio</Button>
        <FieldSet disabled={disabled}><FieldLegend>Recordatorio al mover</FieldLegend><FieldDescription>Te recordaremos los criterios obligatorios sin evaluar al mover a estas etapas. Puedes continuar sin marcarlos.</FieldDescription><FieldGroup>
          {stages.map(stage => <Field key={stage.id} orientation="horizontal" data-invalid={!!errors.reminders}><Checkbox id={`reminder-${stage.id}`} disabled={disabled} checked={body.reminder_stage_ids.includes(stage.id)} aria-invalid={!!errors.reminders} aria-describedby={errors.reminders ? "reminders-error" : undefined} onCheckedChange={checked => edit({ ...body, reminder_stage_ids: checked ? [...body.reminder_stage_ids, stage.id] : body.reminder_stage_ids.filter(id => id !== stage.id) })} /><FieldLabel htmlFor={`reminder-${stage.id}`} className="min-h-10">{stage.name}</FieldLabel></Field>)}
          {errors.reminders && <FieldError id="reminders-error">{errors.reminders}</FieldError>}
        </FieldGroup></FieldSet>
      </FieldGroup></CardContent>
      <CardFooter className="border-t"><ActionBar status={notice && <ActionStatus id="checklist-save-status" tone={notice.tone} text={notice.title} action={recovery && <Button type="button" variant="outline" className="min-h-10" disabled={pending} onClick={() => void recover()}>{recovery === "reload" ? "Cargar versión actual" : "Comprobar"}</Button>} />}>
        <Button type="button" variant="ghost" className="min-h-10" disabled={!dirty || disabled} onClick={() => edit(baseline)}>Descartar cambios</Button>
        <Button type="button" className="min-h-10" disabled={!dirty || disabled} aria-describedby={notice ? "checklist-save-status" : undefined} aria-busy={pending} onClick={() => void persist()}>{pending && <Spinner aria-hidden="true" data-icon="inline-start" />}{pending ? "Guardando…" : "Guardar cambios"}</Button>
      </ActionBar></CardFooter>
    </Card>
    {dialog && <CriterionDialog initial={dialog === "new" ? undefined : dialog} questions={questions} onClose={() => setDialog(null)} onApply={criterion => { edit({ ...body, criteria: dialog === "new" ? [...body.criteria, criterion] : body.criteria.map(previous => previous.id === dialog.id ? updateCriterionIdentity(previous, criterion) : previous) }); setDialog(null); }} />}
  </div>;
}
