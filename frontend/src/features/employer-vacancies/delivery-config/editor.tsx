"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CalendarDays, Flag, Target, CircleCheckBig } from "lucide-react";
import { ActionBar, ActionStatus } from "@/components/feedback/action-status";
import { notifyActionResult } from "@/components/feedback/notify";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { ConfirmActionDialog } from "@/components/feedback/confirm-action-dialog";
import { FulfilledDelivery, FulfillmentCandidates, DeliveryCommitmentDate } from "./fulfillment-view";
import type { DeliveryPreview } from "@/features/jobs/drafts/pipeline/fulfillment-model";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { loadDraftDeliveryAction, saveDraftDeliveryAction, previewDraftDeliveryAction, type DraftDeliveryActionResult } from "@/features/jobs/drafts/pipeline/delivery-actions";
import { adoptSaved, fromDelivery, isDirty, reconcileUncertainSave, setCommitmentDate, setCutoffStageId, setTargetText, toPutBody, validate, type Delivery, type DeliveryState } from "@/features/jobs/drafts/pipeline/delivery-model";
import { DeliveryDateField } from "./date-field";
import { conflictNotice, deliveryFailureNotice, invalidNotice, recoveryLabels, savedNotice, type PipelineNotice } from "./feedback";

type Session = { editor: DeliveryState; etag: string };
const noResponse = (): DraftDeliveryActionResult => ({ ok: false, reason: "no_response", reference: {} });
export function DeliveryEditor({ draftId, delivery, etag, stages }: {
  draftId: string; delivery: Delivery; etag: string; stages: { id: string; name: string }[];
}) {
  const [frozen, setFrozen] = useState(false);
  const [confirmation, setConfirmation] = useState<{ snapshot: Session; preview: DeliveryPreview } | null>(null);
  const [session, setSession] = useState<Session>(() => ({ editor: fromDelivery(delivery), etag }));
  const current = useRef(session);
  const [pending, setPending] = useState<"save" | "reload" | "check" | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const [notice, setNotice] = useState<PipelineNotice | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [targetTouched, setTargetTouched] = useState(false);
  const [dateRejected, setDateRejected] = useState(false);
  const targetInput = useRef<HTMLInputElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const statusLink = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const state = session.editor;
  const dirty = isDirty(state);
  const errors = validate(state, stages.map(stage => stage.id)).errors;
  const targetError = attempted || targetTouched ? errors.targetText : undefined;
  const targetMessage = targetError === "not_integer" ? "Escribe un número entero." : targetError === "out_of_range" ? `Usa un número entre 1 y ${state.limits.maxTargetQuantity}.` : undefined;
  const cutoffMessage = attempted && errors.cutoffStageId ? "Elige una columna actual del pipeline." : undefined;
  function replace(editor: DeliveryState, nextEtag = current.current.etag) {
    const next = { editor, etag: nextEtag }; current.current = next; setSession(next);
  }
  function edit(editor: DeliveryState) { if (!busy.current && !confirmation) replace(editor); }
  function resetErrors() { setAttempted(false); setTargetTouched(false); setDateRejected(false); }
  function report(next: PipelineNotice, reference?: { status?: number; code?: string }) {
    setNotice(next);
    const action = next.recovery ? { title: recoveryLabels[next.recovery], onClick: () => { void recover(next.recovery!); } }
      // The toast shortcut follows the status line's real link (same as the substates Sheet).
      : next.link ? { title: next.link.title, onClick: () => { statusLink.current?.click(); } } : undefined;
    notifyActionResult({ key: "delivery-save", type: next.tone, title: next.title, description: next.description,
      ...(next.tone === "error" ? { reference: { ...reference, at: new Date().toISOString() } } : {}), action });
  }
  function adopt(result: Extract<DraftDeliveryActionResult, { ok: true }>, attemptedState: DeliveryState) {
    replace(adoptSaved(attemptedState, result.delivery), result.etag); resetErrors();
  }
  async function persist(confirmed = false) {
    if (busy.current || frozen || current.current.editor.baseline.fulfilled || (!confirmed && confirmation) || !isDirty(current.current.editor)) return;
    setAttempted(true);
    const snapshot = confirmed && confirmation ? confirmation.snapshot : current.current;
    const validation = validate(snapshot.editor, stages.map(stage => stage.id));
    if (!validation.ok) {
      report(invalidNotice);
      // Focus the first invalid field in visual order.
      if (validation.errors.cutoffStageId) document.getElementById("delivery-cutoff")?.focus();
      else if (validation.errors.targetText) targetInput.current?.focus();
      else document.getElementById("delivery-date")?.focus();
      return;
    }
    busy.current = true; setPending("save"); setNotice(null);
    const body = toPutBody(snapshot.editor);
    if (!confirmed) {
      const preview = await previewDraftDeliveryAction({ draftId, body }).catch(noResponse);
      if (!mounted.current) return;
      if (preview.ok && "preview" in preview && preview.preview.would_fulfill) {
        setConfirmation({ snapshot, preview: preview.preview }); busy.current = false; setPending(null); return;
      }
      // Unpublished drafts cannot fulfill; their configuration remains editable.
      if (!preview.ok && preview.reason !== "vacancy_not_published") {
        if (preview.reason === "delivery_fulfilled") await reloadFulfilled();
        else {
          if (preview.reason === "non_business_date") setDateRejected(true);
          report({ ...deliveryFailureNotice(preview), description: "No se guardó la entrega. Tus cambios siguen aquí; revisa el aviso antes de volver a guardar.", recovery: undefined }, preview.reference);
        }
        busy.current = false; setPending(null); return;
      }
    }
    const result = await saveDraftDeliveryAction({ draftId, ifMatch: snapshot.etag, body: { ...body, ...(confirmed ? { confirm_fulfillment: true } : {}) } }).catch(noResponse);
    if (!mounted.current) return;
    if (result.ok) {
      setConfirmation(null);
      adopt(result, snapshot.editor);
      report(result.delivery.fulfilled ? { tone: "success", title: "Entrega cumplida", description: "Se alcanzó el objetivo de entrega. La configuración ya no se puede cambiar.", text: "Entrega cumplida" } : result.delivery.version === snapshot.editor.baseline.version ? { tone: "info", title: "No había cambios que guardar", text: "Guardado" } : savedNotice);
    } else if (result.reason === "delivery_fulfilled") {
      setConfirmation(null); await reloadFulfilled();
    } else if (result.reason === "fulfillment_confirmation_required") {
      const fresh = await previewDraftDeliveryAction({ draftId, body }).catch(noResponse);
      if (!mounted.current) return;
      if (fresh.ok && "preview" in fresh) { setConfirmation({ snapshot, preview: fresh.preview }); report(deliveryFailureNotice(result)); }
      else if (!fresh.ok && fresh.reason === "delivery_fulfilled") { setConfirmation(null); await reloadFulfilled(); }
      else if (!fresh.ok) { setConfirmation(null); report({ ...deliveryFailureNotice(fresh), description: "No se guardó. No pudimos actualizar la vista previa; tus cambios siguen aquí.", recovery: undefined }, fresh.reference); }
    } else {
      setConfirmation(null);
      if (result.reason === "non_business_date") setDateRejected(true);
      report(deliveryFailureNotice(result), result.reference);
    }
    busy.current = false; setPending(null);
  }
  async function reloadFulfilled() {
    setFrozen(true);
    const result = await loadDraftDeliveryAction(draftId).catch(noResponse);
    if (!mounted.current) return;
    if (result.ok) adopt(result, current.current.editor);
    report({ tone: "info", title: "La entrega ya se cumplió", text: "La entrega ya se cumplió; no se guardaron tus cambios.", description: "La configuración quedó bloqueada. Revisa el resultado de la entrega." });
  }
  async function recover(mode: "reload" | "check") {
    if (busy.current || !mounted.current) return;
    busy.current = true; setPending(mode);
    const snapshot = current.current;
    const result = await loadDraftDeliveryAction(draftId).catch(noResponse);
    if (!mounted.current) return;
    if (!result.ok) {
      report({ ...deliveryFailureNotice(result), description: "No pudimos cargar la versión guardada. Tus cambios siguen aquí. Puedes volver a comprobarla; no se enviará otro guardado.", text: "No se pudo cargar · tus cambios siguen aquí", recovery: mode }, result.reference);
    } else if (result.delivery.fulfilled) {
      adopt(result, snapshot.editor);
      report({ tone: "info", title: "La entrega ya se cumplió", text: "Entrega cumplida · configuración bloqueada", description: "La versión guardada ya no se puede cambiar. Revisa el resultado de la entrega." });
    } else if (mode === "reload") {
      replace(fromDelivery(result.delivery), result.etag); resetErrors();
      report({ tone: "info", title: "Versión actual cargada", text: "Versión actual cargada", description: "El editor muestra los datos de entrega guardados actualmente." });
    } else {
      const outcome = reconcileUncertainSave(snapshot.editor, result.delivery);
      if (outcome === "saved") { adopt(result, snapshot.editor); report(savedNotice); }
      else if (outcome === "not_saved") report({ tone: "info", title: "No se guardó la entrega", text: "No se guardó. Puedes guardar de nuevo; es seguro.", description: "Tus cambios siguen aquí. Puedes guardar de nuevo; es seguro." });
      else report(conflictNotice);
    }
    busy.current = false; setPending(null);
  }
  const recovery = notice?.recovery;
  const statusAction = recovery ? <Button type="button" variant="outline" className="min-h-10" disabled={pending !== null} onClick={() => void recover(recovery)}>
    {pending === recovery && <Spinner aria-hidden="true" data-icon="inline-start" />}{recoveryLabels[recovery]}
  </Button> : notice?.link ? <Button nativeButton={false} role="link" variant="outline" className="min-h-10" render={<Link ref={statusLink} href={notice.link.href} target="_blank" rel="noopener noreferrer" />}>{notice.link.title}</Button> : undefined;
  const options = [{ value: "undefined", label: "Sin definir" }, ...stages.map(stage => ({ value: stage.id, label: stage.name }))];
  if (state.baseline.fulfilled || frozen) return <FulfilledDelivery draftId={draftId} message={notice?.text} />;
  return <><Card aria-labelledby="delivery-heading">
    <CardHeader className="border-b">
      <CardTitle><h3 id="delivery-heading">Entrega</h3></CardTitle>
      <CardDescription className="max-w-prose">Define qué cuenta como entrega de esta vacante y para cuándo te comprometes. Puedes guardar los datos por partes; para publicar harán falta los tres.</CardDescription>
    </CardHeader>
    <CardContent>
      <FieldGroup>
        <Field data-invalid={!!cutoffMessage} data-disabled={pending !== null}>
          <FieldLabel htmlFor="delivery-cutoff"><Flag aria-hidden="true" className="size-3.5" />Columna de corte</FieldLabel>
          <Select items={options} value={state.cutoffStageId ?? "undefined"} disabled={pending !== null} onValueChange={value => edit(setCutoffStageId(current.current.editor, value === "undefined" ? null : value))}>
            <SelectTrigger id="delivery-cutoff" className="min-h-10 w-full" aria-invalid={!!cutoffMessage} aria-describedby={`delivery-cutoff-description${cutoffMessage ? " delivery-cutoff-error" : ""}`}><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>{options.map(option => <SelectItem key={option.value} value={option.value} className="min-h-10">{option.label}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
          <FieldDescription id="delivery-cutoff-description">Un candidato cuenta como entregado cuando llega a esta columna.</FieldDescription>
          {cutoffMessage && <FieldError id="delivery-cutoff-error">{cutoffMessage}</FieldError>}
        </Field>
        <Field data-invalid={!!targetMessage} data-disabled={pending !== null}>
          <FieldLabel htmlFor="delivery-target"><Target aria-hidden="true" className="size-3.5" />Objetivo de entrega</FieldLabel>
          <Input id="delivery-target" ref={targetInput} type="text" inputMode="numeric" className="min-h-10" value={state.targetText} disabled={pending !== null}
            onChange={event => edit(setTargetText(current.current.editor, event.target.value))} onBlur={() => setTargetTouched(true)} aria-invalid={!!targetMessage} aria-describedby={`delivery-target-description${targetMessage ? " delivery-target-error" : ""}`} />
          <FieldDescription id="delivery-target-description">Cuántos candidatos distintos tienes que entregar (1 a {state.limits.maxTargetQuantity}).</FieldDescription>
          {targetMessage && <FieldError id="delivery-target-error">{targetMessage}</FieldError>}
        </Field>
        <DeliveryDateField state={state} disabled={pending !== null} error={dateRejected ? "non_business_day" : errors.commitmentDate}
          onChange={value => { if (!busy.current) { edit(setCommitmentDate(current.current.editor, value)); setDateRejected(false); } }} />
      </FieldGroup>
    </CardContent>
    <CardFooter className="border-t">
      <ActionBar status={notice && <ActionStatus id="delivery-save-status" tone={dirty && notice.text === "Guardado" ? "info" : notice.tone} text={dirty && notice.text === "Guardado" ? "Cambios sin guardar" : notice.text} action={statusAction} />}>
        <Button type="button" variant="ghost" className="min-h-10" disabled={!dirty || pending !== null} onClick={() => { edit(fromDelivery(current.current.editor.baseline)); resetErrors(); setNotice(null); }}>Descartar cambios</Button>
        <Button ref={saveButton} type="button" className="min-h-10" disabled={!dirty || pending !== null} aria-busy={pending === "save"} aria-describedby={notice ? "delivery-save-status" : undefined} onClick={() => void persist()}>
          {pending === "save" && <Spinner aria-hidden="true" data-icon="inline-start" />}{pending === "save" ? "Guardando…" : "Guardar cambios"}
        </Button>
      </ActionBar>
    </CardFooter>
  </Card>
  <ConfirmActionDialog open={!!confirmation} finalFocus={saveButton} onOpenChange={open => { if (!open && !busy.current) setConfirmation(null); }}
    icon={CircleCheckBig} title="¿Guardar y cumplir la entrega?" description="Con este cambio la entrega queda cumplida y su configuración se congela."
    confirmLabel="Guardar y cumplir" pendingLabel="Guardando…" pending={pending !== null} onConfirm={() => void persist(true)}>
    {confirmation && <>
      <div className="flex flex-col gap-4">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div><dt className="flex items-center gap-2 text-xs text-muted-foreground"><Target aria-hidden="true" className="size-3.5" />Objetivo de entrega</dt><dd>{confirmation.preview.delivered} de {confirmation.preview.target} candidatos</dd></div>
          <div><dt className="flex items-center gap-2 text-xs text-muted-foreground"><Flag aria-hidden="true" className="size-3.5" />Columna de corte</dt><dd>{stages.find(stage => stage.id === confirmation.snapshot.editor.cutoffStageId)?.name ?? "Sin definir"}</dd></div>
          <div><dt className="flex items-center gap-2 text-xs text-muted-foreground"><CalendarDays aria-hidden="true" className="size-3.5" />Fecha compromiso</dt><dd><DeliveryCommitmentDate value={confirmation.snapshot.editor.commitmentDate} /></dd></div>
        </dl>
        <FulfillmentCandidates candidates={confirmation.preview.candidates} />
      </div>
      {notice && <ActionStatus id="delivery-confirm-status" tone={notice.tone} text={notice.text} />}
    </>}
  </ConfirmActionDialog></>;
}
